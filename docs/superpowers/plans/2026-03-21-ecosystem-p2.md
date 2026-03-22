# P2 Ecosystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three ecosystem features to yeastbook: Bun Shell integration + file watcher for live collaboration, a plugin system for custom output renderers, and a VS Code extension for opening .ybk files in the editor.

**Architecture:** Three feature branches off `staging`, one per pillar. Bun Shell + file watcher goes first (touches core kernel/server). Plugin system second (new subsystem). VS Code extension last (separate package, depends on CLI flags from pillar 1). Each branch merged to staging when complete.

**Tech Stack:** Bun, React, VS Code Extension API, node:fs watch API

**Branch Strategy:**
- `feat/bun-shell-watcher` - Bun Shell + file watcher (Tasks 1-5)
- `feat/plugin-system` - Plugin system (Tasks 6-10)
- `feat/vscode-extension` - VS Code extension (Tasks 11-14)

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/watcher.ts` | Watch notebook file for external changes with debounce |
| `src/plugins/types.ts` | Plugin and OutputRendererPlugin interfaces |
| `src/plugins/loader.ts` | Load plugins from ~/.yeastbook/plugins/, find matching renderers |
| `src/plugins/builtin/vega.ts` | Reference Vega-Lite renderer plugin |
| `src/ui/components/outputs/PluginRenderer.tsx` | Dynamic renderer loading for plugin output types |
| `packages/vscode-yeastbook/package.json` | VS Code extension manifest |
| `packages/vscode-yeastbook/tsconfig.json` | TypeScript config |
| `packages/vscode-yeastbook/src/extension.ts` | Extension entry point |
| `packages/vscode-yeastbook/src/YbkEditorProvider.ts` | Custom editor embedding yeastbook in WebView |
| `packages/vscode-yeastbook/src/KernelManager.ts` | Manage yeastbook server processes |
| `tests/watcher.test.ts` | File watcher tests |
| `tests/plugin.test.ts` | Plugin loader tests |
| `tests/shell.test.ts` | Bun Shell availability tests |

### Modified Files
| File | Changes |
|------|---------|
| `src/cli.ts` | Add --port, --no-open flags; plugin subcommands |
| `src/kernel/execute.ts` | Expose $ and Bun in cell globalThis |
| `src/server.ts` | Track WS clients, integrate watcher, plugin API endpoints |
| `src/ui/types.ts` | Add notebook_updated and plugin RichOutput variants |
| `src/ui/app.tsx` | Handle notebook_updated message |
| `src/ui/components/CellOutput.tsx` | Add plugin renderer case |

---

## Branch 1: feat/bun-shell-watcher

### Task 1: CLI Flags (--port, --no-open)

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Replace src/cli.ts with flag-aware version**

The current CLI uses simple positional arg parsing. Replace with a proper flag parser that supports `--port <n>`, `--no-open`, and a `plugin` subcommand stub. See the full replacement code below.

Key changes from existing cli.ts:
- New `parseFlags()` function separates `--port`, `--no-open`, `--ipynb` from positional args
- Port comes from `--port` flag, falling back to `PORT` env var, then 3000
- Plugin subcommand stub (implemented fully in Task 10)
- Usage text updated with new options
- Add `homedir` and `mkdir` imports for plugin commands

Full file: replace `src/cli.ts` entirely. The new code keeps all existing commands (new, export, import, open) working identically, just adds the flag parsing layer.

- [ ] **Step 2: Run existing tests**

```bash
bun test
```

Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add --port, --no-open CLI flags and plugin command stub"
```

---

### Task 2: Bun Shell in Cell Context

**Files:**
- Modify: `src/kernel/execute.ts`
- Create: `tests/shell.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/shell.test.ts`:

```ts
import { test, expect, describe } from "bun:test";
import { executeCode } from "../src/kernel/execute.ts";

describe("Bun Shell in cells", () => {
  test("$ is available in cell context", async () => {
    const ctx: Record<string, unknown> = {};
    const result = await executeCode("typeof $", ctx);
    expect(result.error).toBeUndefined();
    expect(result.value).toBe("function");
  });

  test("Bun is available in cell context", async () => {
    const ctx: Record<string, unknown> = {};
    const result = await executeCode("typeof Bun", ctx);
    expect(result.error).toBeUndefined();
    expect(result.value).toBe("object");
  });

  test("Bun Shell executes commands", async () => {
    const ctx: Record<string, unknown> = {};
    const result = await executeCode("await $`echo hello`.text()", ctx);
    expect(result.error).toBeUndefined();
    expect(result.value).toContain("hello");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/shell.test.ts
```

Expected: FAIL

- [ ] **Step 3: Add $ and Bun to execute.ts**

In `src/kernel/execute.ts`, add import at top:

```ts
import { $ } from "bun";
```

Before `// Inject context into globalThis`, add:

```ts
  // Expose Bun Shell and Bun APIs in cell context
  (globalThis as any).$ = $;
  (globalThis as any).Bun = Bun;
```

- [ ] **Step 4: Run tests**

```bash
bun test tests/shell.test.ts
```

Expected: 3/3 PASS

- [ ] **Step 5: Commit**

```bash
git add src/kernel/execute.ts tests/shell.test.ts
git commit -m "feat: expose Bun Shell and Bun APIs in cell context"
```

---

### Task 3: File Watcher

**Files:**
- Create: `src/watcher.ts`
- Create: `tests/watcher.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/watcher.test.ts`:

```ts
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { watchNotebook, createOwnWriteMarker } from "../src/watcher.ts";

describe("watchNotebook", () => {
  let tempDir: string;
  let testFile: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ybk-watcher-"));
    testFile = join(tempDir, "test.ybk");
    await Bun.write(testFile, JSON.stringify({ cells: [] }));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("triggers callback on external file change", async () => {
    let triggered = false;
    const stop = watchNotebook(testFile, () => { triggered = true; });
    await Bun.sleep(100);
    await Bun.write(testFile, JSON.stringify({ cells: [{ id: "1" }] }));
    await Bun.sleep(400);
    expect(triggered).toBe(true);
    stop();
  });

  test("debounces rapid changes", async () => {
    let callCount = 0;
    const stop = watchNotebook(testFile, () => { callCount++; });
    await Bun.sleep(100);
    await Bun.write(testFile, "a");
    await Bun.sleep(50);
    await Bun.write(testFile, "b");
    await Bun.sleep(50);
    await Bun.write(testFile, "c");
    await Bun.sleep(400);
    expect(callCount).toBe(1);
    stop();
  });

  test("markOwnWrite prevents callback", async () => {
    let triggered = false;
    const marker = createOwnWriteMarker();
    const stop = watchNotebook(testFile, () => { triggered = true; }, marker);
    await Bun.sleep(100);
    marker.mark();
    await Bun.write(testFile, JSON.stringify({ cells: [{ id: "own" }] }));
    await Bun.sleep(400);
    expect(triggered).toBe(false);
    stop();
  });
});
```

- [ ] **Step 2: Implement the watcher**

Create `src/watcher.ts`:

```ts
// src/watcher.ts -- Watch notebook file for external changes

import { watch, type FSWatcher } from "node:fs";

const DEBOUNCE_MS = 200;

export interface OwnWriteMarker {
  mark(): void;
  check(): boolean;
}

export function createOwnWriteMarker(): OwnWriteMarker {
  let lastOwnWrite = false;
  return {
    mark() { lastOwnWrite = true; },
    check() {
      if (lastOwnWrite) { lastOwnWrite = false; return true; }
      return false;
    },
  };
}

export function watchNotebook(
  filePath: string,
  onExternalChange: () => void,
  ownWriteMarker?: OwnWriteMarker,
): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher;

  try {
    watcher = watch(filePath, () => {
      if (ownWriteMarker?.check()) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(onExternalChange, DEBOUNCE_MS);
    });
  } catch {
    return () => {};
  }

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher.close();
  };
}
```

- [ ] **Step 3: Run tests**

```bash
bun test tests/watcher.test.ts
```

Expected: 3/3 PASS

- [ ] **Step 4: Commit**

```bash
git add src/watcher.ts tests/watcher.test.ts
git commit -m "feat: add file watcher with debounce and own-write suppression"
```

---

### Task 4: Server Watcher Integration + WS Client Tracking

**Files:**
- Modify: `src/server.ts`
- Modify: `src/ui/types.ts`

- [ ] **Step 1: Add notebook_updated WsIncoming variant**

In `src/ui/types.ts`, add to WsIncoming union:

```ts
  | { type: "notebook_updated" }
```

- [ ] **Step 2: Add watcher and client tracking to server.ts**

Import:

```ts
import { watchNotebook, createOwnWriteMarker } from "./watcher.ts";
```

Inside `startServer`, after `state` declaration, add:

```ts
  const clients = new Set<any>();
  const ownWriteMarker = createOwnWriteMarker();

  const stopWatcher = watchNotebook(absPath, async () => {
    try {
      const updated = await Notebook.load(state.filePath);
      state.notebook = updated;
      for (const c of clients) {
        try { c.send(JSON.stringify({ type: "notebook_updated" })); } catch {}
      }
    } catch {}
  }, ownWriteMarker);
```

Update websocket handlers:

```ts
      open(ws) { clients.add(ws); },
      close(ws) { clients.delete(ws); },
```

Add `ownWriteMarker.mark()` before every `state.notebook.save(state.filePath)` call (multiple sites in routes and WS handler).

- [ ] **Step 3: Run all tests**

```bash
bun test
```

- [ ] **Step 4: Commit**

```bash
git add src/server.ts src/ui/types.ts
git commit -m "feat: integrate file watcher and WS client tracking"
```

---

### Task 5: UI External Update Handling + Merge

**Files:**
- Modify: `src/ui/app.tsx`

- [ ] **Step 1: Handle notebook_updated**

In `handleWsMessage` switch, add:

```ts
      case "notebook_updated":
        showToast("Notebook updated externally. Reloading...");
        fetch("/api/notebook").then((r) => r.json()).then(loadNotebookData);
        break;
```

- [ ] **Step 2: Build UI and commit**

```bash
bun run build:ui
git add src/ui/app.tsx
git commit -m "feat: auto-reload UI on external notebook changes"
```

- [ ] **Step 3: Merge to staging**

```bash
git checkout staging && git merge feat/bun-shell-watcher
```

---

## Branch 2: feat/plugin-system

### Task 6: Plugin Types

**Files:**
- Create: `src/plugins/types.ts`

- [ ] **Step 1: Create**

```bash
mkdir -p src/plugins
```

Create `src/plugins/types.ts`:

```ts
export interface YbkPlugin {
  name: string;
  version: string;
  renderers?: OutputRendererPlugin[];
}

export interface OutputRendererPlugin {
  type: string;
  displayName: string;
  canRender(value: unknown): boolean;
  serialize(value: unknown): Record<string, unknown>;
  componentSource?: string;
  componentUrl?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/plugins/types.ts
git commit -m "feat: add plugin type definitions"
```

---

### Task 7: Plugin Loader

**Files:**
- Create: `src/plugins/loader.ts`
- Create: `tests/plugin.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/plugin.test.ts`:

```ts
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { PluginLoader } from "../src/plugins/loader.ts";

describe("PluginLoader", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ybk-plugins-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("loads valid plugin files", async () => {
    await Bun.write(join(tempDir, "test.ts"), `export default { name: "test", version: "1.0.0", renderers: [{
      type: "custom", displayName: "Custom",
      canRender: (v) => typeof v === "object" && v?.__type === "custom",
      serialize: (v) => ({ data: v }),
    }] };`);
    const loader = new PluginLoader(tempDir);
    await loader.loadAll();
    expect(loader.getPlugins()).toHaveLength(1);
  });

  test("skips invalid plugin files", async () => {
    await Bun.write(join(tempDir, "bad.ts"), "export default { invalid: true }");
    const loader = new PluginLoader(tempDir);
    await loader.loadAll();
    expect(loader.getPlugins()).toHaveLength(0);
  });

  test("findRenderer returns matching renderer", async () => {
    await Bun.write(join(tempDir, "t.ts"), `export default { name: "p", version: "1.0.0", renderers: [{
      type: "custom", displayName: "C",
      canRender: (v) => typeof v === "object" && v?.__type === "custom",
      serialize: (v) => ({ data: v }),
    }] };`);
    const loader = new PluginLoader(tempDir);
    await loader.loadAll();
    expect(loader.findRenderer({ __type: "custom" })?.type).toBe("custom");
  });

  test("findRenderer returns null for no match", async () => {
    const loader = new PluginLoader(tempDir);
    await loader.loadAll();
    expect(loader.findRenderer("x")).toBeNull();
  });

  test("loads from non-existent directory", async () => {
    const loader = new PluginLoader(join(tempDir, "nope"));
    await loader.loadAll();
    expect(loader.getPlugins()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Implement loader**

Create `src/plugins/loader.ts`:

```ts
import { readdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { existsSync } from "node:fs";
import type { YbkPlugin, OutputRendererPlugin } from "./types.ts";

function isValidPlugin(obj: unknown): obj is YbkPlugin {
  if (typeof obj !== "object" || obj === null) return false;
  const p = obj as Record<string, unknown>;
  return typeof p.name === "string" && typeof p.version === "string";
}

export class PluginLoader {
  private plugins: YbkPlugin[] = [];
  constructor(private pluginDir: string) {}

  async loadAll(): Promise<void> {
    this.plugins = [];
    if (!existsSync(this.pluginDir)) return;
    let files: string[];
    try { files = await readdir(this.pluginDir); } catch { return; }
    for (const f of files) {
      if (extname(f) !== ".ts" && extname(f) !== ".js") continue;
      try {
        const mod = await import(join(this.pluginDir, f));
        const plugin = mod.default ?? mod;
        if (isValidPlugin(plugin)) this.plugins.push(plugin);
      } catch {}
    }
  }

  registerPlugin(plugin: YbkPlugin): void {
    if (isValidPlugin(plugin)) this.plugins.push(plugin);
  }

  getPlugins(): YbkPlugin[] { return [...this.plugins]; }

  getRenderers(): OutputRendererPlugin[] {
    return this.plugins.flatMap((p) => p.renderers ?? []);
  }

  findRenderer(value: unknown): OutputRendererPlugin | null {
    for (const r of this.getRenderers()) {
      try { if (r.canRender(value)) return r; } catch {}
    }
    return null;
  }
}
```

- [ ] **Step 3: Run tests**

```bash
bun test tests/plugin.test.ts
```

Expected: 5/5 PASS

- [ ] **Step 4: Commit**

```bash
git add src/plugins/loader.ts tests/plugin.test.ts
git commit -m "feat: add plugin loader with file-based discovery"
```

---

### Task 8: Built-in Vega Plugin + Server Integration

**Files:**
- Create: `src/plugins/builtin/vega.ts`
- Modify: `src/server.ts`
- Modify: `src/ui/types.ts`

- [ ] **Step 1: Create reference plugin**

```bash
mkdir -p src/plugins/builtin
```

Create `src/plugins/builtin/vega.ts`:

```ts
import type { YbkPlugin } from "../types.ts";

export default {
  name: "yeastbook-vega",
  version: "0.1.0",
  renderers: [{
    type: "vega",
    displayName: "Vega-Lite Chart",
    canRender: (value: unknown): boolean =>
      typeof value === "object" && value !== null &&
      (value as Record<string, unknown>).__type === "vega",
    serialize: (value: unknown): Record<string, unknown> =>
      ({ spec: (value as Record<string, unknown>).spec }),
    componentSource: `function VegaChart({ data }) {
  return React.createElement("pre", {
    style: { padding: "8px", fontFamily: "monospace", fontSize: "12px" }
  }, JSON.stringify(data.spec, null, 2));
}
VegaChart`,
  }],
} satisfies YbkPlugin;
```

- [ ] **Step 2: Add plugin RichOutput variant**

In `src/ui/types.ts`, add to RichOutput:

```ts
  | { type: "plugin"; pluginType: string; data: Record<string, unknown> }
```

- [ ] **Step 3: Add plugin loader and routes to server**

In `src/server.ts`, add import:

```ts
import { PluginLoader } from "./plugins/loader.ts";
```

After settings loading, add:

```ts
  const pluginLoader = new PluginLoader(join(homedir(), ".yeastbook", "plugins"));
  await pluginLoader.loadAll();
  try {
    pluginLoader.registerPlugin((await import("./plugins/builtin/vega.ts")).default);
  } catch {}
```

Add routes:

```ts
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
    const r = pluginLoader.getRenderers().find((r) => r.type === req.params.type);
    if (!r) return new Response("Not found", { status: 404 });
    if (r.componentSource) return new Response(r.componentSource, {
      headers: { "Content-Type": "text/javascript; charset=utf-8" },
    });
    if (r.componentUrl) return Response.redirect(r.componentUrl);
    return new Response("No component", { status: 404 });
  },
},
```

In WS handler, after `const richOutput = detectOutputType(result.value);`, add plugin check:

```ts
              let finalOutput = richOutput;
              if (!richOutput || richOutput.type === "json" || richOutput.type === "text") {
                const pr = pluginLoader.findRenderer(result.value);
                if (pr) {
                  try {
                    finalOutput = { type: "plugin", pluginType: pr.type, data: pr.serialize(result.value) } as any;
                  } catch {}
                }
              }
```

Use `finalOutput` in the ws.send call.

- [ ] **Step 4: Run tests, commit**

```bash
bun test
git add src/plugins/builtin/vega.ts src/server.ts src/ui/types.ts
git commit -m "feat: add Vega plugin, plugin API endpoints, output integration"
```

---

### Task 9: Frontend Plugin Renderer

**Files:**
- Create: `src/ui/components/outputs/PluginRenderer.tsx`
- Modify: `src/ui/components/CellOutput.tsx`

- [ ] **Step 1: Create PluginRenderer**

Create `src/ui/components/outputs/PluginRenderer.tsx`:

```tsx
import { useState, useEffect } from "react";

interface Props {
  pluginType: string;
  data: Record<string, unknown>;
}

export function PluginRenderer({ pluginType, data }: Props) {
  const [Comp, setComp] = useState<((p: { data: any }) => any) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/plugins/${pluginType}/component`)
      .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.text(); })
      .then((src) => {
        if (cancelled) return;
        // Plugin component sources are loaded from trusted server-side plugin files
        // This dynamic evaluation is intentional for the plugin system
        const React = require("react");
        const fn = new Function("React", `"use strict"; return (${src})`);
        const c = fn(React);
        if (typeof c === "function") setComp(() => c);
        else setError("Plugin did not return a component");
      })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [pluginType]);

  if (error) return <div className="output-error">{error}</div>;
  if (!Comp) return <div className="output-result" style={{ color: "var(--text-muted)" }}>Loading...</div>;
  return <Comp data={data} />;
}
```

- [ ] **Step 2: Add plugin case to CellOutput**

In `src/ui/components/CellOutput.tsx`, add import:

```tsx
import { PluginRenderer } from "./outputs/PluginRenderer.tsx";
```

In `RichOutputRenderer` switch, add:

```tsx
    case "plugin":
      return <PluginRenderer pluginType={(output as any).pluginType} data={(output as any).data} />;
```

- [ ] **Step 3: Build and commit**

```bash
bun run build:ui
git add src/ui/components/outputs/PluginRenderer.tsx src/ui/components/CellOutput.tsx
git commit -m "feat: add dynamic plugin renderer"
```

---

### Task 10: CLI Plugin Commands + Merge

**Files:**
- Modify: `src/cli.ts` (the plugin stub from Task 1 is already in place)

Note: The full plugin command implementation was already included in Task 1's CLI rewrite. If it wasn't (because Task 1 only added a stub), implement the full `plugin list|install|remove` logic now. The plugin loader import (`./plugins/loader.ts`) now exists from Task 7.

- [ ] **Step 1: Verify plugin commands work**

```bash
bun src/cli.ts plugin list
```

Expected: "No plugins installed." + plugin directory path

- [ ] **Step 2: Run all tests and merge**

```bash
bun test
git checkout staging && git merge feat/plugin-system
```

---

## Branch 3: feat/vscode-extension

### Task 11: Extension Scaffolding

**Files:**
- Create: `packages/vscode-yeastbook/package.json`
- Create: `packages/vscode-yeastbook/tsconfig.json`
- Create: `packages/vscode-yeastbook/.vscodeignore`

- [ ] **Step 1: Create files**

```bash
mkdir -p packages/vscode-yeastbook/src
```

Create `packages/vscode-yeastbook/package.json`:

```json
{
  "name": "vscode-yeastbook",
  "displayName": "Yeastbook",
  "description": "TypeScript notebooks powered by Bun",
  "version": "0.1.0",
  "publisher": "yeastbook",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Notebooks"],
  "main": "./dist/extension.js",
  "contributes": {
    "customEditors": [{
      "viewType": "yeastbook.notebook",
      "displayName": "Yeastbook Notebook",
      "selector": [
        { "filenamePattern": "*.ybk" },
        { "filenamePattern": "*.ipynb" }
      ],
      "priority": "default"
    }],
    "commands": [
      { "command": "yeastbook.newNotebook", "title": "Yeastbook: New Notebook" },
      { "command": "yeastbook.restartKernel", "title": "Yeastbook: Restart Kernel" }
    ]
  },
  "scripts": {
    "build": "bun build src/extension.ts --outdir dist --target node --format cjs --external vscode",
    "package": "bunx @vscode/vsce package --no-dependencies"
  },
  "devDependencies": { "@types/vscode": "^1.85.0" }
}
```

Create `packages/vscode-yeastbook/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "commonjs", "lib": ["ES2022"],
    "outDir": "dist", "strict": true, "esModuleInterop": true, "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

Create `packages/vscode-yeastbook/.vscodeignore`:

```
src/**
tsconfig.json
node_modules/**
!dist/**
```

- [ ] **Step 2: Install deps and commit**

```bash
cd packages/vscode-yeastbook && bun install && cd ../..
git add packages/vscode-yeastbook/
git commit -m "feat: scaffold VS Code extension"
```

---

### Task 12: KernelManager

**Files:**
- Create: `packages/vscode-yeastbook/src/KernelManager.ts`

- [ ] **Step 1: Implement**

Create `packages/vscode-yeastbook/src/KernelManager.ts`:

```ts
import * as vscode from "vscode";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { statSync } from "node:fs";

interface KernelInfo { process: ChildProcess; port: number; }

export class KernelManager {
  private kernels = new Map<string, KernelInfo>();

  async startKernel(notebookPath: string): Promise<number> {
    const existing = this.kernels.get(notebookPath);
    if (existing && !existing.process.killed) return existing.port;

    const port = await this.findFreePort();
    const ybk = this.findYeastbook();
    if (!ybk) throw new Error("yeastbook not found. Install: bun install -g yeastbook");

    const proc = spawn("bun", [ybk, notebookPath, "--port", String(port), "--no-open"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Kernel timeout")), 10000);
      proc.stdout?.on("data", (d: Buffer) => {
        if (d.toString().includes("running at")) { clearTimeout(t); resolve(); }
      });
      proc.on("error", (e) => { clearTimeout(t); reject(e); });
      proc.on("exit", (c) => { if (c) { clearTimeout(t); reject(new Error(`Exit ${c}`)); } });
    });

    this.kernels.set(notebookPath, { process: proc, port });
    return port;
  }

  async stopKernel(path: string) {
    const k = this.kernels.get(path);
    if (k) { k.process.kill(); this.kernels.delete(path); }
  }

  async stopAll() {
    for (const [, k] of this.kernels) k.process.kill();
    this.kernels.clear();
  }

  private findYeastbook(): string | null {
    try { return execFileSync("which", ["yeastbook"], { encoding: "utf-8" }).trim() || null; } catch {}
    for (const f of vscode.workspace.workspaceFolders ?? []) {
      const p = vscode.Uri.joinPath(f.uri, "node_modules", ".bin", "yeastbook").fsPath;
      try { if (statSync(p).isFile()) return p; } catch {}
    }
    return null;
  }

  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const s = createServer();
      s.listen(0, () => {
        const a = s.address();
        if (a && typeof a !== "string") s.close(() => resolve(a.port));
        else s.close(() => reject(new Error("No free port")));
      });
      s.on("error", reject);
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/vscode-yeastbook/src/KernelManager.ts
git commit -m "feat: add KernelManager"
```

---

### Task 13: YbkEditorProvider + Extension Entry Point

**Files:**
- Create: `packages/vscode-yeastbook/src/YbkEditorProvider.ts`
- Create: `packages/vscode-yeastbook/src/extension.ts`

- [ ] **Step 1: Create YbkEditorProvider**

Create `packages/vscode-yeastbook/src/YbkEditorProvider.ts`:

```ts
import * as vscode from "vscode";
import type { KernelManager } from "./KernelManager";

export class YbkEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private kernelManager: KernelManager) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    let port: number;
    try { port = await this.kernelManager.startKernel(document.uri.fsPath); }
    catch (e) {
      vscode.window.showErrorMessage(`Failed to start kernel: ${e instanceof Error ? e.message : e}`);
      return;
    }

    panel.webview.options = { enableScripts: true };
    panel.webview.html = `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; frame-src http://localhost:${port}; style-src 'unsafe-inline';">
  <style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:none}</style>
</head><body>
  <iframe src="http://localhost:${port}" allow="clipboard-read; clipboard-write"></iframe>
</body></html>`;

    panel.onDidDispose(() => this.kernelManager.stopKernel(document.uri.fsPath));
  }
}
```

- [ ] **Step 2: Create extension.ts**

Create `packages/vscode-yeastbook/src/extension.ts`:

```ts
import * as vscode from "vscode";
import { YbkEditorProvider } from "./YbkEditorProvider";
import { KernelManager } from "./KernelManager";

export function activate(context: vscode.ExtensionContext) {
  const km = new KernelManager();

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider("yeastbook.notebook",
      new YbkEditorProvider(km), { webviewOptions: { retainContextWhenHidden: true } }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("yeastbook.newNotebook", async () => {
      const uri = await vscode.window.showSaveDialog({
        filters: { "Yeastbook Notebook": ["ybk"] },
        defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
      });
      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(
          JSON.stringify({ version: "0.1.0", cells: [], metadata: {}, settings: {} }, null, 2)));
        await vscode.commands.executeCommand("vscode.openWith", uri, "yeastbook.notebook");
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("yeastbook.restartKernel", async () => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      if (tab?.input && "uri" in (tab.input as any)) {
        const fp = ((tab.input as any).uri as vscode.Uri).fsPath;
        await km.stopKernel(fp);
        await km.startKernel(fp);
        vscode.window.showInformationMessage("Kernel restarted.");
      }
    }),
  );

  context.subscriptions.push({ dispose: () => km.stopAll() });
}

export function deactivate() {}
```

- [ ] **Step 3: Build and commit**

```bash
cd packages/vscode-yeastbook && bun run build && cd ../..
git add packages/vscode-yeastbook/src/
git commit -m "feat: add VS Code extension with editor provider and commands"
```

---

### Task 14: Final Build, Test, Merge

- [ ] **Step 1: Run all tests**

```bash
bun test
```

- [ ] **Step 2: Build everything**

```bash
bun run build:ui && bun run build:embed
cd packages/vscode-yeastbook && bun run build && cd ../..
```

- [ ] **Step 3: Merge and verify**

```bash
git checkout staging && git merge feat/vscode-extension
```

Manual verification:
1. `bun src/cli.ts new` - notebook works
2. `await $\`echo hello\`.text()` returns "hello\n"
3. `bun src/cli.ts new --port 4000` starts on 4000
4. `bun src/cli.ts plugin list` shows built-in vega via API
5. VS Code extension builds to `packages/vscode-yeastbook/dist/extension.js`
