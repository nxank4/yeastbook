// src/kernel/execute.ts

import { $ } from "bun";
import { transformCellCode, createSlider, createInput, createToggle, createSelect } from "@yeastbook/core";

export interface ExecResult {
  value: unknown;
  stdout: string;
  stderr: string;
  error?: { ename: string; evalue: string; traceback: string[] };
}

export async function executeCode(
  code: string,
  context: Record<string, unknown>,
): Promise<ExecResult> {
  let stdout = "";
  let stderr = "";

  // Snapshot globalThis keys before execution
  const keysBefore = new Set(Object.keys(globalThis));

  // Inject context into globalThis
  Object.assign(globalThis, context);

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

  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const wrapped = transformCellCode(code);
    // Expose Bun Shell ($) and Bun APIs as named parameters in cell context
    const fn = new AsyncFunction("$", "Bun", "createSlider", "createInput", "createToggle", "createSelect", wrapped);
    const value = await fn($, Bun, createSlider, createInput, createToggle, createSelect);

    // Capture new globalThis keys into context
    for (const key of Object.keys(globalThis)) {
      if (!keysBefore.has(key)) {
        context[key] = (globalThis as Record<string, unknown>)[key];
      }
    }

    return { value, stdout, stderr };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      value: undefined,
      stdout,
      stderr,
      error: {
        ename: error.constructor.name,
        evalue: error.message,
        traceback: (error.stack ?? "").split("\n"),
      },
    };
  } finally {
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
  }
}
