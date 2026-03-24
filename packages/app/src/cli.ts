#!/usr/bin/env bun
// src/cli.ts — Yeastbook CLI

import { resolve, basename, dirname, join } from "node:path";
import { unlink, mkdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
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

async function autoInstallDeps(notebookPath: string): Promise<void> {
  try {
    const content = await Bun.file(notebookPath).text();
    const notebook = JSON.parse(content);
    const notebookDir = dirname(notebookPath);

    // Restore embedded package.json and bun.lock if no local package.json exists
    const localPkg = join(notebookDir, "package.json");
    if (!existsSync(localPkg) && notebook.metadata?.packageJson) {
      console.log("\x1b[36m📋 Restoring embedded package.json from notebook...\x1b[0m");
      await Bun.write(localPkg, notebook.metadata.packageJson);
      if (notebook.metadata.bunLock) {
        await Bun.write(join(notebookDir, "bun.lock"), notebook.metadata.bunLock);
      }
      const proc = Bun.spawn(["bun", "install"], { cwd: notebookDir, stdout: "inherit", stderr: "inherit" });
      await proc.exited;
      console.log("\x1b[32m✓ Dependencies restored from notebook\x1b[0m");
      return;
    }

    // Fallback: check metadata.dependencies for missing packages
    const deps = notebook.metadata?.dependencies;
    if (!deps || Object.keys(deps).length === 0) return;

    const missing: string[] = [];
    for (const pkg of Object.keys(deps)) {
      try {
        require.resolve(pkg);
      } catch {
        missing.push(`${pkg}@${deps[pkg]}`);
      }
    }

    if (missing.length > 0) {
      console.log(`\x1b[36m📦 Installing ${missing.length} missing dependencies...\x1b[0m`);
      const proc = Bun.spawn(["bun", "add", ...missing], { stdout: "inherit", stderr: "inherit" });
      await proc.exited;
      if (proc.exitCode === 0) {
        console.log(`\x1b[32m✓ Dependencies ready\x1b[0m`);
      } else {
        console.error(`\x1b[33m⚠ Some dependencies failed to install\x1b[0m`);
      }
    }
  } catch {
    // Not a valid notebook or no deps — skip silently
  }
}

/** Resolve -o flag: if target is a directory, append defaultName inside it; otherwise use as file path. */
function resolveOutputPath(target: string, defaultName: string): string {
  const resolved = resolve(target);
  const isDir = target.endsWith("/") || target.endsWith("\\") ||
    (existsSync(resolved) && statSync(resolved).isDirectory());
  return isDir ? join(resolved, defaultName) : resolved;
}

function printUsage(): void {
  console.log("Usage:");
  console.log("  yeastbook new [--ipynb] [--template <name>] [--port <n>] [--no-open]");
  console.log("  yeastbook <file.ybk|file.ipynb> [--port <n>] [--no-open]   Open a notebook");
  console.log("  yeastbook export <file.ybk> [-o dir|file]            Convert .ybk → .ipynb");
  console.log("  yeastbook import <file.ipynb> [-o dir|file]          Convert .ipynb → .ybk");
  console.log("  yeastbook export-script <file.ybk> [-o output.ts]   Export to TypeScript script");
  console.log("  yeastbook strip-outputs <file.ybk> [-o output.ybk]  Strip cell outputs");
  console.log("  yeastbook list-templates                             Show available templates");
  console.log("  yeastbook plugin list|install|remove                 Manage plugins");
  console.log("  yeastbook diff <file> [--staged] [--commit <ref>]   Show notebook diff");
  console.log("  yeastbook diff <old.ybk> <new.ybk>                  Diff two notebooks");
  console.log("  yeastbook diff-text <file>                           Dump notebook as readable text");
  console.log("  yeastbook export-md <file.ybk> [-o dir|file]         Convert .ybk → .ybk.md (readable)");
  console.log("  yeastbook import-md <file.ybk.md> [-o dir|file]     Convert .ybk.md → .ybk");
  console.log("  yeastbook doctor                                     Check system requirements");
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

  // Auto-pick the first notebook (no interactive prompt — breaks with --watch and piped stdio)
  const chosen = notebooks[0]!.path;
  console.log(`Found ${notebooks.length} notebook(s), opening: ${basename(chosen)}`);
  await Bun.write(DEV_NOTEBOOK_FILE, chosen);
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

  await autoInstallDeps(filePath);
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
    console.error("Usage: yeastbook export <file.ybk> [-o dir|file]");
    process.exit(1);
  }
  const { notebook } = await loadNotebook(srcPath);
  const ipynbData = ybkToIpynb(notebook);
  const oIdx = positional.indexOf("-o");
  const defaultDest = join(dirname(srcPath), basename(srcPath, ".ybk") + ".ipynb");
  const destPath = oIdx !== -1 ? resolveOutputPath(positional[oIdx + 1]!, basename(srcPath, ".ybk") + ".ipynb") : defaultDest;
  await mkdir(dirname(destPath), { recursive: true });
  await Bun.write(destPath, JSON.stringify(ipynbData, null, 2) + "\n");
  console.log(`Exported: ${srcPath} → ${destPath}`);
} else if (command === "import") {
  const srcPath = resolve(positional[1] ?? "");
  if (!srcPath || !srcPath.endsWith(".ipynb")) {
    console.error("Usage: yeastbook import <file.ipynb> [-o dir|file]");
    process.exit(1);
  }
  const data: IpynbNotebook = await Bun.file(srcPath).json();
  const ybk = ipynbToYbk(data);
  const oIdx = positional.indexOf("-o");
  const defaultDest = join(dirname(srcPath), basename(srcPath, ".ipynb") + ".ybk");
  const destPath = oIdx !== -1 ? resolveOutputPath(positional[oIdx + 1]!, basename(srcPath, ".ipynb") + ".ybk") : defaultDest;
  await mkdir(dirname(destPath), { recursive: true });
  await Bun.write(destPath, JSON.stringify(ybk, null, 2) + "\n");
  console.log(`Imported: ${srcPath} → ${destPath}`);
} else if (command === "export-md") {
  const { notebookToMarkdown, extractOutputs } = await import("@codepawl/yeastbook-core");
  const srcPath = resolve(positional[1] ?? "");
  if (!srcPath || !srcPath.endsWith(".ybk")) {
    console.error("Usage: yeastbook export-md <file.ybk> [-o dir|file]");
    process.exit(1);
  }
  const ybk = await Bun.file(srcPath).json();
  const md = notebookToMarkdown(ybk);
  const outputs = extractOutputs(ybk);
  const oIdx = positional.indexOf("-o");
  const defaultMdPath = srcPath.replace(/\.ybk$/, ".ybk.md");
  const mdPath = oIdx !== -1 ? resolveOutputPath(positional[oIdx + 1]!, basename(srcPath, ".ybk") + ".ybk.md") : defaultMdPath;
  const outPath = mdPath.replace(/\.ybk\.md$/, ".ybk.outputs.json");
  await mkdir(dirname(mdPath), { recursive: true });
  await Bun.write(mdPath, md);
  if (Object.keys(outputs).length > 0) {
    await Bun.write(outPath, JSON.stringify(outputs, null, 2) + "\n");
  }
  console.log(`Exported: ${srcPath} → ${mdPath}`);
  if (Object.keys(outputs).length > 0) console.log(`Outputs: ${outPath}`);
  process.exit(0);

} else if (command === "import-md") {
  const { markdownToNotebook } = await import("@codepawl/yeastbook-core");
  const srcPath = resolve(positional[1] ?? "");
  if (!srcPath || !srcPath.endsWith(".ybk.md")) {
    console.error("Usage: yeastbook import-md <file.ybk.md> [-o dir|file]");
    process.exit(1);
  }
  const md = await Bun.file(srcPath).text();
  const outputsSidePath = srcPath.replace(/\.ybk\.md$/, ".ybk.outputs.json");
  let outputsJson: string | undefined;
  try { outputsJson = await Bun.file(outputsSidePath).text(); } catch {}
  const notebook = markdownToNotebook(md, outputsJson);
  const oIdx = positional.indexOf("-o");
  const defaultDest = srcPath.replace(/\.ybk\.md$/, ".ybk");
  const destPath = oIdx !== -1 ? resolveOutputPath(positional[oIdx + 1]!, basename(srcPath).replace(/\.ybk\.md$/, ".ybk")) : defaultDest;
  await mkdir(dirname(destPath), { recursive: true });
  await Bun.write(destPath, JSON.stringify(notebook, null, 2) + "\n");
  console.log(`Imported: ${srcPath} → ${destPath}`);
  process.exit(0);

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
} else if (command === "doctor") {
  console.log("\x1b[1m🩺 Yeastbook Doctor\x1b[0m\n");

  // Bun
  try {
    const bunVer = Bun.version;
    console.log(`\x1b[32m✓\x1b[0m Bun: v${bunVer}`);
  } catch {
    console.log("\x1b[31m✗\x1b[0m Bun: not found");
  }

  // Python
  try {
    const pyProc = Bun.spawnSync(["python3", "--version"]);
    if (pyProc.exitCode === 0) {
      console.log(`\x1b[32m✓\x1b[0m Python: ${pyProc.stdout.toString().trim()}`);
    } else {
      console.log("\x1b[33m!\x1b[0m Python: not found (optional, needed for Python cells)");
    }
  } catch {
    console.log("\x1b[33m!\x1b[0m Python: not found (optional, needed for Python cells)");
  }

  // Venv
  const venvPath = join(process.cwd(), ".venv");
  if (existsSync(venvPath)) {
    const isWindows = process.platform === "win32";
    const pyBin = join(venvPath, isWindows ? "Scripts" : "bin", isWindows ? "python.exe" : "python3");
    console.log(`\x1b[32m✓\x1b[0m Venv: ${venvPath}${existsSync(pyBin) ? ` (${pyBin})` : " (missing python binary)"}`);
  } else {
    console.log("\x1b[33m!\x1b[0m Venv: not found (create with: python3 -m venv .venv)");
  }

  // AI/ML Libraries
  console.log("\n\x1b[1mPython Libraries:\x1b[0m");
  const aiLibs = ["torch", "numpy", "matplotlib", "stable_worldmodel"];
  for (const lib of aiLibs) {
    try {
      const proc = Bun.spawnSync(["python3", "-c", `import ${lib}; print(getattr(${lib}, '__version__', 'installed'))`]);
      if (proc.exitCode === 0) {
        console.log(`  \x1b[32m✓\x1b[0m ${lib}: ${proc.stdout.toString().trim()}`);
      } else {
        console.log(`  \x1b[33m!\x1b[0m ${lib}: not installed`);
      }
    } catch {
      console.log(`  \x1b[33m!\x1b[0m ${lib}: not installed`);
    }
  }

  // Port check
  console.log("\n\x1b[1mSystem:\x1b[0m");
  try {
    const testPort = await findFreePort(3000);
    console.log(`  \x1b[32m✓\x1b[0m Port: ${testPort} available`);
  } catch {
    console.log(`  \x1b[31m✗\x1b[0m Port: no free port found (3000-3009)`);
  }

  // Write permission
  try {
    await checkWritePermission();
    console.log(`  \x1b[32m✓\x1b[0m Write: current directory writable`);
  } catch {
    console.log(`  \x1b[31m✗\x1b[0m Write: no write permission in current directory`);
  }

  console.log("");
  process.exit(0);

} else if (command === "init") {
  const dir = positional[1] || ".";
  const absDir = resolve(dir);
  const dirName = basename(absDir);

  console.log(`\x1b[1m📦 Initializing Yeastbook project: ${dirName}\x1b[0m\n`);

  // 1. Create directory
  await mkdir(absDir, { recursive: true });

  // 2. Create Python venv
  console.log("Creating Python venv...");
  try {
    const venvProc = Bun.spawn(["python3", "-m", "venv", join(absDir, ".venv")], {
      stdout: "inherit", stderr: "inherit",
    });
    await venvProc.exited;
    console.log("\x1b[32m✓\x1b[0m .venv created");

    // 3. Install base packages
    const isWindows = process.platform === "win32";
    const pip = join(absDir, ".venv", isWindows ? "Scripts" : "bin", isWindows ? "pip.exe" : "pip");
    console.log("Installing numpy, matplotlib...");
    const pipProc = Bun.spawn([pip, "install", "-q", "numpy", "matplotlib"], {
      stdout: "inherit", stderr: "inherit",
    });
    await pipProc.exited;
    console.log("\x1b[32m✓\x1b[0m Python packages installed");
  } catch {
    console.log("\x1b[33m!\x1b[0m Python not found — skipping venv setup");
  }

  // 4. Create demo notebook
  const demoPath = join(absDir, "demo.ybk");
  if (!existsSync(demoPath)) {
    const demo = createEmptyYbk();
    demo.metadata.title = `${dirName} — Demo`;
    demo.cells = [
      { id: "intro", type: "markdown", source: `# ${dirName}\n\nWelcome to your Yeastbook project! Press **Shift+Enter** to run cells.` },
      { id: "ts-demo", type: "code", source: `// TypeScript cell — runs in Bun\nconst greeting = "Hello from Yeastbook!"\nconsole.log(greeting)\n\n;({ __type: "chart", data: [4, 8, 15, 16, 23, 42], config: { chartType: "bar", title: "The Numbers" } })` },
      { id: "py-demo", type: "code", source: `import numpy as np\nimport matplotlib.pyplot as plt\n\nx = np.linspace(0, 2 * np.pi, 100)\nplt.figure(figsize=(8, 4))\nplt.plot(x, np.sin(x), label="sin")\nplt.plot(x, np.cos(x), label="cos")\nplt.legend()\nplt.title("Trigonometry")`, metadata: { language: "python" } },
    ];
    await Bun.write(demoPath, JSON.stringify(demo, null, 2));
    console.log("\x1b[32m✓\x1b[0m demo.ybk created");
  }

  // 5. Create .gitignore
  const gitignorePath = join(absDir, ".gitignore");
  if (!existsSync(gitignorePath)) {
    await Bun.write(gitignorePath, ".venv/\nnode_modules/\n*.lock\n");
    console.log("\x1b[32m✓\x1b[0m .gitignore created");
  }

  console.log(`\n\x1b[32mDone!\x1b[0m Run:\n  cd ${dir}\n  yeastbook demo.ybk\n`);
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
  await autoInstallDeps(filePath);
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
