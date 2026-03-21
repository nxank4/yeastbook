// src/kernel/transform.ts

const STATEMENT_PREFIXES = [
  "var ", "let ", "const ", "if ", "if(", "for ", "for(",
  "while ", "while(", "do ", "do{", "class ", "function ",
  "return ", "throw ", "try ", "try{", "switch ", "switch(",
  "import ", "export ", "{", "//", "/*",
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

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;
    const trimmed = line.trimStart();
    const indent = line.substring(0, line.length - trimmed.length);

    // At top level (braceDepth === 0), convert const/let to var
    if (braceDepth === 0) {
      if (trimmed.startsWith("const ")) {
        line = indent + "var " + trimmed.slice(6);
      } else if (trimmed.startsWith("let ")) {
        line = indent + "var " + trimmed.slice(4);
      }
    }

    transformed.push(line);

    // Track brace depth (simple counter - good enough for typical notebook code)
    for (const ch of trimmed) {
      if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth = Math.max(0, braceDepth - 1);
    }
  }

  // Hoist var declarations to globalThis for cross-cell persistence
  for (let i = 0; i < transformed.length; i++) {
    const line = transformed[i]!;
    const trimmedLine = line.trimStart();
    const lineIndent = line.substring(0, line.length - trimmedLine.length);

    // Simple var: var name = expr
    const simpleMatch = trimmedLine.match(/^var\s+(\w+)\s*=\s*(.+)$/);
    if (simpleMatch) {
      transformed[i] = `${lineIndent}var ${simpleMatch[1]} = globalThis.${simpleMatch[1]} = ${simpleMatch[2]}`;
      continue;
    }

    // Destructuring var: var { a, b } = expr  OR  var [x, y] = expr
    const destructMatch = trimmedLine.match(/^var\s+(\{[^}]+\}|\[[^\]]+\])\s*=\s*(.+)$/);
    if (destructMatch) {
      const pattern = destructMatch[1];
      const expr = destructMatch[2];
      const names = pattern.replace(/[{}\[\]\s\.]+/g, " ").trim().split(/\s*,\s*|\s+/).filter(n => /^\w+$/.test(n));
      const assignments = names.map(n => `globalThis.${n} = ${n}`).join("; ");
      transformed[i] = `${lineIndent}var ${pattern} = ${expr}; ${assignments}`;
      continue;
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
