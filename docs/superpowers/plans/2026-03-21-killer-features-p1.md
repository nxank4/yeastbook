# P1 Killer Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three killer features to yeastbook: magic `%install` command for inline package installation, Monaco Editor for professional code editing, and rich output rendering (JSON tree, data table, charts, HTML).

**Architecture:** Three independent feature pillars wired into the existing Bun server + React UI. Magic commands are parsed from cell code before execution, with install output streamed via WebSocket. Monaco Editor replaces the textarea+highlight.js overlay. Rich output detection happens server-side (detecting arrays-of-objects as tables, marked objects as charts/HTML), with specialized React components rendering each type client-side.

**Tech Stack:** Bun, React, @monaco-editor/react (loads Monaco from CDN), chart.js, DOMPurify (already installed)

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/kernel/magic.ts` | Parse `%install` lines from cell code, return magic commands + clean code |
| `src/kernel/installer.ts` | Run `bun add` via `Bun.spawn`, stream stdout/stderr via callbacks |
| `src/kernel/output.ts` | Detect output type from execution result value (table, chart, html, json, text) |
| `src/ui/components/outputs/JsonTree.tsx` | Collapsible JSON tree viewer with color-coded types |
| `src/ui/components/outputs/DataTable.tsx` | Sortable table for arrays of objects |
| `src/ui/components/outputs/ChartOutput.tsx` | Chart.js wrapper for bar/line/pie/scatter/doughnut |
| `src/ui/components/outputs/HtmlOutput.tsx` | DOMPurify-sanitized HTML renderer |
| `tests/magic.test.ts` | Tests for magic command parser |
| `tests/output.test.ts` | Tests for output type detection |

### Modified Files
| File | Changes |
|------|---------|
| `src/server.ts` | Add magic command handling in WebSocket handler, add `/api/types/bun` endpoint, send rich output data |
| `src/ui/types.ts` | Add `WsIncoming` variants for install messages, add rich output field to result message |
| `src/ui/app.tsx` | Handle install WebSocket messages, pass install state to CodeCell |
| `src/ui/components/CodeCell.tsx` | Replace textarea with Monaco Editor, show install progress |
| `src/ui/components/CellOutput.tsx` | Route to rich output components based on output data type |
| `src/ui/styles.css` | Add styles for install progress, rich output components |
| `src/ui/index.html` | Remove highlight.js CDN links (Monaco replaces it) |
| `package.json` | Add `@monaco-editor/react` and `chart.js` dependencies |

---

## Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install @monaco-editor/react and chart.js**

```bash
cd /home/nxank4/personal/yeastbook
bun add @monaco-editor/react chart.js
```

- [ ] **Step 2: Verify installation**

```bash
ls node_modules/@monaco-editor/react/package.json
ls node_modules/chart.js/package.json
```

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add @monaco-editor/react and chart.js dependencies"
```

---

## Task 2: Magic Command Parser

**Files:**
- Create: `src/kernel/magic.ts`
- Create: `tests/magic.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/magic.test.ts`:

```ts
import { test, expect, describe } from "bun:test";
import { parseMagicCommands } from "../src/kernel/magic.ts";

describe("parseMagicCommands", () => {
  test("parses single %install command", () => {
    const result = parseMagicCommands("%install lodash");
    expect(result.magic).toEqual([{ type: "install", packages: ["lodash"] }]);
    expect(result.cleanCode).toBe("");
  });

  test("parses multiple packages on one line", () => {
    const result = parseMagicCommands("%install lodash axios dayjs");
    expect(result.magic).toEqual([{ type: "install", packages: ["lodash", "axios", "dayjs"] }]);
    expect(result.cleanCode).toBe("");
  });

  test("preserves non-magic code as cleanCode", () => {
    const code = "%install lodash\nconst _ = require('lodash');\nconsole.log(_.chunk([1,2,3,4], 2));";
    const result = parseMagicCommands(code);
    expect(result.magic).toEqual([{ type: "install", packages: ["lodash"] }]);
    expect(result.cleanCode).toBe("const _ = require('lodash');\nconsole.log(_.chunk([1,2,3,4], 2));");
  });

  test("handles multiple %install lines", () => {
    const code = "%install lodash\n%install axios\nfetch('url')";
    const result = parseMagicCommands(code);
    expect(result.magic).toHaveLength(2);
    expect(result.magic[0]).toEqual({ type: "install", packages: ["lodash"] });
    expect(result.magic[1]).toEqual({ type: "install", packages: ["axios"] });
    expect(result.cleanCode).toBe("fetch('url')");
  });

  test("code with no magic commands returns empty magic array", () => {
    const result = parseMagicCommands("const x = 1;\nx + 2");
    expect(result.magic).toEqual([]);
    expect(result.cleanCode).toBe("const x = 1;\nx + 2");
  });

  test("empty %install returns error-like empty packages", () => {
    const result = parseMagicCommands("%install");
    expect(result.magic).toEqual([{ type: "install", packages: [] }]);
  });

  test("handles leading/trailing whitespace on magic lines", () => {
    const result = parseMagicCommands("  %install lodash  ");
    expect(result.magic).toEqual([{ type: "install", packages: ["lodash"] }]);
    expect(result.cleanCode).toBe("");
  });

  test("does not treat %install inside strings as magic", () => {
    const code = 'const s = "%install lodash"';
    const result = parseMagicCommands(code);
    expect(result.magic).toEqual([]);
    expect(result.cleanCode).toBe(code);
  });

  test("ignores trailing comments on %install line", () => {
    const result = parseMagicCommands("%install lodash // install lodash");
    expect(result.magic).toEqual([{ type: "install", packages: ["lodash"] }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/magic.test.ts
```

Expected: FAIL with module not found

- [ ] **Step 3: Implement the magic command parser**

Create `src/kernel/magic.ts`:

```ts
// src/kernel/magic.ts — Parse magic commands from cell code

export interface MagicCommand {
  type: "install";
  packages: string[];
}

export interface ParseResult {
  magic: MagicCommand[];
  cleanCode: string;
}

export function parseMagicCommands(code: string): ParseResult {
  const lines = code.split("\n");
  const magic: MagicCommand[] = [];
  const cleanLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("%install")) {
      const rest = trimmed.slice("%install".length).replace(/\/\/.*$/, "").trim();
      const packages = rest ? rest.split(/\s+/) : [];
      magic.push({ type: "install", packages });
    } else {
      cleanLines.push(line);
    }
  }

  return {
    magic,
    cleanCode: cleanLines.join("\n").trim(),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/magic.test.ts
```

Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/kernel/magic.ts tests/magic.test.ts
git commit -m "feat: add magic command parser for %install"
```

---

## Task 3: Package Installer

**Files:**
- Create: `src/kernel/installer.ts`

- [ ] **Step 1: Implement the installer**

Create `src/kernel/installer.ts`:

```ts
// src/kernel/installer.ts — Run bun add with streaming output

export interface InstallResult {
  success: boolean;
  error?: string;
}

export async function installPackages(
  packages: string[],
  onOutput: (text: string, stream: "stdout" | "stderr") => void,
): Promise<InstallResult> {
  if (packages.length === 0) {
    return { success: false, error: "No packages specified" };
  }

  try {
    const proc = Bun.spawn(["bun", "add", ...packages], {
      stdout: "pipe",
      stderr: "pipe",
    });

    // Stream stdout
    const stdoutReader = (async () => {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        onOutput(decoder.decode(value), "stdout");
      }
    })();

    // Stream stderr
    const stderrReader = (async () => {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        onOutput(decoder.decode(value), "stderr");
      }
    })();

    await Promise.all([stdoutReader, stderrReader]);
    const exitCode = await proc.exited;

    return exitCode === 0
      ? { success: true }
      : { success: false, error: `bun add exited with code ${exitCode}` };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
bun build --no-bundle src/kernel/installer.ts --outdir /tmp/check 2>&1 | head -5
```

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/kernel/installer.ts
git commit -m "feat: add package installer with streaming output"
```

---

## Task 4: Output Type Detection

**Files:**
- Create: `src/kernel/output.ts`
- Create: `tests/output.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/output.test.ts`:

```ts
import { test, expect, describe } from "bun:test";
import { detectOutputType } from "../src/kernel/output.ts";

describe("detectOutputType", () => {
  test("null returns null (skip)", () => {
    expect(detectOutputType(null)).toBeNull();
  });

  test("undefined returns null (skip)", () => {
    expect(detectOutputType(undefined)).toBeNull();
  });

  test("chart marker object returns chart type", () => {
    const val = {
      __type: "chart",
      data: [10, 20, 30],
      config: { chartType: "bar", label: "Sales" },
    };
    const result = detectOutputType(val);
    expect(result).toEqual({
      type: "chart",
      data: [10, 20, 30],
      config: { chartType: "bar", label: "Sales" },
    });
  });

  test("html marker object returns html type", () => {
    const val = { __type: "html", html: "<h1>Hello</h1>" };
    const result = detectOutputType(val);
    expect(result).toEqual({ type: "html", html: "<h1>Hello</h1>" });
  });

  test("array of plain objects returns table type", () => {
    const val = [
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ];
    const result = detectOutputType(val);
    expect(result).toEqual({ type: "table", rows: val });
  });

  test("empty array returns json type (not table)", () => {
    const result = detectOutputType([]);
    expect(result).toEqual({ type: "json", data: [] });
  });

  test("array of non-objects returns json type", () => {
    const result = detectOutputType([1, 2, 3]);
    expect(result).toEqual({ type: "json", data: [1, 2, 3] });
  });

  test("plain object returns json type", () => {
    const val = { name: "Alice", age: 30 };
    const result = detectOutputType(val);
    expect(result).toEqual({ type: "json", data: val });
  });

  test("string returns text type", () => {
    const result = detectOutputType("hello world");
    expect(result).toEqual({ type: "text", text: "hello world" });
  });

  test("number returns text type", () => {
    const result = detectOutputType(42);
    expect(result).toEqual({ type: "text", text: "42" });
  });

  test("boolean returns text type", () => {
    const result = detectOutputType(true);
    expect(result).toEqual({ type: "text", text: "true" });
  });

  test("array of mixed types returns json type", () => {
    const val = [{ name: "Alice" }, "not an object"];
    const result = detectOutputType(val);
    expect(result).toEqual({ type: "json", data: val });
  });

  test("array with null items returns json type", () => {
    const result = detectOutputType([null, { a: 1 }]);
    expect(result).toEqual({ type: "json", data: [null, { a: 1 }] });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/output.test.ts
```

Expected: FAIL with module not found

- [ ] **Step 3: Implement output type detection**

Create `src/kernel/output.ts`:

```ts
// src/kernel/output.ts — Detect output type from execution result value

export type OutputData =
  | { type: "text"; text: string }
  | { type: "json"; data: unknown }
  | { type: "table"; rows: Record<string, unknown>[] }
  | { type: "chart"; data: unknown[]; config: ChartConfig }
  | { type: "html"; html: string };

export interface ChartConfig {
  chartType: "bar" | "line" | "pie" | "scatter" | "doughnut";
  xKey?: string;
  yKey?: string;
  label?: string;
  title?: string;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val) && val.constructor === Object;
}

export function detectOutputType(value: unknown): OutputData | null {
  if (value === null || value === undefined) return null;

  // Check for marker objects
  if (isPlainObject(value)) {
    const v = value as Record<string, unknown>;
    if (v.__type === "chart" && Array.isArray(v.data) && v.config) {
      return { type: "chart", data: v.data, config: v.config as ChartConfig };
    }
    if (v.__type === "html" && typeof v.html === "string") {
      return { type: "html", html: v.html };
    }
  }

  // Array of plain objects -> table
  if (Array.isArray(value) && value.length > 0 && value.every(item => isPlainObject(item))) {
    return { type: "table", rows: value as Record<string, unknown>[] };
  }

  // Any other object or array -> json tree
  if (typeof value === "object") {
    return { type: "json", data: value };
  }

  // Primitives -> text
  return { type: "text", text: String(value) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/output.test.ts
```

Expected: All 13 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/kernel/output.ts tests/output.test.ts
git commit -m "feat: add output type detection for rich rendering"
```

---

## Task 5: Update WebSocket Types

**Files:**
- Modify: `src/ui/types.ts`

This task adds new WebSocket message types for install progress and rich output data.

- [ ] **Step 1: Add RichOutput type and install message types to WsIncoming**

In `src/ui/types.ts`, add the `RichOutput` type before `WsIncoming`:

```ts
export type RichOutput =
  | { type: "text"; text: string }
  | { type: "json"; data: unknown }
  | { type: "table"; rows: Record<string, unknown>[] }
  | { type: "chart"; data: unknown[]; config: { chartType: string; xKey?: string; yKey?: string; label?: string; title?: string } }
  | { type: "html"; html: string };
```

Update the `CellOutput` interface to add `richOutput`:

```ts
export interface CellOutput {
  output_type: string;
  text?: string[];
  data?: Record<string, string>;
  metadata?: Record<string, unknown>;
  execution_count?: number;
  ename?: string;
  evalue?: string;
  traceback?: string[];
  name?: string;
  richOutput?: RichOutput;
}
```

Update the `result` variant of `WsIncoming`:

```ts
  | { type: "result"; cellId: string; value: string; executionCount: number; richOutput?: RichOutput }
```

Add install message variants to `WsIncoming`:

```ts
  | { type: "install_start"; cellId: string; packages: string[] }
  | { type: "install_log"; cellId: string; text: string; stream: "stdout" | "stderr" }
  | { type: "install_done"; cellId: string; success: true; packageDts?: Record<string, string> }
  | { type: "install_error"; cellId: string; error: string }
```

- [ ] **Step 2: Verify no type errors**

```bash
bun build --no-bundle src/ui/types.ts --outdir /tmp/check 2>&1 | head -5
```

- [ ] **Step 3: Commit**

```bash
git add src/ui/types.ts
git commit -m "feat: add WebSocket types for install messages and rich output"
```

---

## Task 6: Server-Side Magic Commands + Rich Output

**Files:**
- Modify: `src/server.ts`

This task wires magic commands into the WebSocket execution handler and adds rich output detection.

- [ ] **Step 1: Add imports at top of server.ts**

Add these imports after the existing imports:

```ts
import { parseMagicCommands } from "./kernel/magic.ts";
import { installPackages } from "./kernel/installer.ts";
import { detectOutputType } from "./kernel/output.ts";
```

- [ ] **Step 2: Add /api/types/bun route**

Add a new route inside the `routes` object (after `/api/settings`):

```ts
"/api/types/bun": {
  GET: async () => {
    try {
      const typesPath = resolve(import.meta.dirname!, "../node_modules/@types/bun/index.d.ts");
      const file = Bun.file(typesPath);
      if (await file.exists()) {
        return new Response(await file.text(), {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    } catch {}
    return new Response("", { headers: { "Content-Type": "text/plain" } });
  },
},
```

- [ ] **Step 3: Update WebSocket message handler for magic commands**

Replace the execute block in the websocket `message` handler. The current code (lines 253-296) handles `msg.type === "execute"`. Replace it with:

```ts
if (msg.type === "execute") {
  // Parse magic commands
  const { magic, cleanCode } = parseMagicCommands(msg.code);

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

      const result = await installPackages(cmd.packages, (text, stream) => {
        ws.send(JSON.stringify({
          type: "install_log", cellId: msg.cellId, text, stream,
        }));
      });

      if (result.success) {
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
    }
  }

  // Execute clean code (if any remains after stripping magic lines)
  if (cleanCode.trim()) {
    state.executionCount++;
    const result = await executeCode(cleanCode, state.context);

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
        type: "error", cellId: msg.cellId,
        ename: result.error.ename, evalue: result.error.evalue, traceback: result.error.traceback,
      }));
    } else if (result.value !== undefined) {
      // Detect rich output type
      const richOutput = detectOutputType(result.value);
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
    await state.notebook.save(state.filePath);
  } else if (magic.length > 0) {
    // Magic-only cell: update source but send idle status
    state.notebook.updateCellSource(msg.cellId, msg.code);
    ws.send(JSON.stringify({ type: "status", cellId: msg.cellId, status: "idle" }));
    await state.notebook.save(state.filePath);
  }
}
```

- [ ] **Step 4: Run existing tests to verify nothing breaks**

```bash
bun test
```

Expected: All existing tests pass

- [ ] **Step 5: Commit**

```bash
git add src/server.ts
git commit -m "feat: wire magic commands and rich output into server WebSocket handler"
```

---

## Task 7: Rich Output Components

**Files:**
- Create: `src/ui/components/outputs/JsonTree.tsx`
- Create: `src/ui/components/outputs/DataTable.tsx`
- Create: `src/ui/components/outputs/ChartOutput.tsx`
- Create: `src/ui/components/outputs/HtmlOutput.tsx`

- [ ] **Step 1: Create the outputs directory**

```bash
mkdir -p src/ui/components/outputs
```

- [ ] **Step 2: Create JsonTree.tsx**

Create `src/ui/components/outputs/JsonTree.tsx`:

```tsx
import { useState, useCallback } from "react";

interface Props {
  data: unknown;
  defaultExpanded?: boolean;
  depth?: number;
}

const MAX_AUTO_EXPAND_DEPTH = 3;

export function JsonTree({ data, defaultExpanded, depth = 0 }: Props) {
  const autoExpand = defaultExpanded ?? depth < MAX_AUTO_EXPAND_DEPTH;
  const [expanded, setExpanded] = useState(autoExpand);
  const toggle = useCallback(() => setExpanded((e) => !e), []);

  if (data === null) return <span className="json-null">null</span>;
  if (data === undefined) return <span className="json-null">undefined</span>;

  if (typeof data === "string") {
    return <span className="json-string">"{data}"</span>;
  }
  if (typeof data === "number") {
    return <span className="json-number">{String(data)}</span>;
  }
  if (typeof data === "boolean") {
    return <span className="json-boolean">{String(data)}</span>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="json-bracket">[]</span>;
    return (
      <span className="json-node">
        <button className="json-toggle" onClick={toggle}>
          {expanded ? "\u25BE" : "\u25B8"}
        </button>
        {expanded ? (
          <>
            <span className="json-bracket">[</span>
            <div className="json-children">
              {data.map((item, i) => (
                <div key={i} className="json-entry">
                  <span className="json-index">{i}: </span>
                  <JsonTree data={item} depth={depth + 1} />
                  {i < data.length - 1 && <span className="json-comma">,</span>}
                </div>
              ))}
            </div>
            <span className="json-bracket">]</span>
          </>
        ) : (
          <span className="json-collapsed" onClick={toggle}>
            [{data.length} items]
          </span>
        )}
      </span>
    );
  }

  if (typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return <span className="json-bracket">{"{}"}</span>;
    return (
      <span className="json-node">
        <button className="json-toggle" onClick={toggle}>
          {expanded ? "\u25BE" : "\u25B8"}
        </button>
        {expanded ? (
          <>
            <span className="json-bracket">{"{"}</span>
            <div className="json-children">
              {entries.map(([key, val], i) => (
                <div key={key} className="json-entry">
                  <span className="json-key">{key}: </span>
                  <JsonTree data={val} depth={depth + 1} />
                  {i < entries.length - 1 && <span className="json-comma">,</span>}
                </div>
              ))}
            </div>
            <span className="json-bracket">{"}"}</span>
          </>
        ) : (
          <span className="json-collapsed" onClick={toggle}>
            {"{" + entries.length + " keys}"}
          </span>
        )}
      </span>
    );
  }

  return <span>{String(data)}</span>;
}
```

- [ ] **Step 3: Create DataTable.tsx**

Create `src/ui/components/outputs/DataTable.tsx`:

```tsx
import { useState, useMemo, useCallback } from "react";

interface Props {
  rows: Record<string, unknown>[];
}

const PAGE_SIZE = 100;

export function DataTable({ rows }: Props) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const columns = useMemo(() => {
    if (rows.length === 0) return [];
    return Object.keys(rows[0]);
  }, [rows]);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (va === vb) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = va < vb ? -1 : 1;
      return sortAsc ? cmp : -cmp;
    });
  }, [rows, sortKey, sortAsc]);

  const displayed = showAll ? sorted : sorted.slice(0, PAGE_SIZE);

  const handleSort = useCallback((key: string) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortAsc((a) => !a);
        return key;
      }
      setSortAsc(true);
      return key;
    });
  }, []);

  if (rows.length === 0) return <div className="output-result">Empty array</div>;

  return (
    <div className="data-table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col} onClick={() => handleSort(col)}>
                {col}
                {sortKey === col && (
                  <span className="sort-indicator">{sortAsc ? " \u25B4" : " \u25BE"}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayed.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td key={col}>{formatCell(row[col])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!showAll && rows.length > PAGE_SIZE && (
        <button className="show-more-btn" onClick={() => setShowAll(true)}>
          Show all {rows.length} rows
        </button>
      )}
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
```

- [ ] **Step 4: Create ChartOutput.tsx**

Create `src/ui/components/outputs/ChartOutput.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { Chart, registerables } from "chart.js";

Chart.register(...registerables);

interface ChartConfig {
  chartType: "bar" | "line" | "pie" | "scatter" | "doughnut";
  xKey?: string;
  yKey?: string;
  label?: string;
  title?: string;
}

interface Props {
  data: unknown[];
  config: ChartConfig;
}

export function ChartOutput({ data, config }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Destroy previous chart
    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    let labels: string[];
    let values: number[];

    if (data.length > 0 && typeof data[0] === "object" && data[0] !== null) {
      // Array of objects: use xKey and yKey
      const rows = data as Record<string, unknown>[];
      const xKey = config.xKey || Object.keys(rows[0])[0];
      const yKey = config.yKey || Object.keys(rows[0])[1];
      labels = rows.map((r) => String(r[xKey] ?? ""));
      values = rows.map((r) => Number(r[yKey] ?? 0));
    } else {
      // Simple array of values
      labels = data.map((_, i) => String(i));
      values = data.map((v) => Number(v));
    }

    const bgColors = [
      "rgba(193, 95, 60, 0.7)",
      "rgba(43, 108, 176, 0.7)",
      "rgba(61, 140, 92, 0.7)",
      "rgba(197, 48, 48, 0.7)",
      "rgba(128, 90, 213, 0.7)",
      "rgba(214, 158, 46, 0.7)",
      "rgba(56, 178, 172, 0.7)",
      "rgba(237, 137, 54, 0.7)",
    ];

    const isPie = config.chartType === "pie" || config.chartType === "doughnut";

    chartRef.current = new Chart(ctx, {
      type: config.chartType,
      data: {
        labels,
        datasets: [{
          label: config.label || "Data",
          data: values,
          backgroundColor: isPie
            ? values.map((_, i) => bgColors[i % bgColors.length])
            : bgColors[0],
          borderColor: isPie
            ? values.map((_, i) => bgColors[i % bgColors.length]!.replace("0.7", "1"))
            : bgColors[0]!.replace("0.7", "1"),
          borderWidth: 1,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: config.title ? { display: true, text: config.title } : { display: false },
          legend: { display: isPie },
        },
        scales: isPie ? {} : {
          y: { beginAtZero: true },
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [data, config]);

  return (
    <div className="chart-output" style={{ height: 300 }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
```

- [ ] **Step 5: Create HtmlOutput.tsx**

Create `src/ui/components/outputs/HtmlOutput.tsx`. Note: DOMPurify is already installed as a dependency.

```tsx
import DOMPurify from "dompurify";
import { useMemo } from "react";

interface Props {
  html: string;
}

export function HtmlOutput({ html }: Props) {
  // DOMPurify sanitizes the HTML to prevent XSS attacks
  const sanitized = useMemo(() => DOMPurify.sanitize(html), [html]);

  return (
    <div
      className="html-output"
      // Safe: content is sanitized by DOMPurify above
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/outputs/
git commit -m "feat: add rich output components - JsonTree, DataTable, ChartOutput, HtmlOutput"
```

---

## Task 8: Update CellOutput Routing

**Files:**
- Modify: `src/ui/components/CellOutput.tsx`
- Modify: `src/ui/app.tsx` (pass richOutput through)

- [ ] **Step 1: Replace CellOutput.tsx with rich output routing**

Replace `src/ui/components/CellOutput.tsx`:

```tsx
import { JsonTree } from "./outputs/JsonTree.tsx";
import { DataTable } from "./outputs/DataTable.tsx";
import { ChartOutput } from "./outputs/ChartOutput.tsx";
import { HtmlOutput } from "./outputs/HtmlOutput.tsx";
import type { CellOutput as CellOutputType } from "../types.ts";

interface Props {
  outputs: CellOutputType[];
}

export function CellOutput({ outputs }: Props) {
  if (outputs.length === 0) return null;

  return (
    <div className="output-area">
      {outputs.map((out, i) => {
        if (out.output_type === "stream") {
          const cls = out.name === "stdout" ? "output-stdout" : "output-stderr";
          return <div key={i} className={cls}>{(out.text || []).join("")}</div>;
        }
        if (out.output_type === "execute_result") {
          // Rich output rendering
          if (out.richOutput) {
            return (
              <div key={i} className="output-rich">
                <RichOutputRenderer output={out.richOutput} />
              </div>
            );
          }
          return (
            <div key={i} className="output-result">
              {out.data?.["text/plain"] || ""}
            </div>
          );
        }
        if (out.output_type === "error") {
          return (
            <div key={i} className="output-error">
              <div className="error-header">{out.ename}: {out.evalue}</div>
              {out.traceback?.length ? (
                <pre className="traceback">{out.traceback.join("\n")}</pre>
              ) : null}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

function RichOutputRenderer({ output }: { output: NonNullable<CellOutputType["richOutput"]> }) {
  switch (output.type) {
    case "table":
      return <DataTable rows={output.rows} />;
    case "chart":
      return <ChartOutput data={output.data} config={output.config as any} />;
    case "html":
      return <HtmlOutput html={output.html} />;
    case "json":
      return <JsonTree data={output.data} />;
    case "text":
      return <div className="output-result">{output.text}</div>;
    default:
      return null;
  }
}
```

- [ ] **Step 2: Update app.tsx to pass richOutput through**

In `src/ui/app.tsx`, in the `handleWsMessage` callback, update the `"result"` case. In the output object pushed to `liveOutputs`, add the `richOutput` field:

Change from:
```ts
{
  output_type: "execute_result",
  data: { "text/plain": msg.value },
  metadata: {},
  execution_count: msg.executionCount,
}
```

To:
```ts
{
  output_type: "execute_result",
  data: { "text/plain": msg.value },
  metadata: {},
  execution_count: msg.executionCount,
  richOutput: msg.richOutput,
}
```

- [ ] **Step 3: Verify the project compiles**

```bash
bun build --no-bundle src/ui/components/CellOutput.tsx --outdir /tmp/check 2>&1 | head -5
```

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/CellOutput.tsx src/ui/app.tsx
git commit -m "feat: route execute_result outputs to rich renderers"
```

---

## Task 9: Monaco Editor Integration

**Files:**
- Modify: `src/ui/components/CodeCell.tsx`
- Modify: `src/ui/components/NotebookView.tsx`
- Modify: `src/ui/index.html`
- Modify: `src/ui/app.tsx`

This is the largest UI change. Replace the textarea + highlight.js overlay with Monaco Editor.

- [ ] **Step 1: Remove highlight.js from index.html**

In `src/ui/index.html`, remove these 4 lines:

```html
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css" media="(prefers-color-scheme: light)" id="hljs-light">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" media="(prefers-color-scheme: dark)" id="hljs-dark">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/typescript.min.js"></script>
```

- [ ] **Step 2: Remove hljs theme switching from app.tsx**

In `src/ui/app.tsx`, remove the `useEffect` that manages hljs-light/hljs-dark link elements (the one with `document.getElementById("hljs-light")` and `document.getElementById("hljs-dark")`). Keep the `useEffect` that sets `data-theme` and `localStorage` — just remove the hljs lines from it.

- [ ] **Step 3: Replace CodeCell.tsx with Monaco version**

Replace `src/ui/components/CodeCell.tsx` entirely with:

```tsx
import { useRef, useEffect, useCallback, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { CellOutput } from "./CellOutput.tsx";
import type { Cell, CellOutput as CellOutputType } from "../types.ts";

interface Props {
  cell: Cell;
  busy: boolean;
  liveOutputs: CellOutputType[];
  theme: "light" | "dark";
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  installing?: { packages: string[]; logs: string[]; done: boolean; error?: string };
  onRun: (cellId: string, code: string) => void;
  onRunAndAdvance: (cellId: string, code: string) => void;
  onSourceChange: (cellId: string, source: string) => void;
  onDelete: (cellId: string) => void;
  onClear: (cellId: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export function CodeCell({
  cell, busy, liveOutputs, theme, fontSize, tabSize, wordWrap,
  installing, onRun, onRunAndAdvance, onSourceChange, onDelete, onClear, onMoveUp, onMoveDown,
}: Props) {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const [editorHeight, setEditorHeight] = useState(60);
  const sourceRef = useRef(cell.source.join("\n"));
  // Refs for callbacks to avoid stale closures in Monaco commands
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
  const onRunAndAdvanceRef = useRef(onRunAndAdvance);
  onRunAndAdvanceRef.current = onRunAndAdvance;

  const updateHeight = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);
    const lineCount = editor.getModel()?.getLineCount() ?? 1;
    const height = Math.max(lineHeight * lineCount + 20, 60);
    setEditorHeight(height);
  }, []);

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // TypeScript compiler options
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
    });

    // Load Bun type definitions
    fetch("/api/types/bun")
      .then((r) => r.text())
      .then((dts) => {
        if (dts) {
          monaco.languages.typescript.typescriptDefaults.addExtraLib(
            dts, "file:///node_modules/@types/bun/index.d.ts"
          );
        }
      })
      .catch(() => {});

    // Shift+Enter: run and advance (use refs to avoid stale closures)
    editor.addCommand(
      monaco.KeyMod.Shift | monaco.KeyCode.Enter,
      () => onRunAndAdvanceRef.current(cell.id, sourceRef.current),
    );

    // Ctrl/Cmd+Enter: run and stay
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      () => onRunRef.current(cell.id, sourceRef.current),
    );

    // Auto-resize + notify parent of source changes
    editor.onDidChangeModelContent(() => {
      sourceRef.current = editor.getValue();
      onSourceChange(cell.id, sourceRef.current);
      updateHeight();
    });
    updateHeight();
  }, [cell.id, onSourceChange, updateHeight]);

  useEffect(() => { updateHeight(); }, [updateHeight]);

  const displayOutputs = liveOutputs.length > 0 ? liveOutputs : cell.outputs;

  return (
    <div className="cell code-cell" id={`cell-${cell.id}`}>
      <div className="cell-header">
        <span className="exec-count">
          {busy && <span className="busy-indicator" />}
          {cell.execution_count ? `[${cell.execution_count}]` : "[ ]"}
        </span>
        <span className="cell-type">code</span>
        <div className="cell-actions">
          {onMoveUp && <button onClick={(e) => { e.stopPropagation(); onMoveUp(); }} title="Move up"><i className="bi bi-chevron-up" /></button>}
          {onMoveDown && <button onClick={(e) => { e.stopPropagation(); onMoveDown(); }} title="Move down"><i className="bi bi-chevron-down" /></button>}
          <button className="run-btn" onClick={(e) => { e.stopPropagation(); onRun(cell.id, sourceRef.current); }} title="Run cell">
            <i className="bi bi-play-fill" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onClear(cell.id); }} title="Clear output"><i className="bi bi-eraser" /></button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(cell.id); }} title="Delete cell"><i className="bi bi-trash3" /></button>
        </div>
      </div>
      {installing && !installing.done && (
        <div className="install-progress">
          <div className="install-header">
            <span className="busy-indicator" />
            Installing {installing.packages.join(", ")}...
          </div>
          {installing.logs.length > 0 && (
            <pre className="install-logs">{installing.logs.join("")}</pre>
          )}
        </div>
      )}
      {installing?.done && installing.error && (
        <div className="install-error-banner">
          <i className="bi bi-x-circle" /> Install failed: {installing.error}
        </div>
      )}
      {installing?.done && !installing.error && (
        <div className="install-success-banner">
          <i className="bi bi-check-circle" /> Installed {installing.packages.join(", ")}
        </div>
      )}
      <div className="code-area">
        <Editor
          height={editorHeight}
          defaultLanguage="typescript"
          defaultValue={cell.source.join("\n")}
          theme={theme === "dark" ? "vs-dark" : "vs"}
          onMount={handleEditorMount}
          options={{
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize,
            tabSize,
            wordWrap: wordWrap ? "on" : "off",
            lineNumbers: "on",
            glyphMargin: false,
            folding: false,
            lineDecorationsWidth: 0,
            renderLineHighlight: "none",
            scrollbar: { vertical: "hidden", horizontal: "hidden" },
            overviewRulerLanes: 0,
            automaticLayout: true,
            padding: { top: 8, bottom: 8 },
          }}
        />
      </div>
      <CellOutput outputs={displayOutputs} />
    </div>
  );
}
```

- [ ] **Step 4: Update NotebookView.tsx to pass new props**

Replace `src/ui/components/NotebookView.tsx`:

```tsx
import { CodeCell } from "./CodeCell.tsx";
import { MarkdownCell } from "./MarkdownCell.tsx";
import type { Cell, CellOutput, Settings } from "../types.ts";

interface Props {
  cells: Cell[];
  busyCells: Set<string>;
  liveOutputs: Map<string, CellOutput[]>;
  settings: Settings;
  installStates: Map<string, { packages: string[]; logs: string[]; done: boolean; error?: string }>;
  onRunCell: (cellId: string, code: string) => void;
  onRunAndAdvance: (cellId: string, code: string) => void;
  onSourceChange: (cellId: string, source: string) => void;
  onDeleteCell: (cellId: string) => void;
  onClearOutput: (cellId: string) => void;
  onUpdateMarkdown: (cellId: string, source: string) => void;
  onAddCell: (type: "code" | "markdown") => void;
  onMoveCell: (cellId: string, direction: "up" | "down") => void;
}

export function NotebookView({
  cells, busyCells, liveOutputs, settings, installStates,
  onRunCell, onRunAndAdvance, onSourceChange, onDeleteCell, onClearOutput, onUpdateMarkdown, onAddCell, onMoveCell,
}: Props) {
  return (
    <div className="notebook">
      {cells.map((cell, idx) =>
        cell.cell_type === "code" ? (
          <CodeCell
            key={cell.id}
            cell={cell}
            busy={busyCells.has(cell.id)}
            liveOutputs={liveOutputs.get(cell.id) || []}
            theme={settings.appearance.theme}
            fontSize={settings.editor.fontSize}
            tabSize={settings.editor.tabSize}
            wordWrap={settings.editor.wordWrap}
            installing={installStates.get(cell.id)}
            onRun={onRunCell}
            onRunAndAdvance={onRunAndAdvance}
            onSourceChange={onSourceChange}
            onDelete={onDeleteCell}
            onClear={onClearOutput}
            onMoveUp={idx > 0 ? () => onMoveCell(cell.id, "up") : undefined}
            onMoveDown={idx < cells.length - 1 ? () => onMoveCell(cell.id, "down") : undefined}
          />
        ) : (
          <MarkdownCell
            key={cell.id}
            cell={cell}
            onUpdate={onUpdateMarkdown}
            onDelete={onDeleteCell}
            onMoveUp={idx > 0 ? () => onMoveCell(cell.id, "up") : undefined}
            onMoveDown={idx < cells.length - 1 ? () => onMoveCell(cell.id, "down") : undefined}
          />
        )
      )}
      <div className="add-cell-bar">
        <button onClick={() => onAddCell("code")}><i className="bi bi-code-slash" /> Code</button>
        <button onClick={() => onAddCell("markdown")}><i className="bi bi-markdown" /> Markdown</button>
      </div>
      <div className="shortcut-hint">Shift+Enter to run &amp; advance / Ctrl+Enter to run</div>
    </div>
  );
}
```

- [ ] **Step 5: Update app.tsx — install state, new NotebookView props, remove textarea queries**

In `src/ui/app.tsx`:

**Add install state** (after the other useState declarations near line 31):
```ts
const [installStates, setInstallStates] = useState<Map<string, { packages: string[]; logs: string[]; done: boolean; error?: string }>>(new Map());
```

**Add install message handlers** in `handleWsMessage` switch (after the existing `"error"` case):
```ts
case "install_start":
  setInstallStates((prev) => {
    const next = new Map(prev);
    next.set(msg.cellId, { packages: msg.packages, logs: [], done: false });
    return next;
  });
  break;
case "install_log":
  setInstallStates((prev) => {
    const next = new Map(prev);
    const state = next.get(msg.cellId);
    if (state) {
      next.set(msg.cellId, { ...state, logs: [...state.logs, msg.text] });
    }
    return next;
  });
  break;
case "install_done":
  setInstallStates((prev) => {
    const next = new Map(prev);
    const state = next.get(msg.cellId);
    if (state) {
      next.set(msg.cellId, { ...state, done: true });
    }
    return next;
  });
  break;
case "install_error":
  setInstallStates((prev) => {
    const next = new Map(prev);
    const state = next.get(msg.cellId);
    if (state) {
      next.set(msg.cellId, { ...state, done: true, error: msg.error });
    }
    return next;
  });
  break;
```

**Remove hljs-related code** from the theme `useEffect` (keep data-theme and localStorage, remove the 4 lines about hljs-light/hljs-dark elements).

**Add `handleSourceChange` callback** (after existing callbacks):
```ts
const handleSourceChange = useCallback((cellId: string, source: string) => {
  setCells((prev) =>
    prev.map((c) => (c.id === cellId ? { ...c, source: [source] } : c))
  );
}, []);
```

**Update `handleRunAll`** — change textarea query to use cell source (which is now kept in sync by `handleSourceChange`):
```ts
const code = cell.source.join("\n");
```
(Remove the `document.querySelector` line that queries for textarea.)

**Update `handleCopyCell`** — remove textarea query, use cell.source directly (now kept in sync):
```ts
setClipboardCell({ ...cell });
```

**Update `handleMenuRunCell`** — remove textarea query, use cell.source:
```ts
const code = cell.source.join("\n");
```

**Remove `pendingFocusCellId`** — remove the ref declaration (`const pendingFocusCellId = useRef...`), the useEffect that queries textarea for focus, and the usage in `handleRunAndAdvance`. Monaco manages its own focus.

**Update `<NotebookView>` props** to include `settings`, `installStates`, and `onSourceChange`:
```tsx
<NotebookView
  cells={cells}
  busyCells={busyCells}
  liveOutputs={liveOutputs}
  settings={settings}
  installStates={installStates}
  onRunCell={handleRunCell}
  onRunAndAdvance={handleRunAndAdvance}
  onSourceChange={handleSourceChange}
  onDeleteCell={handleDeleteCell}
  onClearOutput={handleClearOutput}
  onUpdateMarkdown={handleUpdateMarkdown}
  onAddCell={handleAddCell}
  onMoveCell={handleMoveCell}
/>
```

**Remove the `pendingFocusCellId` useEffect** that queries `textarea` (around line 233-242) — Monaco manages its own focus.

- [ ] **Step 6: Build UI to verify**

```bash
bun run build:ui
```

Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add src/ui/components/CodeCell.tsx src/ui/components/NotebookView.tsx src/ui/app.tsx src/ui/index.html
git commit -m "feat: replace textarea with Monaco Editor, add install progress UI"
```

---

## Task 10: CSS for Rich Output and Install Progress

**Files:**
- Modify: `src/ui/styles.css`

- [ ] **Step 1: Remove textarea/highlight.js CSS rules that are now unused**

Remove these CSS rules from `src/ui/styles.css`:
- `.code-cell .code-area textarea` (around line 241-246 — the transparent text overlay rules)
- `.code-cell .code-area textarea::placeholder` (around line 248-251)
- `.code-highlight` (around line 253-258)
- `.code-highlight code` (around line 260-269)

Keep the generic `.code-area textarea` rule (around line 225-238) as it may still be used by markdown editing.

- [ ] **Step 2: Append rich output and install progress styles**

Append to `src/ui/styles.css`:

```css
/* --- Install Progress --- */
.install-progress {
  border-top: 1px solid var(--border-light);
  padding: 8px 12px;
  background: var(--surface-alt);
  font-size: 12px;
}

.install-header {
  display: flex; align-items: center; gap: 6px;
  color: var(--text-secondary);
  font-weight: 500;
}

.install-logs {
  margin-top: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px; line-height: 1.4;
  color: var(--text-muted);
  white-space: pre-wrap;
  max-height: 120px;
  overflow-y: auto;
}

.install-success-banner {
  border-top: 1px solid var(--border-light);
  padding: 6px 12px;
  font-size: 12px;
  color: var(--success);
  background: rgba(61, 140, 92, 0.05);
}

.install-error-banner {
  border-top: 1px solid var(--border-light);
  padding: 6px 12px;
  font-size: 12px;
  color: var(--error);
  background: var(--error-bg);
}

/* --- JSON Tree --- */
.output-rich {
  padding: 4px 0;
}

.json-node {
  display: inline;
}

.json-toggle {
  background: none; border: none; cursor: pointer;
  color: var(--text-muted); font-size: 10px;
  padding: 0 4px; line-height: 1;
  vertical-align: middle;
}
.json-toggle:hover { color: var(--accent); }

.json-children {
  padding-left: 20px;
}

.json-entry {
  line-height: 1.6;
}

.json-key { color: var(--text-secondary); }
.json-string { color: var(--success); }
.json-number { color: var(--result); }
.json-boolean { color: #D97706; }
.json-null { color: var(--text-faint); font-style: italic; }
.json-bracket { color: var(--text-muted); }
.json-comma { color: var(--text-muted); }
.json-index { color: var(--text-faint); font-size: 11px; }
.json-collapsed {
  color: var(--text-faint); cursor: pointer; font-style: italic;
}
.json-collapsed:hover { color: var(--accent); }

/* --- Data Table --- */
.data-table-wrapper {
  overflow-x: auto;
  max-height: 400px;
  overflow-y: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
}

.data-table th {
  text-align: left;
  padding: 6px 10px;
  font-weight: 600;
  color: var(--text-secondary);
  border-bottom: 2px solid var(--border);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.data-table th:hover { color: var(--accent); }

.data-table td {
  padding: 4px 10px;
  border-bottom: 1px solid var(--border-light);
  color: var(--text);
}

.data-table tbody tr:nth-child(even) {
  background: var(--surface-alt);
}

.data-table tbody tr:hover {
  background: var(--accent-hover);
}

.sort-indicator { font-size: 10px; }

.show-more-btn {
  display: block;
  margin: 8px auto;
  padding: 4px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
}
.show-more-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

/* --- Chart --- */
.chart-output {
  padding: 8px;
}

/* --- HTML Output --- */
.html-output {
  padding: 8px;
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/ui/styles.css
git commit -m "feat: add styles for rich output, install progress, and clean up textarea styles"
```

---

## Task 11: Build, Test, and Verify

**Files:**
- No new files — verification only

- [ ] **Step 1: Run all tests**

```bash
bun test
```

Expected: All tests pass (existing transform, execute, server, format tests + new magic and output tests)

- [ ] **Step 2: Build UI**

```bash
bun run build:ui
```

Expected: Build succeeds

- [ ] **Step 3: Rebuild embedded assets**

```bash
bun run build:embed
```

Expected: `src/assets.ts` regenerated with new UI assets

- [ ] **Step 4: Start dev server and verify**

```bash
bun src/cli.ts new
```

Manual verification checklist:
1. Monaco Editor loads in code cells (no textarea visible)
2. Syntax highlighting works for TypeScript
3. Theme switches between light/dark correctly
4. Run a cell: `const x = 42; x` — shows result
5. Run `%install lodash` — shows install progress, then success
6. Run `[{name: "Alice", age: 30}, {name: "Bob", age: 25}]` — shows sortable table
7. Run `({__type: "chart", data: [10,20,30,40], config: {chartType: "bar", label: "Sales"}})` — shows bar chart
8. Run `({__type: "html", html: "<h2>Hello <b>world</b></h2>"})` — shows rendered HTML
9. Run `{name: "Alice", tags: ["admin", "user"]}` — shows collapsible JSON tree
10. Shift+Enter runs cell and advances
11. Ctrl+Enter runs cell and stays

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address any issues found during verification"
```
