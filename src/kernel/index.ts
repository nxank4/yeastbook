// src/kernel/index.ts

export interface ExecResult {
  value: unknown;
  stdout: string;
  stderr: string;
  error?: { ename: string; evalue: string; traceback: string[] };
}

const STATEMENT_PREFIXES = [
  "let ", "const ", "var ", "if ", "if(", "for ", "for(",
  "while ", "while(", "do ", "do{", "class ", "function ",
  "return ", "throw ", "try ", "try{", "switch ", "switch(",
  "import ", "export ", "{", "//", "/*",
];

function shouldReturnLastLine(line: string): boolean {
  const trimmed = line.trimStart();
  return !STATEMENT_PREFIXES.some((p) => trimmed.startsWith(p));
}

/** Rewrite `var x = expr` to `var x = globalThis.x = expr` so vars persist. */
function hoistVarDeclarations(code: string): string {
  // Match simple `var name = expr` patterns (single declarator per line)
  return code.replace(
    /^(\s*)var\s+(\w+)\s*=\s*(.+)$/gm,
    "$1var $2 = globalThis.$2 = $3",
  );
}

function wrapCode(code: string): string {
  let processed = hoistVarDeclarations(code);
  const lines = processed.split("\n");
  // Find last non-empty line
  let lastIdx = lines.length - 1;
  while (lastIdx >= 0 && !lines[lastIdx]!.trim()) {
    lastIdx--;
  }
  if (lastIdx < 0) return processed;

  const lastLine = lines[lastIdx]!;
  if (shouldReturnLastLine(lastLine)) {
    lines[lastIdx] = `return (${lastLine.trim().replace(/;$/, "")})`;
  }
  return lines.join("\n");
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
    const wrapped = wrapCode(code);
    const fn = new AsyncFunction(wrapped);
    const value = await fn();

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
