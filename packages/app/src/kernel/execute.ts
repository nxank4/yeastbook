// src/kernel/execute.ts

import { $ } from "bun";
import { Transpiler } from "bun";
import { transformCellCode, createSlider, createInput, createToggle, createSelect } from "@yeastbook/core";

const transpiler = new Transpiler({
  loader: "ts",
  target: "bun",
});

/**
 * Transpile TypeScript to JavaScript, wrapping in a function to prevent
 * Bun's dead-code elimination from stripping expression statements.
 */
function transpileTS(code: string): string {
  // Wrap in async function to prevent DCE of expression statements
  const wrapped = `async function __yb_cell__() {\n${code}\n}`;
  const result = transpiler.transformSync(wrapped);
  // Extract function body (between first { and last })
  const start = result.indexOf("{") + 1;
  const end = result.lastIndexOf("}");
  if (start <= 0 || end <= start) return code;
  return result.slice(start, end).trim();
}

// Interrupt mechanism — allows cancelling execution between async yields
let interruptReject: ((err: Error) => void) | null = null;

export function interruptExecution(): void {
  if (interruptReject) {
    interruptReject(new Error("KeyboardInterrupt"));
    interruptReject = null;
  }
}

export interface ExecResult {
  value: unknown;
  stdout: string;
  stderr: string;
  tables: Record<string, unknown>[];
  error?: { ename: string; evalue: string; traceback: string[] };
}

/**
 * Ensure all `var x = expr` lines in the wrapped code also assign to globalThis.
 * This is a safety net — even if transformCellCode's hoisting doesn't work
 * (stale module cache, etc.), this guarantees vars escape the IIFE scope.
 */
function ensureGlobalThisHoisting(wrapped: string): string {
  return wrapped.replace(
    /^(\s*)var\s+([a-zA-Z_$]\w*)\s*=\s*(.+)$/gm,
    (_match, indent, name, expr) => {
      // Skip if already has globalThis hoisting
      if (expr.trimStart().startsWith(`globalThis.${name}`)) return _match;
      return `${indent}var ${name} = globalThis.${name} = ${expr}`;
    }
  ).replace(
    // Destructuring: var { a, b } = expr  →  var { a, b } = expr; globalThis.a = a; globalThis.b = b
    /^(\s*)var\s+(\{[^}]+\})\s*=\s*(.+?)(?:;\s*globalThis\.\w+.*)?$/gm,
    (_match, indent, pattern, expr) => {
      // Don't double-process if globalThis assignments already exist
      if (_match.includes("globalThis.")) return _match;
      const names = pattern.replace(/[{}\s]+/g, " ").trim().split(/\s*,\s*/)
        .map((n: string) => n.split(":").pop()!.split("=")[0]!.trim())
        .filter((n: string) => /^[a-zA-Z_$]\w*$/.test(n));
      const assignments = names.map((n: string) => `globalThis.${n} = ${n}`).join("; ");
      return `${indent}var ${pattern} = ${expr}; ${assignments}`;
    }
  ).replace(
    // Array destructuring: var [x, y] = expr
    /^(\s*)var\s+(\[[^\]]+\])\s*=\s*(.+?)(?:;\s*globalThis\.\w+.*)?$/gm,
    (_match, indent, pattern, expr) => {
      if (_match.includes("globalThis.")) return _match;
      const names = pattern.replace(/[\[\]\s]+/g, " ").trim().split(/\s*,\s*/)
        .map((n: string) => n.split("=")[0]!.trim())
        .filter((n: string) => /^[a-zA-Z_$]\w*$/.test(n));
      const assignments = names.map((n: string) => `globalThis.${n} = ${n}`).join("; ");
      return `${indent}var ${pattern} = ${expr}; ${assignments}`;
    }
  );
}

export async function executeCode(
  code: string,
  context: Record<string, unknown>,
): Promise<ExecResult> {
  let stdout = "";
  let stderr = "";
  const tables: Record<string, unknown>[] = [];

  // Inject context into globalThis
  Object.assign(globalThis, context);

  // Snapshot globalThis keys AFTER injection so we can detect truly new keys
  const keysBefore = new Set(Object.keys(globalThis));

  // Override process.exit/abort to prevent user code from killing the server
  const origExit = process.exit;
  const origAbort = process.abort;
  let exitCalled = false;
  process.exit = ((code?: number) => {
    exitCalled = true;
    throw new Error(`Cell called process.exit(${code ?? 0}) — kernel restart required`);
  }) as any;
  process.abort = (() => {
    throw new Error("Cell called process.abort() — kernel restart required");
  }) as any;

  // Monkey-patch console
  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;

  console.log = (...args: unknown[]) => {
    stdout += args.map((a) => (typeof a === "string" ? a : Bun.inspect(a))).join(" ") + "\n";
  };
  console.error = (...args: unknown[]) => {
    stderr += args.map((a) => (typeof a === "string" ? a : Bun.inspect(a))).join(" ") + "\n";
  };
  console.warn = (...args: unknown[]) => {
    stderr += args.map((a) => (typeof a === "string" ? a : Bun.inspect(a))).join(" ") + "\n";
  };
  const origTable = console.table;
  console.table = (data: unknown) => {
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object" && data[0] !== null) {
      for (const row of data) tables.push(row as Record<string, unknown>);
    } else {
      stdout += (typeof data === "string" ? data : Bun.inspect(data)) + "\n";
    }
  };

  try {
    // Transpile TypeScript → JavaScript before transform
    let jsCode: string;
    try {
      jsCode = transpileTS(code);
    } catch {
      // Transpile failed — try running as-is (may be plain JS)
      jsCode = code;
    }

    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    let wrapped = transformCellCode(jsCode);

    // Safety net: ensure globalThis hoisting even if transform didn't do it
    wrapped = ensureGlobalThisHoisting(wrapped);

    process.stderr.write(`[kernel] transformed:\n${wrapped}\n`);

    const fn = new AsyncFunction("$", "Bun", "createSlider", "createInput", "createToggle", "createSelect", wrapped);
    const interruptPromise = new Promise<never>((_, reject) => {
      interruptReject = reject;
    });
    const value = await Promise.race([
      fn($, Bun, createSlider, createInput, createToggle, createSelect),
      interruptPromise,
    ]);
    interruptReject = null;

    // Capture new globalThis keys into context
    const newKeys: string[] = [];
    for (const key of Object.keys(globalThis)) {
      if (!keysBefore.has(key)) {
        context[key] = (globalThis as Record<string, unknown>)[key];
        newKeys.push(key);
      }
    }
    // Also sync existing context keys that may have been reassigned
    for (const key of Object.keys(context)) {
      if (key in globalThis) {
        context[key] = (globalThis as Record<string, unknown>)[key];
      }
    }

    process.stderr.write(`[kernel] context: [${Object.keys(context).join(", ")}]${newKeys.length > 0 ? ` (new: ${newKeys.join(", ")})` : ""}\n`);

    return { value, stdout, stderr, tables };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    const ename = exitCalled ? "ProcessExitError" : error.constructor.name;
    return {
      value: undefined,
      stdout,
      stderr,
      tables,
      error: {
        ename,
        evalue: error.message,
        traceback: exitCalled
          ? ["Cell attempted to exit the process. Use Restart Kernel to reset."]
          : (error.stack ?? "").split("\n"),
      },
    };
  } finally {
    process.exit = origExit;
    process.abort = origAbort;
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
    console.table = origTable;
  }
}
