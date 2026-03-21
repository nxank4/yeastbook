// src/server.ts — Bun HTTP+WebSocket server for notebook execution

import { resolve, basename, dirname, join, extname } from "node:path";
import { homedir } from "node:os";
import { rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { assets } from "./assets.ts";
import { Notebook } from "./notebook.ts";
import { executeCode } from "./kernel/execute.ts";
import { loadNotebook as loadNb, ybkToIpynb, detectFormat, createEmptyYbk } from "./format.ts";
import type { Settings } from "./ui/types.ts";
import { DEFAULT_SETTINGS } from "./ui/types.ts";

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
      };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

async function saveSettings(settings: Settings): Promise<void> {
  await mkdir(SETTINGS_DIR, { recursive: true });
  await Bun.write(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

interface ServerState {
  notebook: Notebook;
  filePath: string;
  executionCount: number;
  context: Record<string, unknown>;
}

function isDevMode(): boolean {
  // In dev mode, dist/ directory exists alongside source. In compiled binary, it won't.
  return existsSync(resolve(import.meta.dirname!, "../dist"));
}

export async function startServer(filePath: string, port: number = 3000) {
  const absPath = resolve(filePath);
  const notebook = await Notebook.load(absPath);

  const settings = await loadSettings();

  const state: ServerState = {
    notebook,
    filePath: absPath,
    executionCount: 0,
    context: {},
  };

  const distDir = resolve(import.meta.dirname!, "../dist");

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
        if (isDevMode()) {
          const safePath = url.pathname.slice(1).replace(/\.\./g, "");
          const filePath = resolve(distDir, safePath);
          const ext = safePath.substring(safePath.lastIndexOf("."));
          const contentType = CONTENT_TYPES[ext] || "application/octet-stream";
          return new Response(Bun.file(filePath), {
            headers: { "Content-Type": contentType },
          });
        }
        const asset = assets[url.pathname];
        if (asset) {
          return new Response(asset.content, {
            headers: { "Content-Type": asset.mimeType },
          });
        }
      }
      return undefined;
    },
    routes: {
      "/": async () => {
        if (isDevMode()) {
          return new Response(Bun.file(resolve(distDir, "index.html")), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
        const asset = assets["/"];
        return new Response(asset.content, {
          headers: { "Content-Type": asset.mimeType },
        });
      },
      "/api/notebook": {
        GET: () => Response.json({ ...state.notebook.toJSON(), filePath: state.filePath, fileName: basename(state.filePath), fileFormat: state.notebook.format }),
      },
      "/api/cells": {
        POST: async (req) => {
          const body = await req.json() as { type: "code" | "markdown"; source?: string };
          const id = state.notebook.addCell(body.type, body.source ?? "");
          await state.notebook.save(state.filePath);
          return Response.json({ id });
        },
      },
      "/api/cells/:id": {
        DELETE: async (req) => {
          state.notebook.deleteCell(req.params.id);
          await state.notebook.save(state.filePath);
          return Response.json({ ok: true });
        },
        PATCH: async (req) => {
          const body = await req.json() as { source: string };
          state.notebook.updateCellSource(req.params.id, body.source);
          await state.notebook.save(state.filePath);
          return Response.json({ ok: true });
        },
      },
      "/api/cells/:id/move": {
        POST: async (req) => {
          const body = await req.json() as { direction: "up" | "down" };
          state.notebook.moveCell(req.params.id, body.direction);
          await state.notebook.save(state.filePath);
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
          const { detectFormat } = await import("./format.ts");
          state.notebook.format = detectFormat(newPath);
          return Response.json({ fileName: basename(newPath), fileFormat: state.notebook.format });
        },
      },
      "/api/restart": {
        POST: () => {
          state.context = {};
          state.executionCount = 0;
          return Response.json({ ok: true });
        },
      },
      "/api/save": {
        POST: async () => {
          await state.notebook.save(state.filePath);
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
        POST: async () => {
          const name = basename(state.filePath).replace(/\.(ybk|ipynb)$/, "");
          const destPath = join(dirname(state.filePath), name + ".ipynb");
          state.notebook.syncForExport();
          const ipynb = ybkToIpynb(state.notebook.ybk);
          await Bun.write(destPath, JSON.stringify(ipynb, null, 2) + "\n");
          return Response.json({ path: destPath, fileName: basename(destPath) });
        },
      },
      "/api/export/ybk": {
        POST: async () => {
          const name = basename(state.filePath).replace(/\.(ybk|ipynb)$/, "");
          const destPath = join(dirname(state.filePath), name + ".ybk");
          state.notebook.syncForExport();
          await Bun.write(destPath, JSON.stringify(state.notebook.ybk, null, 2) + "\n");
          return Response.json({ path: destPath, fileName: basename(destPath) });
        },
      },
      "/api/cells/insert": {
        POST: async (req) => {
          const body = await req.json() as { type: "code" | "markdown"; source?: string; afterId?: string };
          const id = state.notebook.insertCellAfter(body.type, body.source ?? "", body.afterId);
          await state.notebook.save(state.filePath);
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
          });
        },
        POST: async (req) => {
          const body = await req.json() as Partial<Settings>;
          Object.assign(settings.editor, body.editor);
          Object.assign(settings.appearance, body.appearance);
          Object.assign(settings.execution, body.execution);
          await saveSettings(settings);
          const pkg = await Bun.file(resolve(import.meta.dirname!, "../package.json")).json();
          return Response.json({
            ...settings,
            version: pkg.version,
            bunVersion: Bun.version,
          });
        },
      },
    },
    websocket: {
      open() {},
      async message(ws, message) {
        try {
          const msg = JSON.parse(message as string) as
            | { type: "execute"; cellId: string; code: string }
            | { type: "interrupt" };

          if (msg.type === "execute") {
            ws.send(JSON.stringify({ type: "status", cellId: msg.cellId, status: "busy" }));

            state.executionCount++;
            const result = await executeCode(msg.code, state.context);

            state.notebook.updateCellSource(msg.cellId, msg.code);
            state.notebook.setCellOutput(msg.cellId, state.executionCount, {
              value: result.value !== undefined ? Bun.inspect(result.value) : undefined,
              stdout: result.stdout,
              stderr: result.stderr,
              error: result.error,
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
            if (result.error) {
              ws.send(JSON.stringify({
                type: "error",
                cellId: msg.cellId,
                ename: result.error.ename,
                evalue: result.error.evalue,
                traceback: result.error.traceback,
              }));
            } else if (result.value !== undefined) {
              ws.send(JSON.stringify({
                type: "result",
                cellId: msg.cellId,
                value: Bun.inspect(result.value),
                executionCount: state.executionCount,
              }));
            }

            ws.send(JSON.stringify({ type: "status", cellId: msg.cellId, status: "idle", executionCount: state.executionCount }));
            await state.notebook.save(state.filePath);
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
