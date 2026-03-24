#!/usr/bin/env bun
// src/cli.ts — Yeastbook CLI

import { resolve, basename, dirname, join } from "node:path";
import { unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { startServer } from "./server.ts";
import { listNotebooks } from "./dashboard.ts";
import { loadNotebook, saveNotebook, ybkToIpynb, ipynbToYbk, createEmptyYbk } from "@codepawl/yeastbook-core";
import type { IpynbNotebook } from "@codepawl/yeastbook-core";
import { diffNotebook, diffText } from "./diff.ts";
import { exportToScript, stripOutputs } from "./exporter.ts";
import { templates } from "./templates.ts";

// ---------------------------------------------------------------------------
// Flag parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  positional: string[];
  port: number;
  noOpen: boolean;
  ipynb: boolean;
  dev: boolean;
  template: string | null;
  dir: string | null;
}

function parseFlags(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  let port = parseInt(process.env.PORT ?? "3000", 10);
  let noOpen = false;
  let ipynb = false;
  let dev = false;
  let template: string | null = null;
  let dir: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port") {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        port = parseInt(next, 10);
        i++;
      } else {
        console.error("Error: --port requires a numeric argument.");
        process.exit(1);
      }
    } else if (arg!.startsWith("--port=")) {
      port = parseInt(arg!.slice("--port=".length), 10);
    } else if (arg === "--no-open") {
      noOpen = true;
    } else if (arg === "--ipynb") {
      ipynb = true;
    } else if (arg === "--dev") {
      dev = true;
    } else if (arg === "--template") {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        template = next;
        i++;
      }
    } else if (arg === "--dir") {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        dir = next;
        i++;
      }
    } else {
      positional.push(arg!);
    }
  }

  return { positional, port, noOpen, ipynb, dev, template, dir };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function checkWritePermission(): Promise<void> {
  const testFile = resolve(".yeastbook-write-test");
  try {
    await Bun.write(testFile, "");
    await unlink(testFile);
  } catch {
    console.error("Error: No write permission in current directory.");
    process.exit(1);
  }
}

function printUsage(): void {
  console.log("Usage:");
  console.log("  yeastbook new [--ipynb] [--template <name>] [--port <n>] [--no-open]");
  console.log("  yeastbook <file.ybk|file.ipynb> [--port <n>] [--no-open]   Open a notebook");
  console.log("  yeastbook export <file.ybk>                         Convert .ybk → .ipynb");
  console.log("  yeastbook import <file.ipynb>                       Convert .ipynb → .ybk");
  console.log("  yeastbook export-script <file.ybk> [-o output.ts]   Export to TypeScript script");
  console.log("  yeastbook strip-outputs <file.ybk> [-o output.ybk]  Strip cell outputs");
  console.log("  yeastbook list-templates                             Show available templates");
  console.log("  yeastbook plugin list|install|remove                 Manage plugins");
  console.log("  yeastbook diff <file> [--staged] [--commit <ref>]   Show notebook diff");
  console.log("  yeastbook diff <old.ybk> <new.ybk>                  Diff two notebooks");
  console.log("  yeastbook diff-text <file>                           Dump notebook as readable text");
  console.log("");
  console.log("Options:");
  console.log("  --port <n>        Port to listen on (default: $PORT or 3000)");
  console.log("  --no-open         Do not open browser after starting server");
  console.log("  --ipynb           Use .ipynb format (with `new` command)");
  console.log("  --template <name> Use a template (with `new` command)");
  console.log("  --dir <path>      Directory for new notebooks (default: cwd)");
  console.log("  --dev             Dev mode: serve from dist/, watch for UI changes");
}

const DEV_NOTEBOOK_FILE = resolve(".yeastbook-dev-notebook");

async function promptDevNotebook(searchDir: string = process.cwd()): Promise<string | null> {
  // On --watch restart, reuse the previously chosen notebook
  try {
    const saved = await Bun.file(DEV_NOTEBOOK_FILE).text();
    const trimmed = saved.trim();
    if (trimmed && existsSync(trimmed)) {
      return trimmed;
    }
  } catch {}

  const notebooks = await listNotebooks(searchDir);
  if (notebooks.length === 0) return null;

  console.log(`\nExisting notebooks in ${searchDir}:`);
  notebooks.forEach((nb, i) => {
    const size = (nb.size / 1024).toFixed(1);
    console.log(`  ${i + 1}. ${nb.name} (${size} KB)`);
  });
  console.log(`  ${notebooks.length + 1}. Create new notebook`);
  console.log("");

  process.stdout.write("Choose [1]: ");
  const response = await new Promise<string>((resolve) => {
    const stdin = process.stdin;
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.once("data", (data: string) => {
      stdin.pause();
      resolve(data.trim());
    });
  });

  const choice = parseInt(response || "1", 10);
  let chosen: string | null = null;
  if (choice >= 1 && choice <= notebooks.length) {
    chosen = notebooks[choice - 1]!.path;
  }

  // Save choice so --watch restarts don't re-prompt
  if (chosen) {
    await Bun.write(DEV_NOTEBOOK_FILE, chosen);
  }
  return chosen;
}

async function findFreePort(start = 3000): Promise<number> {
  for (let port = start; port < start + 10; port++) {
    try {
      const server = Bun.serve({ port, fetch() { return new Response(); } });
      server.stop();
      return port;
    } catch {
      continue;
    }
  }
  throw new Error(`No free port found between ${start}-${start + 9}`);
}

// ---------------------------------------------------------------------------
// Plugin subcommand
// ---------------------------------------------------------------------------

const pluginsBaseDir = join(homedir(), ".yeastbook", "plugins");

async function ensurePluginsDir(): Promise<void> {
  await mkdir(pluginsBaseDir, { recursive: true });
}

async function pluginList(): Promise<void> {
  await ensurePluginsDir();
  const { PluginLoader } = await import("./plugins/loader.ts");
  const loader = new PluginLoader(pluginsBaseDir);
  await loader.loadAll();
  const plugins = loader.getPlugins();
  if (plugins.length === 0) {
    console.log("No plugins installed.");
    console.log(`Plugin directory: ${pluginsBaseDir}`);
  } else {
    console.log("Installed plugins:");
    for (const p of plugins) {
      const renderers = (p.renderers ?? []).map((r) => r.type).join(", ");
      console.log(`  ${p.name}@${p.version}${renderers ? ` (renderers: ${renderers})` : ""}`);
    }
  }
}

async function pluginInstall(pkg: string): Promise<void> {
  if (!pkg) {
    console.error("Usage: yeastbook plugin install <pkg>");
    process.exit(1);
  }
  const yeastbookDir = join(homedir(), ".yeastbook");
  await mkdir(yeastbookDir, { recursive: true });
  await ensurePluginsDir();

  console.log(`Installing plugin: ${pkg}`);
  const proc = Bun.spawn(["bun", "add", pkg], {
    cwd: yeastbookDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error(`Failed to install plugin: ${pkg}`);
    process.exit(exitCode);
  }

  // Derive a safe file name from the package name (strip scope/version)
  const name = pkg.replace(/^@[^/]+\//, "").replace(/[@/].*$/, "");
  const pluginFile = join(pluginsBaseDir, `${name}.ts`);
  await Bun.write(pluginFile, `export { default } from "${pkg}";\n`);
  console.log(`Plugin installed: ${name}`);
}

async function pluginRemove(name: string): Promise<void> {
  if (!name) {
    console.error("Usage: yeastbook plugin remove <name>");
    process.exit(1);
  }
  await ensurePluginsDir();
  const candidates = [`${name}.ts`, `${name}.js`];
  let removed = false;
  for (const candidate of candidates) {
    const filePath = join(pluginsBaseDir, candidate);
    try {
      await unlink(filePath);
      console.log(`Plugin removed: ${name}`);
      removed = true;
      break;
    } catch {
      // try next
    }
  }
  if (!removed) {
    console.error(`Plugin not found: ${name}`);
    process.exit(1);
  }
}

async function handlePlugin(subArgs: string[]): Promise<void> {
  const sub = subArgs[0];
  if (!sub || sub === "help") {
    console.log("Usage:");
    console.log("  yeastbook plugin list");
    console.log("  yeastbook plugin install <pkg>");
    console.log("  yeastbook plugin remove <name>");
    process.exit(0);
  }

  if (sub === "list") {
    await pluginList();
  } else if (sub === "install") {
    await pluginInstall(subArgs[1] ?? "");
  } else if (sub === "remove") {
    await pluginRemove(subArgs[1] ?? "");
  } else {
    console.error(`Unknown plugin subcommand: ${sub}`);
    console.error("Available: list, install, remove");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

const { positional, port, noOpen, ipynb, dev, template, dir } = parseFlags(process.argv.slice(2));
const command = positional[0];

if (command === "help" || process.argv.includes("--help") || process.argv.includes("-h")) {
  printUsage();
  process.exit(0);
}

// stdin mode for git filter (strip-notebook-outputs)
if (process.argv.includes("--stdin")) {
  const input = await new Response(Bun.stdin.stream()).text();
  const notebook = JSON.parse(input);
  const stripped = {
    ...notebook,
    cells: (notebook.cells ?? []).map((c: any) => ({
      ...c, outputs: [], executionCount: null,
    })),
  };
  process.stdout.write(JSON.stringify(stripped, null, 2));
  process.exit(0);
}

if (!command || command === "new") {
  const targetDir = dir ? resolve(dir) : process.cwd();
  if (dir) {
    await mkdir(targetDir, { recursive: true });
  }
  await checkWritePermission();

  let filePath: string;
  if (dev) {
    const existing = await promptDevNotebook(targetDir);
    if (existing) {
      filePath = existing;
      console.log(`Opening notebook: ${filePath}`);
    } else {
      const ext = ipynb ? ".ipynb" : ".ybk";
      filePath = resolve(targetDir, `notebook-${Date.now()}${ext}`);
      console.log(`Creating new notebook: ${filePath}`);
    }
  } else {
    const ext = ipynb ? ".ipynb" : ".ybk";
    filePath = resolve(targetDir, `notebook-${Date.now()}${ext}`);
    console.log(`Creating new notebook: ${filePath}`);
  }

  if (template) {
    const tmpl = templates[template];
    if (!tmpl) {
      console.error(`Unknown template: ${template}`);
      console.error(`Available: ${Object.keys(templates).join(", ")}`);
      process.exit(1);
    }
    await Bun.write(filePath, JSON.stringify(tmpl, null, 2) + "\n");
    console.log(`Using template: ${template}`);
  }

  const actualPort = await findFreePort(port);
  const server = await startServer(filePath, actualPort, dev);
  console.log(`Yeastbook running at http://localhost:${server.port}`);
  console.log(`Notebook: ${filePath}`);
  process.on("SIGINT", async () => {
    console.log("\nShutting down yeastbook...");
    server.stop();
    if (dev) try { await unlink(DEV_NOTEBOOK_FILE); } catch {}
    process.exit(0);
  });
} else if (command === "export") {
  const srcPath = resolve(positional[1] ?? "");
  if (!srcPath || !srcPath.endsWith(".ybk")) {
    console.error("Usage: yeastbook export <file.ybk>");
    process.exit(1);
  }
  const { notebook } = await loadNotebook(srcPath);
  const ipynbData = ybkToIpynb(notebook);
  const destPath = join(dirname(srcPath), basename(srcPath, ".ybk") + ".ipynb");
  await Bun.write(destPath, JSON.stringify(ipynbData, null, 2) + "\n");
  console.log(`Exported: ${srcPath} → ${destPath}`);
} else if (command === "import") {
  const srcPath = resolve(positional[1] ?? "");
  if (!srcPath || !srcPath.endsWith(".ipynb")) {
    console.error("Usage: yeastbook import <file.ipynb>");
    process.exit(1);
  }
  const data: IpynbNotebook = await Bun.file(srcPath).json();
  const ybk = ipynbToYbk(data);
  const destPath = join(dirname(srcPath), basename(srcPath, ".ipynb") + ".ybk");
  await Bun.write(destPath, JSON.stringify(ybk, null, 2) + "\n");
  console.log(`Imported: ${srcPath} → ${destPath}`);
} else if (command === "install") {
  const srcPath = resolve(positional[1] ?? "");
  if (!srcPath) {
    console.error("Usage: yeastbook install <file.ybk>");
    process.exit(1);
  }
  const { notebook } = await loadNotebook(srcPath);
  const deps = notebook.metadata.dependencies ?? {};
  const entries = Object.entries(deps);
  if (entries.length === 0) {
    console.log("No dependencies found in notebook.");
    process.exit(0);
  }
  console.log(`\x1b[36m📦 Installing ${entries.length} dependencies...\x1b[0m`);
  const pkgs = entries.map(([pkg, ver]) => `${pkg}@${ver}`);
  const proc = Bun.spawn(["bun", "add", ...pkgs], { stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code === 0) {
    console.log(`\x1b[32m✓ All dependencies installed\x1b[0m`);
  } else {
    console.error(`\x1b[31m✗ Install failed (exit code ${code})\x1b[0m`);
    process.exit(1);
  }
  process.exit(0);
} else if (command === "plugin") {
  await handlePlugin(positional.slice(1));
} else if (command === "export-script") {
  const filePath = positional[1];
  if (!filePath) {
    console.error("Usage: yeastbook export-script <file.ybk> [-o output.ts]");
    process.exit(1);
  }
  const oIdx = positional.indexOf("-o");
  const outputPath = oIdx !== -1
    ? positional[oIdx + 1]!
    : filePath.replace(/\.(ybk|ipynb)$/, ".ts");
  await exportToScript(resolve(filePath), outputPath);
  process.exit(0);
} else if (command === "strip-outputs") {
  const filePath = positional[1];
  if (!filePath) {
    console.error("Usage: yeastbook strip-outputs <file.ybk> [-o output.ybk]");
    process.exit(1);
  }
  const oIdx = positional.indexOf("-o");
  const outputPath = oIdx !== -1 ? positional[oIdx + 1]! : filePath;
  await stripOutputs(resolve(filePath), resolve(outputPath));
  process.exit(0);
} else if (command === "list-templates") {
  console.log("Available templates:");
  for (const name of Object.keys(templates)) {
    console.log(`  ${name}`);
  }
  process.exit(0);
} else if (command === "diff") {
  const args = process.argv.slice(3);
  const filePath = args.find((a) => !a.startsWith("--"));
  if (!filePath) {
    console.error("Usage: yeastbook diff <file.ybk> [--staged] [--commit <ref>] [other.ybk]");
    process.exit(1);
  }
  const staged = args.includes("--staged");
  const commitIdx = args.indexOf("--commit");
  const commit = commitIdx !== -1 ? args[commitIdx + 1] : undefined;
  const otherFile = args.find((a) => !a.startsWith("--") && a !== filePath);
  await diffNotebook(filePath, { staged, commit, otherFile });
  process.exit(0);
} else if (command === "diff-text") {
  const filePath = positional[1];
  if (!filePath) {
    console.error("Usage: yeastbook diff-text <file.ybk>");
    process.exit(1);
  }
  await diffText(resolve(filePath));
  process.exit(0);
} else {
  // Open existing notebook by path
  await checkWritePermission();
  const filePath = resolve(command);
  const actualPort = await findFreePort(port);
  const server = await startServer(filePath, actualPort, dev);
  console.log(`Yeastbook running at http://localhost:${server.port}`);
  console.log(`Notebook: ${filePath}`);
  process.on("SIGINT", () => {
    console.log("\nShutting down yeastbook...");
    server.stop();
    process.exit(0);
  });
}
