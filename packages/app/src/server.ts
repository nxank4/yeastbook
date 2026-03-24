// src/server.ts — Bun HTTP+WebSocket server for notebook execution

import { resolve, basename, dirname, join, extname, relative } from "node:path";
import { homedir } from "node:os";
import { rename, mkdir, readdir, rm, copyFile, stat, readFile, writeFile } from "node:fs/promises";
import { existsSync, watch as fsWatch } from "node:fs";
import { assets } from "./assets.ts";
import { executeCode, interruptExecution } from "./kernel/execute.ts";
import { installPackages } from "./kernel/installer.ts";
import { serializeContext, saveSnapshot, loadSnapshot, clearSnapshot } from "./kernel/snapshot.ts";
import { PythonKernel, YeastBridge, scanPythonEnvironments } from "./kernel/python-bridge.ts";
import type { SessionSnapshot } from "./kernel/snapshot.ts";
import { watchNotebook, createOwnWriteMarker } from "./watcher.ts";
import { PluginLoader } from "./plugins/loader.ts";
import {
  Notebook, loadNotebook as loadNb, ybkToIpynb, detectFormat, createEmptyYbk,
  parseMagicCommands, detectOutputType, DEFAULT_SETTINGS,
} from "@codepawl/yeastbook-core";
import type { Settings } from "@codepawl/yeastbook-core";

const SETTINGS_DIR = join(homedir(), ".yeastbook");
const SETTINGS_FILE = join(SETTINGS_DIR, "settings.json");

async function loadSettings(): Promise<Settings> {
  try {
    const file = Bun.file(SETTINGS_FILE);
    if (await file.exists()) {
      const data = await file.json();
      return { ...DEFAULT_SETTINGS, ...data,
        editor: { ...DEFAULT_SETTINGS.editor, ...data.editor },
        appearance: { ...DEFAULT_SETTINGS.appearance, ...data.appearance },
        execution: { ...DEFAULT_SETTINGS.execution, ...data.execution },
        ai: { ...DEFAULT_SETTINGS.ai, ...data.ai },
        layout: { ...DEFAULT_SETTINGS.layout, ...data.layout },
      };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

async function saveSettings(settings: Settings): Promise<void> {
  await mkdir(SETTINGS_DIR, { recursive: true });
  await Bun.write(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

async function loadEnvFile(notebookPath: string): Promise<Record<string, string>> {
  const envPath = resolve(dirname(notebookPath), ".env");
  const envVars: Record<string, string> = {};
  try {
    const content = await Bun.file(envPath).text();
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      envVars[key] = value;
    }
  } catch {}
  return envVars;
}

// --- File Explorer helpers ---

interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
  size?: number;
  isNotebook?: boolean;
}

const IGNORE_PATTERNS = new Set(["node_modules", ".git", ".yeastbook-state", ".yeastbook-cache"]);
const IGNORE_PREFIXES = [".yeastbook-"];

function shouldIgnore(name: string): boolean {
  if (IGNORE_PATTERNS.has(name)) return true;
  for (const prefix of IGNORE_PREFIXES) {
    if (name.startsWith(prefix)) return true;
  }
  return false;
}

async function buildFileTree(dir: string, rootDir: string, depth = 0): Promise<FileNode[]> {
  if (depth > 10) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const nodes: FileNode[] = [];

  for (const entry of entries) {
    if (shouldIgnore(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    const relPath = relative(rootDir, fullPath);

    if (entry.isDirectory()) {
      const children = await buildFileTree(fullPath, rootDir, depth + 1);
      nodes.push({ name: entry.name, path: relPath, type: "directory", children });
    } else {
      const ext = extname(entry.name).toLowerCase();
      const isNotebook = ext === ".ybk" || ext === ".ipynb";
      let size = 0;
      try { size = (await stat(fullPath)).size; } catch {}
      nodes.push({ name: entry.name, path: relPath, type: "file", size, isNotebook });
    }
  }

  // Sort: directories first, then alphabetical
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

function validatePath(requestedPath: string, rootDir: string): string | null {
  const resolved = resolve(rootDir, requestedPath);
  if (!resolved.startsWith(rootDir + "/") && resolved !== rootDir) return null;
  return resolved;
}

interface ServerState {
  notebook: Notebook;
  filePath: string;
  executionCount: number;
  context: Record<string, unknown>;
  pythonKernel: PythonKernel | null;
  yeastBridge: YeastBridge;
  sqlEngine: any;
  bootstrapping: boolean;
  deleted: boolean;
}

function hasDistDir(): boolean {
  return existsSync(resolve(import.meta.dirname!, "../../ui/dist"));
}

export async function startServer(filePath: string, port: number = 3000, devMode: boolean = false) {
  const absPath = resolve(filePath);
  const notebookDir = dirname(absPath);
  process.chdir(notebookDir);
  const notebook = await Notebook.load(absPath);

  // Track this notebook as recently opened
  try {
    const { addRecent } = await import("./dashboard.ts");
    await addRecent(absPath);
  } catch {}

  const settings = await loadSettings();

  // Load plugins
  const pluginLoader = new PluginLoader(join(homedir(), ".yeastbook", "plugins"));
  await pluginLoader.loadAll();
  try {
    pluginLoader.registerPlugin((await import("./plugins/builtin/vega.ts")).default);
  } catch {}

  // Auto-install missing dependencies from notebook metadata
  const deps = notebook.ybk.metadata.dependencies ?? {};
  if (Object.keys(deps).length > 0) {
    const missing: string[] = [];
    for (const [pkg, version] of Object.entries(deps)) {
      try {
        await Bun.file(resolve("node_modules", pkg, "package.json")).json();
      } catch {
        missing.push(`${pkg}@${version}`);
      }
    }
    if (missing.length > 0) {
      console.log(`\x1b[36m📦 Installing ${missing.length} missing dependencies...\x1b[0m`);
      const proc = Bun.spawn(["bun", "add", ...missing], { stdout: "inherit", stderr: "inherit" });
      await proc.exited;
      console.log(`\x1b[32m✓ Dependencies ready\x1b[0m`);
    }
  }

  // Load .env from notebook directory into process.env
  let envKeys: string[] = [];
  async function reloadEnv() {
    const vars = await loadEnvFile(absPath);
    Object.assign(process.env, vars);
    envKeys = Object.keys(vars);
  }
  await reloadEnv();

  const yeastBridge = new YeastBridge();

  const state: ServerState = {
    notebook,
    filePath: absPath,
    executionCount: 0,
    context: {},
    pythonKernel: null,
    yeastBridge,
    sqlEngine: null,
    bootstrapping: false,
    deleted: false,
  };

  // Inject YeastBridge into execution context so TS cells can use yb.push/get
  state.context.yb = yeastBridge;

  // Restore session snapshot if available
  let lastSnapshotVars: Record<string, { value: unknown; type: string; serializable: boolean }> = {};
  const snapshot = await loadSnapshot(absPath);
  if (snapshot) {
    let restoredCount = 0;
    for (const [key, entry] of Object.entries(snapshot.variables)) {
      if (entry.serializable) {
        state.context[key] = entry.value;
        (globalThis as Record<string, unknown>)[key] = entry.value;
        restoredCount++;
      }
    }
    state.executionCount = snapshot.executionCount;
    lastSnapshotVars = snapshot.variables;
    console.log(`\x1b[36m↩ Session restored — ${restoredCount} variables recovered\x1b[0m`);
  }

  const clients = new Set<any>();
  const ownWriteMarker = createOwnWriteMarker();

  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

  async function embedDepsInMetadata() {
    const notebookDir = dirname(state.filePath);
    try {
      const pkgPath = join(notebookDir, "package.json");
      const lockPath = join(notebookDir, "bun.lock");
      if (existsSync(pkgPath)) {
        state.notebook.ybk.metadata.packageJson = await Bun.file(pkgPath).text();
      }
      if (existsSync(lockPath)) {
        state.notebook.ybk.metadata.bunLock = await Bun.file(lockPath).text();
      }
    } catch { /* skip if can't read */ }
  }

  function scheduleAutoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    if (state.deleted) return;
    autoSaveTimer = setTimeout(async () => {
      if (state.deleted) return;
      try {
        await embedDepsInMetadata();
        ownWriteMarker.mark();
        await state.notebook.save(state.filePath);
        for (const c of clients) {
          try { c.send(JSON.stringify({ type: "auto_saved" })); } catch {}
        }
      } catch {}
    }, 30_000);
  }

  const stopWatcher = watchNotebook(absPath, async () => {
    if (state.deleted) return;
    // If the file was removed externally, don't try to reload
    if (!existsSync(state.filePath)) {
      state.deleted = true;
      stopWatcher();
      if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; }
      for (const c of clients) {
        try { c.send(JSON.stringify({ type: "notebook_deleted" })); } catch {}
      }
      return;
    }
    try {
      const updated = await Notebook.load(state.filePath);
      state.notebook = updated;
      for (const c of clients) {
        try { c.send(JSON.stringify({ type: "notebook_updated" })); } catch {}
      }
    } catch {}
  }, ownWriteMarker);

  const distDir = resolve(import.meta.dirname!, "../../ui/dist");

  // In dev mode, watch dist/ for UI rebuilds and notify clients to reload
  if (devMode && existsSync(distDir)) {
    let hmrDebounce: ReturnType<typeof setTimeout> | null = null;
    fsWatch(distDir, { recursive: true }, () => {
      if (hmrDebounce) clearTimeout(hmrDebounce);
      hmrDebounce = setTimeout(() => {
        for (const c of clients) {
          try { c.send(JSON.stringify({ type: "hmr_reload" })); } catch {}
        }
      }, 300);
    });
    console.log("Dev mode: watching UI dist/ for changes");
  }

  // File explorer watcher: broadcast files_changed to all clients
  let filesDebounce: ReturnType<typeof setTimeout> | null = null;
  try {
    const filesWatcher = fsWatch(process.cwd(), { recursive: true }, (_event, filename) => {
      if (typeof filename === "string") {
        const parts = filename.split("/");
        if (parts.some((p) => p === "node_modules" || p === ".git" || p.startsWith(".yeastbook-"))) return;
      }
      if (filesDebounce) clearTimeout(filesDebounce);
      filesDebounce = setTimeout(() => {
        for (const c of clients) {
          try { c.send(JSON.stringify({ type: "files_changed" })); } catch {}
        }
      }, 500);
    });
    filesWatcher.on("error", () => {}); // ignore watcher errors (e.g. permission denied)
  } catch {}

  const CONTENT_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
  };

  const server = Bun.serve({
    port,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        if (server.upgrade(req)) return;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      // Serve static files from dist/ or embedded assets
      if (url.pathname !== "/" && !url.pathname.startsWith("/api/")) {
        if ((devMode || hasDistDir())) {
          const safePath = url.pathname.slice(1);
          const filePath = resolve(distDir, safePath);
          if (!filePath.startsWith(distDir + "/")) {
            return new Response("Not found", { status: 404 });
          }
          const ext = safePath.substring(safePath.lastIndexOf("."));
          const contentType = CONTENT_TYPES[ext] || "application/octet-stream";
          return new Response(Bun.file(filePath), {
            headers: { "Content-Type": contentType },
          });
        }
        const asset = assets[url.pathname];
        if (asset) {
          const body = asset.binary
            ? Uint8Array.from(atob(asset.content), (c) => c.charCodeAt(0))
            : asset.content;
          return new Response(body, {
            headers: { "Content-Type": asset.mimeType },
          });
        }
      }
      return new Response("Not found", { status: 404 });
    },
    routes: {
      "/.well-known/appspecific/com.chrome.devtools.json": () =>
        new Response("{}", { headers: { "Content-Type": "application/json" } }),
      "/": async () => {
        if ((devMode || hasDistDir())) {
          return new Response(Bun.file(resolve(distDir, "index.html")), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
        const asset = assets["/"]!;
        return new Response(asset.content, {
          headers: { "Content-Type": asset.mimeType },
        });
      },
      "/api/notebook": {
        GET: () => Response.json({ ...state.notebook.toJSON(), filePath: state.filePath, fileName: basename(state.filePath), fileFormat: state.notebook.format }),
      },
      "/api/notebook/path": {
        GET: () => Response.json({ path: state.filePath }),
      },
      "/api/cells": {
        POST: async (req) => {
          const body = await req.json() as { type: "code" | "markdown"; source?: string };
          const id = state.notebook.addCell(body.type, body.source ?? "");
          ownWriteMarker.mark();
          await state.notebook.save(state.filePath);
          scheduleAutoSave();
          return Response.json({ id });
        },
      },
      "/api/cells/:id": {
        DELETE: async (req) => {
          state.notebook.deleteCell(req.params.id);
          ownWriteMarker.mark();
          await state.notebook.save(state.filePath);
          scheduleAutoSave();
          return Response.json({ ok: true });
        },
        PATCH: async (req) => {
          const body = await req.json() as { source?: string; cell_type?: "code" | "markdown"; metadata?: Record<string, unknown> };
          if (body.source !== undefined) {
            state.notebook.updateCellSource(req.params.id, body.source);
          }
          if (body.cell_type) {
            state.notebook.updateCellType(req.params.id, body.cell_type);
          }
          if (body.metadata) {
            state.notebook.updateCellMetadata(req.params.id, body.metadata);
          }
          ownWriteMarker.mark();
          await state.notebook.save(state.filePath);
          scheduleAutoSave();
          return Response.json({ ok: true });
        },
      },
      "/api/cells/:id/move": {
        POST: async (req) => {
          const body = await req.json() as { direction: "up" | "down" };
          state.notebook.moveCell(req.params.id, body.direction);
          ownWriteMarker.mark();
          await state.notebook.save(state.filePath);
          scheduleAutoSave();
          return Response.json({ ok: true });
        },
      },
      "/api/cells/:id/reorder": {
        POST: async (req) => {
          const body = await req.json() as { toIndex: number };
          state.notebook.reorderCell(req.params.id, body.toIndex);
          ownWriteMarker.mark();
          await state.notebook.save(state.filePath);
          scheduleAutoSave();
          return Response.json({ ok: true });
        },
      },
      "/api/rename": {
        POST: async (req) => {
          const body = await req.json() as { name: string };
          const hasExt = body.name.endsWith(".ybk") || body.name.endsWith(".ipynb");
          const currentExt = state.filePath.endsWith(".ybk") ? ".ybk" : ".ipynb";
          const newName = hasExt ? body.name : body.name + currentExt;
          const newPath = join(dirname(state.filePath), newName);
          await rename(state.filePath, newPath);
          state.filePath = newPath;
          // Update notebook format if extension changed
          const { detectFormat } = await import("@codepawl/yeastbook-core");
          state.notebook.format = detectFormat(newPath);
          return Response.json({ fileName: basename(newPath), fileFormat: state.notebook.format });
        },
      },
      "/api/restart": {
        POST: async () => {
          // Shutdown Python kernel if running
          if (state.pythonKernel) {
            await state.pythonKernel.shutdown();
            state.pythonKernel = null;
          }
          state.yeastBridge._clear();
          state.yeastBridge._setKernel(null);

          state.context = {};
          state.executionCount = 0;
          lastSnapshotVars = {};
          await clearSnapshot(state.filePath);

          // Re-inject yeastBridge into fresh context
          state.context.yb = state.yeastBridge;

          for (const c of clients) {
            c.send(JSON.stringify({ type: "variables_updated", variables: {} }));
          }
          return Response.json({ ok: true });
        },
      },
      "/api/python/environments": {
        GET: async () => {
          const envs = await scanPythonEnvironments(dirname(state.filePath));
          return Response.json({
            environments: envs,
            active: state.pythonKernel?.detectedPythonPath ?? null,
          });
        },
      },
      "/api/python/select": {
        POST: async (req) => {
          const { pythonPath } = await req.json() as { pythonPath: string };
          // Shutdown existing kernel
          if (state.pythonKernel) {
            await state.pythonKernel.shutdown();
            state.pythonKernel = null;
          }
          // Store preference in notebook metadata
          state.notebook.ybk.metadata.pythonPath = pythonPath;
          ownWriteMarker.mark();
          await state.notebook.save(state.filePath);
          // Broadcast new status
          for (const c of clients) {
            c.send(JSON.stringify({ type: "python_status", status: "available", pythonPath }));
          }
          return Response.json({ ok: true, pythonPath });
        },
      },
      "/api/save": {
        POST: async () => {
          ownWriteMarker.mark();
          await state.notebook.save(state.filePath);
          scheduleAutoSave();
          return Response.json({ ok: true });
        },
      },
      "/api/new": {
        POST: async () => {
          const newPath = resolve(dirname(state.filePath), `notebook-${Date.now()}.ybk`);
          const nb = await Notebook.load(newPath);
          state.notebook = nb;
          state.filePath = newPath;
          state.executionCount = 0;
          state.context = {};
          return Response.json({ ...nb.toJSON(), filePath: newPath, fileName: basename(newPath), fileFormat: nb.format });
        },
      },
      "/api/import": {
        POST: async (req) => {
          const body = await req.json() as { path: string };
          const absPath = resolve(body.path);
          const nb = await Notebook.load(absPath);
          state.notebook = nb;
          state.filePath = absPath;
          state.executionCount = 0;
          state.context = {};
          return Response.json({ ...nb.toJSON(), filePath: absPath, fileName: basename(absPath), fileFormat: nb.format });
        },
      },
      "/api/export/ipynb": {
        POST: async (req) => {
          const body = await req.json().catch(() => ({})) as { outputDir?: string };
          const name = basename(state.filePath).replace(/\.(ybk|ipynb)$/, "");
          const dir = body.outputDir ? resolve(body.outputDir) : dirname(state.filePath);
          await mkdir(dir, { recursive: true });
          const destPath = join(dir, name + ".ipynb");
          state.notebook.syncForExport();
          const ipynb = ybkToIpynb(state.notebook.ybk);
          await Bun.write(destPath, JSON.stringify(ipynb, null, 2) + "\n");
          return Response.json({ path: destPath, fileName: basename(destPath) });
        },
      },
      "/api/export/ybk": {
        POST: async (req) => {
          const body = await req.json().catch(() => ({})) as { outputDir?: string };
          const name = basename(state.filePath).replace(/\.(ybk|ipynb)$/, "");
          const dir = body.outputDir ? resolve(body.outputDir) : dirname(state.filePath);
          await mkdir(dir, { recursive: true });
          const destPath = join(dir, name + ".ybk");
          state.notebook.syncForExport();
          await Bun.write(destPath, JSON.stringify(state.notebook.ybk, null, 2) + "\n");
          return Response.json({ path: destPath, fileName: basename(destPath) });
        },
      },
      "/api/cells/insert": {
        POST: async (req) => {
          const body = await req.json() as { type: "code" | "markdown"; source?: string; afterId?: string };
          const id = state.notebook.insertCellAfter(body.type, body.source ?? "", body.afterId);
          ownWriteMarker.mark();
          await state.notebook.save(state.filePath);
          scheduleAutoSave();
          return Response.json({ id });
        },
      },
      "/api/settings": {
        GET: async () => {
          const pkg = await Bun.file(resolve(import.meta.dirname!, "../package.json")).json();
          return Response.json({
            ...settings,
            version: pkg.version,
            bunVersion: Bun.version,
            notebookDir: dirname(state.filePath),
          });
        },
        POST: async (req) => {
          const body = await req.json() as Partial<Settings>;
          Object.assign(settings.editor, body.editor);
          Object.assign(settings.appearance, body.appearance);
          Object.assign(settings.execution, body.execution);
          Object.assign(settings.ai, body.ai);
          if (body.layout) Object.assign(settings.layout, body.layout);
          await saveSettings(settings);
          const pkg = await Bun.file(resolve(import.meta.dirname!, "../package.json")).json();
          return Response.json({
            ...settings,
            version: pkg.version,
            bunVersion: Bun.version,
          });
        },
      },
      "/api/env": {
        GET: async () => Response.json({ keys: envKeys }),
      },
      "/api/env/info": {
        GET: async () => {
          const notebookDir = dirname(state.filePath);
          const hasVenv = existsSync(join(notebookDir, ".venv")) || existsSync(join(notebookDir, "venv"));
          const isWindows = process.platform === "win32";
          const binDir = isWindows ? "Scripts" : "bin";
          const pyName = isWindows ? "python.exe" : "python3";
          let pythonPath: string | null = null;
          if (state.pythonKernel?.detectedPythonPath) {
            pythonPath = state.pythonKernel.detectedPythonPath;
          } else {
            const candidates = [
              join(notebookDir, ".venv", binDir, pyName),
              join(notebookDir, "venv", binDir, pyName),
            ];
            for (const c of candidates) {
              if (existsSync(c)) { pythonPath = c; break; }
            }
            if (!pythonPath) {
              try {
                const which = Bun.spawnSync(["which", "python3"]);
                if (which.exitCode === 0) pythonPath = which.stdout.toString().trim();
              } catch {}
            }
          }
          return Response.json({
            bunVersion: Bun.version,
            pythonPath: pythonPath ? relative(notebookDir, pythonPath) || pythonPath : null,
            hasVenv,
          });
        },
      },
      "/api/env/create-venv": {
        POST: async () => {
          const notebookDir = dirname(state.filePath);
          const venvPath = join(notebookDir, ".venv");
          if (existsSync(venvPath)) {
            return Response.json({ success: true, message: "venv already exists" });
          }
          const proc = Bun.spawn(["python3", "-m", "venv", ".venv"], {
            cwd: notebookDir,
            stdout: "pipe",
            stderr: "pipe",
          });
          const exitCode = await proc.exited;
          if (exitCode !== 0) {
            const stderr = await new Response(proc.stderr).text();
            return Response.json({ success: false, error: stderr.trim() }, { status: 500 });
          }
          return Response.json({ success: true, path: venvPath });
        },
      },
      "/api/env/reload": {
        POST: async () => {
          await reloadEnv();
          return Response.json({ keys: envKeys });
        },
      },
      "/api/dependencies": {
        GET: () => Response.json({ dependencies: state.notebook.ybk.metadata.dependencies ?? {} }),
      },
      "/api/variables": {
        GET: () => Response.json({ variables: lastSnapshotVars }),
      },
      "/api/system/stats": {
        GET: async () => {
          const stats: Record<string, unknown> = {
            cpuPercent: null,
            memPercent: null,
            memUsedMB: null,
            memTotalMB: null,
            gpuName: null,
            gpuPercent: null,
            vramUsedMB: null,
            vramTotalMB: null,
            vramPercent: null,
          };
          try {
            // Memory from /proc/meminfo (Linux) or os module
            const os = await import("node:os");
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usedMem = totalMem - freeMem;
            stats.memTotalMB = Math.round(totalMem / (1024 * 1024));
            stats.memUsedMB = Math.round(usedMem / (1024 * 1024));
            stats.memPercent = Math.round((usedMem / totalMem) * 100);

            // CPU usage: compare two snapshots 100ms apart
            const cpus1 = os.cpus();
            await new Promise((r) => setTimeout(r, 100));
            const cpus2 = os.cpus();
            let totalIdle = 0, totalTick = 0;
            for (let i = 0; i < cpus1.length; i++) {
              const t1 = cpus1[i].times, t2 = cpus2[i].times;
              const idle = t2.idle - t1.idle;
              const total = (t2.user - t1.user) + (t2.nice - t1.nice) + (t2.sys - t1.sys) + (t2.irq - t1.irq) + idle;
              totalIdle += idle;
              totalTick += total;
            }
            stats.cpuPercent = totalTick > 0 ? Math.round(100 - (totalIdle / totalTick * 100)) : 0;
          } catch { /* ignore */ }

          // GPU via nvidia-smi
          try {
            const proc = Bun.spawn(
              ["nvidia-smi", "--query-gpu=name,utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"],
              { stdout: "pipe", stderr: "pipe" },
            );
            const text = await new Response(proc.stdout).text();
            const code = await proc.exited;
            if (code === 0 && text.trim()) {
              const parts = text.trim().split(",").map((s) => s.trim());
              if (parts.length >= 4) {
                stats.gpuName = parts[0];
                stats.gpuPercent = parseInt(parts[1]) || 0;
                stats.vramUsedMB = parseInt(parts[2]) || 0;
                stats.vramTotalMB = parseInt(parts[3]) || 0;
                stats.vramPercent = (stats.vramTotalMB as number) > 0
                  ? Math.round(((stats.vramUsedMB as number) / (stats.vramTotalMB as number)) * 100)
                  : 0;
              }
            }
          } catch { /* no nvidia-smi */ }

          return Response.json(stats);
        },
      },
      "/api/types/bun": {
        GET: async () => {
          const typeHeaders = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" };
          const paths = [
            resolve(import.meta.dirname!, "../../../node_modules/bun-types/types.d.ts"),
            resolve(import.meta.dirname!, "../../../node_modules/bun-types/index.d.ts"),
            resolve(process.cwd(), "node_modules/bun-types/types.d.ts"),
            resolve(process.cwd(), "node_modules/bun-types/index.d.ts"),
            resolve(process.cwd(), "node_modules/@types/bun/index.d.ts"),
            resolve(import.meta.dirname!, "../../../node_modules/@types/bun/index.d.ts"),
            resolve(process.cwd(), "../../node_modules/bun-types/types.d.ts"),
            resolve(process.cwd(), "../../node_modules/@types/bun/index.d.ts"),
          ];
          for (const p of paths) {
            try {
              const file = Bun.file(p);
              if (await file.exists()) {
                const content = await file.text();
                if (content.length > 100) {
                  return new Response(content, { headers: typeHeaders });
                }
              }
            } catch {}
          }
          return new Response(`
declare namespace Bun {
  const version: string;
  const revision: string;
  function file(path: string | URL): BunFile;
  function write(path: string | BunFile, data: string | Blob | ArrayBuffer | ArrayBufferView): Promise<number>;
  function serve(options: any): any;
  function spawn(cmd: string[], options?: any): any;
  function inspect(value: unknown, options?: { colors?: boolean; depth?: number }): string;
  function sleep(ms: number): Promise<void>;
  function sleepSync(ms: number): void;
  function hash(data: string | ArrayBuffer | ArrayBufferView, seed?: number): number | bigint;
  function build(options: any): Promise<any>;
  const env: Record<string, string | undefined>;
  const argv: string[];
  const main: string;
  const password: { hash(password: string): Promise<string>; verify(password: string, hash: string): Promise<boolean>; };
}
interface BunFile extends Blob {
  readonly name: string; readonly size: number; readonly type: string;
  text(): Promise<string>; json<T = unknown>(): Promise<T>; arrayBuffer(): Promise<ArrayBuffer>;
  exists(): Promise<boolean>; stream(): ReadableStream;
}
declare const $: { (strings: TemplateStringsArray, ...values: unknown[]): ShellPromise };
interface ShellPromise extends Promise<ShellOutput> { text(): Promise<string>; json<T = unknown>(): Promise<T>; lines(): Promise<string[]>; }
interface ShellOutput { stdout: Buffer; stderr: Buffer; exitCode: number; text(): string; }
declare function createSlider(config: { min: number; max: number; value?: number; step?: number; label?: string }): any;
declare function createInput(config: { value?: string; placeholder?: string; label?: string }): any;
declare function createToggle(config: { value?: boolean; label?: string }): any;
declare function createSelect(config: { options: string[]; value?: string; label?: string }): any;
`, { headers: typeHeaders });
        },
      },
      "/api/plugins": {
        GET: () => Response.json({
          plugins: pluginLoader.getPlugins().map((p) => ({
            name: p.name, version: p.version,
            renderers: (p.renderers ?? []).map((r) => ({ type: r.type, displayName: r.displayName })),
          })),
        }),
      },
      "/api/plugins/:type/component": {
        GET: (req) => {
          const renderer = pluginLoader.getRenderers().find((r) => r.type === req.params.type);
          if (!renderer) return new Response("Not found", { status: 404 });
          if (renderer.componentSource) return new Response(renderer.componentSource, {
            headers: { "Content-Type": "text/javascript; charset=utf-8" },
          });
          if (renderer.componentUrl) return Response.redirect(renderer.componentUrl);
          return new Response("No component", { status: 404 });
        },
      },
      "/api/files/tree": {
        GET: async () => {
          const cwd = process.cwd();
          const tree = await buildFileTree(cwd, cwd);
          return Response.json({ tree });
        },
      },
      "/api/files/read": {
        GET: async (req) => {
          const url = new URL(req.url);
          const filePath = url.searchParams.get("path");
          if (!filePath) return new Response("Missing path", { status: 400 });
          const cwd = process.cwd();
          const abs = validatePath(filePath, cwd);
          if (!abs) return new Response("Invalid path", { status: 403 });
          try {
            const file = Bun.file(abs);
            const st = await stat(abs);
            if (st.size > 500 * 1024) return Response.json({ content: null, size: st.size, mimeType: "application/octet-stream", tooLarge: true });
            const content = await file.text();
            return Response.json({ content, size: st.size, mimeType: file.type || "text/plain" });
          } catch {
            return new Response("File not found", { status: 404 });
          }
        },
      },
      "/api/files/create": {
        POST: async (req) => {
          const body = await req.json() as { path: string; type: "file" | "directory"; content?: string };
          const cwd = process.cwd();
          const abs = validatePath(body.path, cwd);
          if (!abs) return new Response("Invalid path", { status: 403 });
          if (body.type === "directory") {
            await mkdir(abs, { recursive: true });
          } else {
            await mkdir(dirname(abs), { recursive: true });
            await writeFile(abs, body.content ?? "", "utf-8");
          }
          return Response.json({ ok: true });
        },
      },
      "/api/files/rename": {
        POST: async (req) => {
          const body = await req.json() as { oldPath: string; newPath: string };
          const cwd = process.cwd();
          const absOld = validatePath(body.oldPath, cwd);
          const absNew = validatePath(body.newPath, cwd);
          if (!absOld || !absNew) return new Response("Invalid path", { status: 403 });
          await rename(absOld, absNew);
          return Response.json({ ok: true });
        },
      },
      "/api/files/delete": {
        POST: async (req) => {
          const body = await req.json() as { path: string };
          const cwd = process.cwd();
          const abs = validatePath(body.path, cwd);
          if (!abs) return new Response("Invalid path", { status: 403 });
          await rm(abs, { recursive: true, force: true });

          // If the deleted file is the currently-open notebook, stop watching/saving
          if (abs === state.filePath) {
            state.deleted = true;
            stopWatcher();
            if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; }
            for (const c of clients) {
              try { c.send(JSON.stringify({ type: "notebook_deleted" })); } catch {}
            }
          }

          return Response.json({ ok: true });
        },
      },
      "/api/files/duplicate": {
        POST: async (req) => {
          const body = await req.json() as { path: string };
          const cwd = process.cwd();
          const abs = validatePath(body.path, cwd);
          if (!abs) return new Response("Invalid path", { status: 403 });
          const ext = extname(abs);
          const base = abs.slice(0, -ext.length || undefined);
          const newPath = `${base}-copy${ext}`;
          await copyFile(abs, newPath);
          return Response.json({ ok: true, newPath: relative(cwd, newPath) });
        },
      },
      "/api/dashboard/files": {
        GET: async () => {
          const { listNotebooks } = await import("./dashboard.ts");
          const files = await listNotebooks(process.cwd());
          return Response.json({ files });
        },
      },
      "/api/dashboard/recents": {
        GET: async () => {
          const { getRecents } = await import("./dashboard.ts");
          const recents = await getRecents();
          return Response.json({ recents });
        },
      },
    },
    websocket: {
      async open(ws) {
        clients.add(ws);
        // Notify new client of restored session
        if (Object.keys(lastSnapshotVars).length > 0) {
          const restoredCount = Object.values(lastSnapshotVars).filter(v => v.serializable).length;
          ws.send(JSON.stringify({
            type: "snapshot_restored",
            restoredCount,
            variables: lastSnapshotVars,
          }));
        }
        // Notify client of Python availability
        if (state.pythonKernel?.isRunning) {
          ws.send(JSON.stringify({
            type: "python_status", status: "available",
            pythonPath: state.pythonKernel.detectedPythonPath,
          }));
        } else {
          // Check if notebook has Python cells but no environment available
          const hasPythonCells = state.notebook.ybk.cells.some(
            (c: any) => c.metadata?.language === "python"
          );
          if (hasPythonCells) {
            const savedPath = state.notebook.ybk.metadata.pythonPath;
            if (!savedPath) {
              const envs = await scanPythonEnvironments(dirname(state.filePath));
              if (envs.length === 0) {
                ws.send(JSON.stringify({ type: "python_env_missing" }));
              }
            }
          }
        }
      },
      close(ws) { clients.delete(ws); },
      async message(ws, message) {
        try {
          const msg = JSON.parse(message as string) as
            | { type: "execute"; cellId: string; code: string; language?: string }
            | { type: "interrupt" }
            | { type: "ping"; ts: number }
            | { type: "variable_inspect"; name: string }
            | { type: "bootstrap"; action: "create-venv" | "use-system" | "select-custom"; customPath?: string; installRequirements?: boolean; lewmPreset?: boolean };

          if (msg.type === "ping") {
            ws.send(JSON.stringify({ type: "pong", ts: msg.ts }));
            return;
          }

          if (msg.type === "execute") {
            // Parse magic commands
            const { magic, cleanCode, cellMagic } = parseMagicCommands(msg.code);

            // ── Python cell routing ──────────────────────────────────────
            // Determine language: explicit from WS message, fallback to %%python magic for legacy
            const language = msg.language || (cellMagic?.type === "python" ? "python" : "typescript");

            if (language === "python") {
              // Use cleanCode if %%python magic was detected (strip the magic line)
              // Otherwise use the full code as-is (language from metadata, no magic to strip)
              const pythonCode = cellMagic?.type === "python" ? cleanCode : msg.code;
              ws.send(JSON.stringify({ type: "status", cellId: msg.cellId, status: "busy" }));

              try {
                // Lazy-start Python kernel
                if (!state.pythonKernel) {
                  const preferredPython = state.notebook.ybk.metadata.pythonPath;
                  state.pythonKernel = new PythonKernel(dirname(state.filePath), {
                    pythonPath: preferredPython,
                    onBridgeSet: (key, value) => {
                      state.yeastBridge._onBridgeSet(key, value);
                    },
                  });
                  state.yeastBridge._setKernel(state.pythonKernel);
                }

                if (!state.pythonKernel.isRunning) {
                  ws.send(JSON.stringify({ type: "python_status", status: "starting" }));
                  await state.pythonKernel.start();
                  ws.send(JSON.stringify({
                    type: "python_status", status: "available",
                    pythonPath: state.pythonKernel.detectedPythonPath,
                  }));
                }

                state.executionCount++;
                state.notebook.updateCellSource(msg.cellId, msg.code);

                const pyResult = await state.pythonKernel.execute(pythonCode, (streamMsg) => {
                  if (streamMsg.type === "stream") {
                    ws.send(JSON.stringify({
                      type: "stream", cellId: msg.cellId,
                      name: streamMsg.name, text: streamMsg.text,
                    }));
                  } else if (streamMsg.type === "mime") {
                    ws.send(JSON.stringify({
                      type: "result", cellId: msg.cellId,
                      value: "", executionCount: state.executionCount,
                      richOutput: { type: "mime", mime: streamMsg.mime, data: streamMsg.data },
                    }));
                  }
                });

                // MIME outputs already streamed via onStream callback above

                if (pyResult.error) {
                  ws.send(JSON.stringify({
                    type: "error", cellId: msg.cellId,
                    ename: pyResult.error.ename, evalue: pyResult.error.evalue,
                    traceback: pyResult.error.traceback,
                  }));
                } else if (pyResult.value !== null) {
                  ws.send(JSON.stringify({
                    type: "result", cellId: msg.cellId,
                    value: pyResult.value,
                    executionCount: state.executionCount,
                  }));
                }

                // Save cell output
                state.notebook.setCellOutput(msg.cellId, state.executionCount, {
                  value: pyResult.value ?? undefined,
                  stdout: pyResult.stdout,
                  stderr: pyResult.stderr,
                  error: pyResult.error,
                });

              } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                ws.send(JSON.stringify({
                  type: "error", cellId: msg.cellId,
                  ename: error.constructor.name, evalue: error.message,
                  traceback: (error.stack ?? "").split("\n"),
                }));

                // If Python not found, notify UI
                if (error.message.includes("Python not found")) {
                  ws.send(JSON.stringify({ type: "python_status", status: "unavailable" }));
                }
              }

              ws.send(JSON.stringify({
                type: "status", cellId: msg.cellId, status: "idle",
                executionCount: state.executionCount,
              }));

              ownWriteMarker.mark();
              await state.notebook.save(state.filePath);
              scheduleAutoSave();

              // Save session snapshot & broadcast variables
              const vars = serializeContext(state.context);
              lastSnapshotVars = vars;
              await saveSnapshot(state.filePath, {
                notebookPath: state.filePath,
                savedAt: new Date().toISOString(),
                executionCount: state.executionCount,
                variables: vars,
              });
              for (const client of clients) {
                client.send(JSON.stringify({ type: "variables_updated", variables: vars }));
              }
              return;
            }

            // Send busy status upfront (needed for both magic-only and code cells)
            if (magic.length > 0 || cleanCode.trim()) {
              ws.send(JSON.stringify({ type: "status", cellId: msg.cellId, status: "busy" }));
            }

            // Handle %install commands
            for (const cmd of magic) {
              if (cmd.type === "install") {
                if (cmd.packages.length === 0) {
                  ws.send(JSON.stringify({
                    type: "install_error", cellId: msg.cellId, error: "No packages specified. Usage: %install <package>",
                  }));
                  continue;
                }

                ws.send(JSON.stringify({
                  type: "install_start", cellId: msg.cellId, packages: cmd.packages,
                }));

                const installLogs: string[] = [];
                const result = await installPackages(cmd.packages, (text, stream) => {
                  installLogs.push(text);
                  ws.send(JSON.stringify({
                    type: "install_log", cellId: msg.cellId, text, stream,
                  }));
                });

                // Save install output to cell so it persists on reload
                const cell = state.notebook.getCell(msg.cellId);
                if (cell) {
                  const summary = result.success
                    ? `✓ Installed ${cmd.packages.join(", ")}${result.versions ? " (" + Object.entries(result.versions).map(([p, v]) => `${p}@${v}`).join(", ") + ")" : ""}`
                    : `✗ Install failed: ${result.error}`;
                  cell.outputs = [
                    ...(cell.outputs || []),
                    { output_type: "stream", name: "stdout", text: [summary + "\n"] },
                  ];
                  await state.notebook.save(state.filePath);
                }

                if (result.success) {
                  // Save installed versions to notebook metadata
                  if (result.versions && Object.keys(result.versions).length > 0) {
                    if (!state.notebook.ybk.metadata.dependencies) {
                      state.notebook.ybk.metadata.dependencies = {};
                    }
                    for (const [pkg, ver] of Object.entries(result.versions)) {
                      state.notebook.ybk.metadata.dependencies[pkg] = `^${ver}`;
                    }
                    await state.notebook.save(state.filePath);
                    // Notify clients of updated dependencies
                    for (const client of clients) {
                      client.send(JSON.stringify({
                        type: "dependencies_updated",
                        dependencies: state.notebook.ybk.metadata.dependencies,
                      }));
                    }
                  }

                  // Try to read type definitions for installed packages
                  const packageDts: Record<string, string> = {};
                  for (const pkg of cmd.packages) {
                    try {
                      const paths = [
                        resolve("node_modules", pkg, "index.d.ts"),
                        resolve("node_modules", "@types", pkg, "index.d.ts"),
                      ];
                      for (const p of paths) {
                        const f = Bun.file(p);
                        if (await f.exists()) {
                          packageDts[pkg] = await f.text();
                          break;
                        }
                      }
                    } catch {}
                  }
                  ws.send(JSON.stringify({
                    type: "install_done", cellId: msg.cellId, success: true,
                    ...(Object.keys(packageDts).length > 0 ? { packageDts } : {}),
                  }));
                } else {
                  ws.send(JSON.stringify({
                    type: "install_error", cellId: msg.cellId, error: result.error,
                  }));
                }
              } else if (cmd.type === "timeit") {
                const runs = cmd.runs;
                const timeitCode = cmd.code;
                const times: number[] = [];
                for (let i = 0; i < runs; i++) {
                  const start = performance.now();
                  await executeCode(timeitCode, state.context);
                  times.push(performance.now() - start);
                }
                const avg = times.reduce((a, b) => a + b, 0) / times.length;
                const min = Math.min(...times);
                const max = Math.max(...times);
                ws.send(JSON.stringify({
                  type: "stream", cellId: msg.cellId, name: "stdout",
                  text: `${runs} runs: avg ${avg.toFixed(2)}ms, min ${min.toFixed(2)}ms, max ${max.toFixed(2)}ms\n`,
                }));
              } else if (cmd.type === "time") {
                const start = performance.now();
                await executeCode(cmd.code, state.context);
                const elapsed = performance.now() - start;
                ws.send(JSON.stringify({
                  type: "stream", cellId: msg.cellId, name: "stdout",
                  text: `Wall time: ${elapsed.toFixed(2)}ms\n`,
                }));
              } else if (cmd.type === "reload") {
                for (const mod of cmd.modules) {
                  try {
                    const fresh = await import(`${mod}?t=${Date.now()}`);
                    state.context[mod.replace(/[^a-zA-Z0-9_$]/g, "_")] = fresh.default ?? fresh;
                  } catch {}
                }
                ws.send(JSON.stringify({
                  type: "stream", cellId: msg.cellId, name: "stdout",
                  text: `♻ Reloaded: ${cmd.modules.join(", ")}\n`,
                }));
              } else if (cmd.type === "sql_attach") {
                try {
                  if (!state.sqlEngine) {
                    const { SqlEngine } = await import("./kernel/sql-engine.ts");
                    state.sqlEngine = new SqlEngine(dirname(state.filePath));
                  }
                  const msg2 = state.sqlEngine.attach(cmd.path, cmd.alias);
                  ws.send(JSON.stringify({ type: "stream", cellId: msg.cellId, name: "stdout", text: msg2 + "\n" }));
                } catch (e: any) {
                  ws.send(JSON.stringify({ type: "stream", cellId: msg.cellId, name: "stderr", text: e.message + "\n" }));
                }
              } else if (cmd.type === "sql_import") {
                try {
                  if (!state.sqlEngine) {
                    const { SqlEngine } = await import("./kernel/sql-engine.ts");
                    state.sqlEngine = new SqlEngine(dirname(state.filePath));
                  }
                  const msg2 = await state.sqlEngine.importCsv(cmd.path, cmd.table);
                  ws.send(JSON.stringify({ type: "stream", cellId: msg.cellId, name: "stdout", text: msg2 + "\n" }));
                } catch (e: any) {
                  ws.send(JSON.stringify({ type: "stream", cellId: msg.cellId, name: "stderr", text: e.message + "\n" }));
                }
              } else if (cmd.type === "sql") {
                try {
                  if (!state.sqlEngine) {
                    const { SqlEngine } = await import("./kernel/sql-engine.ts");
                    state.sqlEngine = new SqlEngine(dirname(state.filePath));
                  }
                  const result = state.sqlEngine.execute(cmd.query, cmd.db);
                  if (result.columns.length > 0) {
                    ws.send(JSON.stringify({
                      type: "result", cellId: msg.cellId,
                      value: `${result.rowCount} rows`,
                      executionCount: ++state.executionCount,
                      richOutput: { type: "table", rows: result.rows },
                    }));
                  } else {
                    ws.send(JSON.stringify({
                      type: "stream", cellId: msg.cellId, name: "stdout",
                      text: `Query OK, ${result.changes ?? 0} rows affected\n`,
                    }));
                  }
                } catch (e: any) {
                  ws.send(JSON.stringify({ type: "stream", cellId: msg.cellId, name: "stderr", text: `SQL Error: ${e.message}\n` }));
                }
              }
            }

            // Execute clean code (if any remains after stripping magic lines)
            if (cleanCode.trim()) {
              state.executionCount++;
              const result = await executeCode(cleanCode, state.context);

              state.notebook.updateCellSource(msg.cellId, msg.code);
              // Detect rich output for saving
              const richOutputForSave = result.value !== undefined ? detectOutputType(result.value) : undefined;
              state.notebook.setCellOutput(msg.cellId, state.executionCount, {
                value: result.value !== undefined ? Bun.inspect(result.value) : undefined,
                stdout: result.stdout,
                stderr: result.stderr,
                error: result.error,
                richOutput: richOutputForSave as any,
                tables: result.tables,
              });

              if (result.stdout) {
                ws.send(JSON.stringify({
                  type: "stream", cellId: msg.cellId, name: "stdout", text: result.stdout,
                }));
              }
              if (result.stderr) {
                ws.send(JSON.stringify({
                  type: "stream", cellId: msg.cellId, name: "stderr", text: result.stderr,
                }));
              }
              if (result.tables.length > 0) {
                ws.send(JSON.stringify({
                  type: "result", cellId: msg.cellId,
                  value: "",
                  executionCount: state.executionCount,
                  richOutput: { type: "table", rows: result.tables },
                }));
              }
              if (result.error) {
                ws.send(JSON.stringify({
                  type: "error", cellId: msg.cellId,
                  ename: result.error.ename, evalue: result.error.evalue, traceback: result.error.traceback,
                }));
              } else if (result.value !== undefined) {
                // Detect rich output type
                let richOutput = detectOutputType(result.value);
                // Check plugin renderers for types plugins can handle better
                if (!richOutput || richOutput.type === "json" || richOutput.type === "text") {
                  const pr = pluginLoader.findRenderer(result.value);
                  if (pr) {
                    try {
                      richOutput = { type: "plugin", pluginType: pr.type, data: pr.serialize(result.value) } as any;
                    } catch {}
                  }
                }
                ws.send(JSON.stringify({
                  type: "result", cellId: msg.cellId,
                  value: Bun.inspect(result.value),
                  executionCount: state.executionCount,
                  ...(richOutput ? { richOutput } : {}),
                }));
              }

              ws.send(JSON.stringify({
                type: "status", cellId: msg.cellId, status: "idle", executionCount: state.executionCount,
              }));
              ownWriteMarker.mark();
              await state.notebook.save(state.filePath);
              scheduleAutoSave();

              // Save session snapshot & broadcast variables
              const vars = serializeContext(state.context);
              lastSnapshotVars = vars;
              await saveSnapshot(state.filePath, {
                notebookPath: state.filePath,
                savedAt: new Date().toISOString(),
                executionCount: state.executionCount,
                variables: vars,
              });
              for (const client of clients) {
                client.send(JSON.stringify({ type: "variables_updated", variables: vars }));
              }
            } else if (magic.length > 0) {
              // Magic-only cell: update source but send idle status
              state.notebook.updateCellSource(msg.cellId, msg.code);
              ws.send(JSON.stringify({ type: "status", cellId: msg.cellId, status: "idle" }));
              ownWriteMarker.mark();
              await state.notebook.save(state.filePath);
              scheduleAutoSave();
            }
          } else if (msg.type === "interrupt") {
            interruptExecution();
            state.pythonKernel?.interrupt();
          } else if (msg.type === "variable_inspect") {
            const name = msg.name;
            const val = (state.context as Record<string, unknown>)[name];
            const details: Record<string, unknown> = {
              type: typeof val,
              value: undefined,
              serializable: false,
            };
            try {
              if (val === null || val === undefined) {
                details.type = String(val);
                details.value = val;
                details.serializable = true;
              } else if (Array.isArray(val)) {
                details.type = "Array";
                details.size = val.length;
                details.shape = [val.length];
                details.serializable = true;
                details.value = val.length <= 10 ? val : val.slice(0, 10);
                // Check for 2D arrays
                if (val.length > 0 && Array.isArray(val[0])) {
                  details.shape = [val.length, (val[0] as unknown[]).length];
                  details.head = (val as unknown[][]).slice(0, 5);
                }
              } else if (typeof val === "object") {
                const keys = Object.keys(val as object);
                details.type = (val as { constructor?: { name?: string } }).constructor?.name || "Object";
                details.size = keys.length;
                details.columns = keys.slice(0, 50);
                try {
                  const json = JSON.stringify(val);
                  details.memoryBytes = new TextEncoder().encode(json).byteLength;
                  details.serializable = true;
                  details.value = keys.length <= 20 ? val : Object.fromEntries(keys.slice(0, 20).map(k => [k, (val as Record<string, unknown>)[k]]));
                } catch {
                  details.serializable = false;
                }
              } else {
                details.value = val;
                details.serializable = true;
                if (typeof val === "string") details.size = val.length;
              }
            } catch {
              details.type = "unknown";
            }
            ws.send(JSON.stringify({ type: "variable_details", name, details }));
          } else if (msg.type === "bootstrap") {
            if (state.bootstrapping) {
              ws.send(JSON.stringify({ type: "bootstrap_done", success: false, step: "venv", error: "Bootstrap already in progress" }));
              return;
            }
            state.bootstrapping = true;
            const notebookDir = dirname(state.filePath);
            const decoder = new TextDecoder();

            async function streamProcess(proc: ReturnType<typeof Bun.spawn>) {
              const stdoutReader = (async () => {
                const reader = proc.stdout.getReader();
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  ws.send(JSON.stringify({ type: "bootstrap_log", text: decoder.decode(value), stream: "stdout" }));
                }
              })();
              const stderrReader = (async () => {
                const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  ws.send(JSON.stringify({ type: "bootstrap_log", text: decoder.decode(value), stream: "stderr" }));
                }
              })();
              await Promise.all([stdoutReader, stderrReader]);
              return await proc.exited;
            }

            try {
              let pythonPath: string | null = null;

              if (msg.action === "create-venv") {
                const py3 = Bun.which("python3");
                if (!py3) {
                  ws.send(JSON.stringify({ type: "bootstrap_done", success: false, step: "venv", error: "python3 not found on PATH. Install Python 3 first." }));
                  return;
                }

                ws.send(JSON.stringify({ type: "bootstrap_log", text: "Creating virtual environment...\n", stream: "stdout" }));
                const venvPath = join(notebookDir, ".venv");
                const proc = Bun.spawn(["python3", "-m", "venv", venvPath], {
                  cwd: notebookDir, stdout: "pipe", stderr: "pipe",
                });
                const exitCode = await streamProcess(proc);

                if (exitCode !== 0) {
                  ws.send(JSON.stringify({ type: "bootstrap_done", success: false, step: "venv", error: "Failed to create virtual environment" }));
                  return;
                }

                pythonPath = join(venvPath, "bin", "python3");
                ws.send(JSON.stringify({ type: "bootstrap_log", text: "Virtual environment created.\n", stream: "stdout" }));

              } else if (msg.action === "use-system") {
                pythonPath = Bun.which("python3") || Bun.which("python") || null;
                if (!pythonPath) {
                  ws.send(JSON.stringify({ type: "bootstrap_done", success: false, step: "venv", error: "No Python found on PATH" }));
                  return;
                }

              } else if (msg.action === "select-custom") {
                if (!msg.customPath || !existsSync(msg.customPath)) {
                  ws.send(JSON.stringify({ type: "bootstrap_done", success: false, step: "venv", error: `Python not found at: ${msg.customPath}` }));
                  return;
                }
                pythonPath = msg.customPath;
              }

              if (pythonPath) {
                // Save preference to notebook metadata
                state.notebook.ybk.metadata.pythonPath = pythonPath;
                await state.notebook.save(state.filePath);

                // Broadcast python_status
                for (const c of clients) {
                  c.send(JSON.stringify({ type: "python_status", status: "available", pythonPath }));
                }
              }

              // Check for requirements.txt
              const reqPath = join(notebookDir, "requirements.txt");
              let reqPackages: string[] = [];
              if (existsSync(reqPath)) {
                const content = await Bun.file(reqPath).text();
                reqPackages = content.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
              }

              // If we should install requirements or lewm preset
              if (msg.installRequirements || msg.lewmPreset) {
                const packages: string[] = [];
                if (msg.installRequirements && reqPackages.length > 0) {
                  packages.push("-r", reqPath);
                }
                if (msg.lewmPreset) {
                  packages.push("torch", "torchvision", "stable-worldmodel");
                }

                if (packages.length > 0 && pythonPath) {
                  ws.send(JSON.stringify({ type: "bootstrap_log", text: `Installing packages...\n`, stream: "stdout" }));
                  const pipProc = Bun.spawn([pythonPath, "-m", "pip", "install", ...packages], {
                    cwd: notebookDir, stdout: "pipe", stderr: "pipe",
                  });
                  const pipExit = await streamProcess(pipProc);
                  if (pipExit !== 0) {
                    ws.send(JSON.stringify({ type: "bootstrap_done", success: false, step: "pip", error: "pip install failed" }));
                    return;
                  }
                  ws.send(JSON.stringify({ type: "bootstrap_done", success: true, step: "pip", pythonPath }));
                  return;
                }
              }

              // Send done for venv step, and requirements info if found
              ws.send(JSON.stringify({ type: "bootstrap_done", success: true, step: "venv", pythonPath }));
              if (reqPackages.length > 0) {
                ws.send(JSON.stringify({ type: "bootstrap_requirements_found", packages: reqPackages }));
              }

            } finally {
              state.bootstrapping = false;
            }
          }
        } catch (err) {
          // Catch-all: never let a bad message crash the server
          const error = err instanceof Error ? err : new Error(String(err));
          try {
            const msg = JSON.parse(message as string);
            if (msg?.cellId) {
              ws.send(JSON.stringify({
                type: "error",
                cellId: msg.cellId,
                ename: error.constructor.name,
                evalue: error.message,
                traceback: (error.stack ?? "").split("\n"),
              }));
              ws.send(JSON.stringify({ type: "status", cellId: msg.cellId, status: "idle" }));
            }
          } catch {
            // Even JSON.parse of cellId failed — silently drop
          }
        }
      },
    },
  });

  return server;
}
