// src/kernel/transform.ts

const STATEMENT_PREFIXES = [
  "var ", "let ", "const ", "if ", "if(", "for ", "for(",
  "while ", "while(", "do ", "do{", "class ", "function ",
  "return ", "throw ", "try ", "try{", "switch ", "switch(",
  "import ", "export ", "{", "}", "]", ")", "//", "/*",
];

function isStatement(line: string): boolean {
  const trimmed = line.trimStart();
  return STATEMENT_PREFIXES.some((p) => trimmed.startsWith(p));
}

/**
 * Transform cell code for notebook execution:
 * 1. Convert top-level const/let to var (for cross-cell variable persistence)
 * 2. Hoist var declarations to globalThis
 * 3. Wrap in async IIFE (for top-level await support)
 * 4. Return last expression as result
 */
export function transformCellCode(code: string): string {
  const lines = code.split("\n");
  const transformed: string[] = [];
  let braceDepth = 0;

  // Single pass: convert const/let → var and hoist to globalThis (top-level only)
  // Note: brace depth tracking is a simple character counter that doesn't account for
  // braces inside string literals, template literals, comments, or regex. This is a known
  // limitation acceptable for typical notebook code.
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;
    const trimmed = line.trimStart();
    const indent = line.substring(0, line.length - trimmed.length);

    if (braceDepth === 0) {
      // Convert top-level const/let → var
      if (trimmed.startsWith("const ")) {
        line = indent + "var " + trimmed.slice(6);
      } else if (trimmed.startsWith("let ")) {
        line = indent + "var " + trimmed.slice(4);
      }

      // Hoist top-level var declarations to globalThis for cross-cell persistence
      const trimmedAfter = line.trimStart();
      const indentAfter = line.substring(0, line.length - trimmedAfter.length);

      const simpleMatch = trimmedAfter.match(/^var\s+(\w+)\s*=\s*(.+)$/);
      if (simpleMatch) {
        line = `${indentAfter}var ${simpleMatch[1]} = globalThis.${simpleMatch[1]} = ${simpleMatch[2]}`;
      } else {
        // Destructuring: var { a, b } = expr  OR  var [x, y] = expr
        // Known limitation: nested destructuring ({ a: { b } }) is not supported.
        const destructMatch = trimmedAfter.match(/^var\s+(\{[^}]+\}|\[[^\]]+\])\s*=\s*(.+)$/);
        if (destructMatch) {
          const pattern = destructMatch[1];
          const expr = destructMatch[2];
          const names = pattern.replace(/[{}\[\]\s\.]+/g, " ").trim().split(/\s*,\s*|\s+/).filter(n => /^\w+$/.test(n));
          const assignments = names.map(n => `globalThis.${n} = ${n}`).join("; ");
          line = `${indentAfter}var ${pattern} = ${expr}; ${assignments}`;
        }
      }
    }

    transformed.push(line);

    // Track brace depth
    for (const ch of trimmed) {
      if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth = Math.max(0, braceDepth - 1);
    }
  }

  // Find last non-empty line and make it a return if it's an expression
  let lastIdx = transformed.length - 1;
  while (lastIdx >= 0 && !transformed[lastIdx]!.trim()) {
    lastIdx--;
  }
  if (lastIdx >= 0) {
    const lastLine = transformed[lastIdx]!;
    const trimmedLast = lastLine.trimStart();
    if (!isStatement(trimmedLast)) {
      const leadingSpace = lastLine.substring(0, lastLine.length - trimmedLast.length);
      transformed[lastIdx] = leadingSpace + "return (" + trimmedLast.replace(/;$/, "") + ")";
    }
  }

  // Wrap in async IIFE
  return "return (async () => {\n" + transformed.join("\n") + "\n})()";
}
