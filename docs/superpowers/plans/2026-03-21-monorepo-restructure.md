# Monorepo Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure yeastbook from a flat `src/` layout into a Bun workspace monorepo with `@yeastbook/core`, `@yeastbook/app`, `@yeastbook/ui`, and `@yeastbook/vscode` packages, plus feature additions (export stripping, port auto-detection, graceful shutdown, auto-type acquisition).

**Architecture:** The restructure is done atomically in Task 1 (move all files + rewrite all imports in one commit). Feature additions follow as independent tasks. Tests stay at root level with imports updated to point at new package paths.

**Tech Stack:** Bun workspaces, TypeScript

**Branch:** `feature/monorepo-restructure` off `staging`

---

## File Mapping

### Current → New locations

**@yeastbook/core** (pure logic, no runtime/IO):
| Current | New |
|---------|-----|
| `src/kernel/transform.ts` | `packages/core/src/transform.ts` |
| `src/kernel/magic.ts` | `packages/core/src/magic.ts` |
| `src/kernel/output.ts` | `packages/core/src/output.ts` |
| `src/format.ts` | `packages/core/src/format.ts` |
| `src/notebook.ts` | `packages/core/src/notebook.ts` |
| `src/plugins/types.ts` | `packages/core/src/plugins.ts` |
| `src/ui/types.ts` | `packages/core/src/types.ts` |

**@yeastbook/app** (server, CLI, runtime):
| Current | New |
|---------|-----|
| `src/cli.ts` | `packages/app/src/cli.ts` |
| `src/server.ts` | `packages/app/src/server.ts` |
| `src/watcher.ts` | `packages/app/src/watcher.ts` |
| `src/kernel/execute.ts` | `packages/app/src/kernel/execute.ts` |
| `src/kernel/installer.ts` | `packages/app/src/kernel/installer.ts` |
| `src/plugins/loader.ts` | `packages/app/src/plugins/loader.ts` |
| `src/plugins/builtin/vega.ts` | `packages/app/src/plugins/builtin/vega.ts` |
| `src/assets.ts` | `packages/app/src/assets.ts` |

**@yeastbook/ui** (React frontend):
| Current | New |
|---------|-----|
| `src/ui/app.tsx` | `packages/ui/src/app.tsx` |
| `src/ui/index.tsx` | `packages/ui/src/index.tsx` |
| `src/ui/index.html` | `packages/ui/src/index.html` |
| `src/ui/styles.css` | `packages/ui/src/styles.css` |
| `src/ui/useWebSocket.ts` | `packages/ui/src/useWebSocket.ts` |
| `src/ui/components/*` | `packages/ui/src/components/*` |
| `dist/` | `packages/ui/dist/` |

**@yeastbook/vscode** (VS Code extension):
| Current | New |
|---------|-----|
| `packages/vscode-yeastbook/*` | `packages/vscode/*` |

---

## Task 1: Atomic Monorepo Restructure

This is the big one. All file moves and import rewrites happen in a single commit to avoid any broken intermediate state.

**Files:** Everything moves. See mapping above.

- [ ] **Step 1: Create branch**

```bash
git checkout -b feature/monorepo-restructure staging
```

- [ ] **Step 2: Create directory structure**

```bash
mkdir -p packages/core/src
mkdir -p packages/app/src/kernel
mkdir -p packages/app/src/plugins/builtin
mkdir -p packages/ui/src/components/outputs
```

- [ ] **Step 3: Create root package.json**

Replace the existing root `package.json` with:

```json
{
  "name": "yeastbook-monorepo",
  "version": "0.0.1",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "bun run --filter @yeastbook/app dev",
    "build:ui": "bun run --filter @yeastbook/ui build",
    "build:embed": "bun run scripts/embed-assets.ts",
    "build:all": "bun run build:ui && bun run build:embed && bun run build:binary:linux",
    "build:binary:linux": "bun build --compile --target=bun-linux-x64 packages/app/src/cli.ts --outfile binaries/yeastbook-linux",
    "build:binary:mac": "bun build --compile --target=bun-macos-arm64 packages/app/src/cli.ts --outfile binaries/yeastbook-macos",
    "test": "bun test"
  }
}
```

- [ ] **Step 4: Create packages/core/package.json**

```json
{
  "name": "@yeastbook/core",
  "version": "0.0.1",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

- [ ] **Step 5: Create packages/app/package.json**

```json
{
  "name": "@yeastbook/app",
  "version": "0.0.1",
  "bin": { "yeastbook": "./src/cli.ts" },
  "dependencies": {
    "@yeastbook/core": "workspace:*"
  }
}
```

- [ ] **Step 6: Create packages/ui/package.json**

```json
{
  "name": "@yeastbook/ui",
  "version": "0.0.1",
  "dependencies": {
    "@yeastbook/core": "workspace:*"
  },
  "scripts": {
    "build": "bun build src/index.tsx --outdir dist --bundle --minify && cp src/index.html dist/index.html"
  }
}
```

- [ ] **Step 7: Move @yeastbook/core files**

```bash
# Pure logic files
cp src/kernel/transform.ts packages/core/src/transform.ts
cp src/kernel/magic.ts packages/core/src/magic.ts
cp src/kernel/output.ts packages/core/src/output.ts
cp src/format.ts packages/core/src/format.ts
cp src/notebook.ts packages/core/src/notebook.ts
cp src/plugins/types.ts packages/core/src/plugins.ts
cp src/ui/types.ts packages/core/src/types.ts
```

Create `packages/core/src/index.ts` barrel export:

```ts
// @yeastbook/core — shared logic and types

export { transformCellCode } from "./transform.ts";
export { parseMagicCommands } from "./magic.ts";
export type { MagicCommand, ParseResult } from "./magic.ts";
export { detectOutputType } from "./output.ts";
export type { OutputData, ChartConfig } from "./output.ts";
export { loadNotebook, saveNotebook, ybkToIpynb, ipynbToYbk, detectFormat, createEmptyYbk } from "./format.ts";
export type { YbkNotebook, YbkCell, YbkCellOutput, IpynbNotebook, NotebookFormat } from "./format.ts";
export { Notebook } from "./notebook.ts";
export type { YbkPlugin, OutputRendererPlugin } from "./plugins.ts";
export type { Settings, Cell, CellOutput, NotebookData, RichOutput, WsIncoming, WsOutgoing } from "./types.ts";
export { DEFAULT_SETTINGS } from "./types.ts";
```

Fix internal imports within core — `notebook.ts` imports from `./format.ts`, which stays the same relative path. Just verify no cross-package imports leak in.

- [ ] **Step 8: Move @yeastbook/app files**

```bash
cp src/cli.ts packages/app/src/cli.ts
cp src/server.ts packages/app/src/server.ts
cp src/watcher.ts packages/app/src/watcher.ts
cp src/kernel/execute.ts packages/app/src/kernel/execute.ts
cp src/kernel/installer.ts packages/app/src/kernel/installer.ts
cp src/plugins/loader.ts packages/app/src/plugins/loader.ts
cp src/plugins/builtin/vega.ts packages/app/src/plugins/builtin/vega.ts
cp src/assets.ts packages/app/src/assets.ts
```

Update imports in each app file to use `@yeastbook/core`:

**packages/app/src/server.ts** — replace relative imports:
- `./notebook.ts` → `@yeastbook/core`
- `./format.ts` → `@yeastbook/core`
- `./ui/types.ts` → `@yeastbook/core`
- `./kernel/magic.ts` → `@yeastbook/core`
- `./kernel/output.ts` → `@yeastbook/core`
- Keep local: `./assets.ts`, `./watcher.ts`, `./kernel/execute.ts`, `./kernel/installer.ts`, `./plugins/loader.ts`

**packages/app/src/cli.ts** — replace:
- `./server.ts` stays local
- `./format.ts` → `@yeastbook/core`
- `./plugins/loader.ts` stays local

**packages/app/src/kernel/execute.ts** — replace:
- `./transform.ts` → `@yeastbook/core`

**packages/app/src/plugins/loader.ts** — replace:
- `./types.ts` → `@yeastbook/core`

**packages/app/src/plugins/builtin/vega.ts** — replace:
- `../types.ts` → `@yeastbook/core`

- [ ] **Step 9: Move @yeastbook/ui files**

```bash
cp -r src/ui/app.tsx packages/ui/src/app.tsx
cp src/ui/index.tsx packages/ui/src/index.tsx
cp src/ui/index.html packages/ui/src/index.html
cp src/ui/styles.css packages/ui/src/styles.css
cp src/ui/useWebSocket.ts packages/ui/src/useWebSocket.ts
cp -r src/ui/components/* packages/ui/src/components/
```

Update imports in UI files:
- `../types.ts` → `@yeastbook/core` (in app.tsx, useWebSocket.ts, components)
- Internal `./` imports within UI stay the same

**packages/ui/src/app.tsx** — replace:
- `import type { ... } from "./types.ts"` → `import type { ... } from "@yeastbook/core"`
- `import { DEFAULT_SETTINGS } from "./types.ts"` → `import { DEFAULT_SETTINGS } from "@yeastbook/core"`

**packages/ui/src/useWebSocket.ts** — replace:
- `import type { WsIncoming } from "./types.ts"` → `import type { WsIncoming } from "@yeastbook/core"`

**packages/ui/src/components/CodeCell.tsx** — replace:
- `import type { Cell, CellOutput as CellOutputType } from "../types.ts"` → `import type { Cell, CellOutput as CellOutputType } from "@yeastbook/core"`

**packages/ui/src/components/CellOutput.tsx** — replace:
- `import type { CellOutput as CellOutputType } from "../types.ts"` → `import type { CellOutput as CellOutputType } from "@yeastbook/core"`

**packages/ui/src/components/NotebookView.tsx** — replace:
- `import type { Cell, CellOutput, Settings } from "../types.ts"` → `import type { Cell, CellOutput, Settings } from "@yeastbook/core"`

**packages/ui/src/components/SettingsPanel.tsx** — check and update any types imports.

- [ ] **Step 10: Move vscode extension**

```bash
mv packages/vscode-yeastbook packages/vscode
```

Update `packages/vscode/package.json` name if needed.

- [ ] **Step 11: Update embed-assets script**

Update `scripts/embed-assets.ts` to read from `packages/ui/dist/` and write to `packages/app/src/assets.ts`:

```ts
const distDir = resolve(import.meta.dirname!, "../packages/ui/dist");
const outFile = resolve(import.meta.dirname!, "../packages/app/src/assets.ts");
```

- [ ] **Step 12: Update test imports**

All tests at root `tests/` need import paths updated:

- `../src/kernel/transform.ts` → `../packages/core/src/transform.ts` (or `@yeastbook/core`)
- `../src/kernel/magic.ts` → `../packages/core/src/magic.ts`
- `../src/kernel/output.ts` → `../packages/core/src/output.ts`
- `../src/kernel/execute.ts` → `../packages/app/src/kernel/execute.ts`
- `../src/format.ts` → `../packages/core/src/format.ts`
- `../src/notebook.ts` → `../packages/core/src/notebook.ts`
- `../src/server.ts` → `../packages/app/src/server.ts`
- `../src/watcher.ts` → `../packages/app/src/watcher.ts`
- `../src/plugins/loader.ts` → `../packages/app/src/plugins/loader.ts`

- [ ] **Step 13: Remove old src/ directory**

```bash
rm -rf src/
```

- [ ] **Step 14: Install workspace dependencies**

```bash
bun install
```

- [ ] **Step 15: Run tests**

```bash
bun test
```

Expected: All 102 tests pass

- [ ] **Step 16: Build UI**

```bash
bun run build:ui && bun run build:embed
```

- [ ] **Step 17: Smoke test**

```bash
timeout 3 bun packages/app/src/cli.ts new 2>&1 || true
```

- [ ] **Step 18: Commit**

```bash
git add -A
git commit -m "refactor: restructure into Bun monorepo with @yeastbook/* packages"
```

---

## Task 2: Fix transform.ts — Strip export keyword

**Files:**
- Modify: `packages/core/src/transform.ts`
- Modify: `tests/transform.test.ts`

- [ ] **Step 1: Add failing test**

In `tests/transform.test.ts`, add:

```ts
  test("strips export keyword from top-level declarations", () => {
    const result = transformCellCode("export const x = 1");
    expect(result).toContain("var x =");
    expect(result).not.toContain("export");
  });

  test("strips export from function declarations", () => {
    const result = transformCellCode("export function foo() { return 1 }");
    expect(result).toContain("function foo()");
    expect(result).not.toContain("export");
  });

  test("preserves export inside functions", () => {
    const code = "function foo() {\n  export const x = 1\n}";
    const result = transformCellCode(code);
    expect(result).toContain("export const x = 1");
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/transform.test.ts
```

- [ ] **Step 3: Implement export stripping**

In `packages/core/src/transform.ts`, inside the main loop, before the `const`/`let` conversion (at `braceDepth === 0`), add:

```ts
      // Strip top-level export keyword
      if (trimmed.startsWith("export ")) {
        const afterExport = trimmed.slice(7);
        if (/^(const |let |var |function |class )/.test(afterExport)) {
          line = indent + afterExport;
        }
      }
```

Re-read `trimmed` after this transformation so the const/let conversion picks it up.

- [ ] **Step 4: Run tests**

```bash
bun test tests/transform.test.ts
```

Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/transform.ts tests/transform.test.ts
git commit -m "feat: strip export keyword from top-level declarations in cells"
```

---

## Task 3: CLI Port Auto-Detection

**Files:**
- Modify: `packages/app/src/cli.ts`

- [ ] **Step 1: Add findFreePort function**

Add to `packages/app/src/cli.ts`:

```ts
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
```

- [ ] **Step 2: Update server start calls to use findFreePort**

Replace the two places where `startServer(filePath, port)` is called:

```ts
  const actualPort = await findFreePort(port);
  const server = await startServer(filePath, actualPort);
```

- [ ] **Step 3: Verify**

```bash
bun test
```

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/cli.ts
git commit -m "feat: auto-detect free port if default is in use"
```

---

## Task 4: Graceful Shutdown

**Files:**
- Modify: `packages/app/src/cli.ts`

- [ ] **Step 1: Add SIGINT handler**

After each `startServer` call in cli.ts, add:

```ts
  process.on("SIGINT", () => {
    console.log("\nShutting down yeastbook...");
    server.stop();
    process.exit(0);
  });
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/cli.ts
git commit -m "feat: graceful shutdown on Ctrl+C"
```

---

## Task 5: Auto-Type Acquisition for %install

**Files:**
- Modify: `packages/app/src/kernel/installer.ts`

- [ ] **Step 1: Add @types auto-install**

After the main `bun add` succeeds, silently attempt to install `@types/<pkg>`:

```ts
    // After successful install, try to get types
    if (exitCode === 0) {
      for (const pkg of packages) {
        // Skip scoped packages and packages that likely have built-in types
        if (pkg.startsWith("@")) continue;
        try {
          const typesProc = Bun.spawn(["bun", "add", "-d", `@types/${pkg}`], {
            stdout: "ignore",
            stderr: "ignore",
          });
          await typesProc.exited;
        } catch {}
      }
    }
```

This runs silently — if `@types/<pkg>` doesn't exist, it fails quietly. The existing dts reading logic in `server.ts` already checks `node_modules/@types/<pkg>/index.d.ts`, so the types will be picked up automatically.

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/kernel/installer.ts
git commit -m "feat: auto-install @types packages after %install"
```

---

## Task 6: Update core barrel export for new additions

**Files:**
- Modify: `packages/core/src/index.ts` (if any new exports needed)

This is a verification task — ensure the barrel export is complete.

- [ ] **Step 1: Run all tests**

```bash
bun test
```

Expected: All tests pass (102 original + 3 new transform tests = 105)

- [ ] **Step 2: Build everything**

```bash
bun run build:ui && bun run build:embed
cd packages/vscode && bun run build && cd ../..
```

- [ ] **Step 3: Smoke test**

```bash
timeout 3 bun packages/app/src/cli.ts new --port 3050 2>&1 || true
bun packages/app/src/cli.ts plugin list 2>&1
```

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during verification"
```

- [ ] **Step 5: Merge to staging**

```bash
git checkout staging
git merge --no-ff feature/monorepo-restructure -m "merge: restructure into Bun monorepo"
git branch -d feature/monorepo-restructure
```
