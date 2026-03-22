// src/kernel/execute.ts

import { $ } from "bun";
import { transformCellCode, createSlider, createInput, createToggle, createSelect } from "@yeastbook/core";

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

export async function executeCode(
  code: string,
  context: Record<string, unknown>,
): Promise<ExecResult> {
  let stdout = "";
  let stderr = "";
  const tables: Record<string, unknown>[] = [];

  // Snapshot globalThis keys before execution
  const keysBefore = new Set(Object.keys(globalThis));

  // Inject context into globalThis
  Object.assign(globalThis, context);

  // Override process.exit/abort to prevent user code from killing the server
  const origExit = process.exit;
  const origAbort = process.abort;
  let exitCalled = false;
  let exitCode: number | undefined;
  process.exit = ((code?: number) => {
    exitCalled = true;
    exitCode = code;
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
      // Store raw data for rich table rendering
      for (const row of data) tables.push(row as Record<string, unknown>);
    } else {
      stdout += (typeof data === "string" ? data : Bun.inspect(data)) + "\n";
    }
  };

  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const wrapped = transformCellCode(code);
    // Expose Bun Shell ($) and Bun APIs as named parameters in cell context
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
    for (const key of Object.keys(globalThis)) {
      if (!keysBefore.has(key)) {
        context[key] = (globalThis as Record<string, unknown>)[key];
      }
    }

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
