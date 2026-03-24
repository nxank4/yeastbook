// src/kernel/transform.ts

const STATEMENT_PREFIXES = [
  "var ", "let ", "const ", "if ", "if(", "for ", "for(",
  "while ", "while(", "do ", "do{", "class ", "function ",
  "return ", "throw ", "try ", "try{", "switch ", "switch(",
  "import ", "export ", "//", "/*",
];

function isStatement(line: string): boolean {
  const trimmed = line.trimStart();
  if (STATEMENT_PREFIXES.some((p) => trimmed.startsWith(p))) return true;
  // Bare block-closing: only `}` or `};` (no parens/brackets = not an expression)
  // But `})`, `}))`, `}]);` etc. are expression continuations — not statements
  const clean = trimmed.replace(/;$/, "").trim();
  if (/^}+$/.test(clean)) return true;  // bare closing braces only
  return false;
}

/**
 * Transform static ESM imports to dynamic await import() for eval context.
 * Must run before const/let transformation since it produces const declarations.
 */
export function transformImports(code: string): string {
  const lines = code.split("\n");
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trimStart();

    if (!trimmed.startsWith("import ")) {
      result.push(lines[i]!);
      continue;
    }

    // Collect full import statement (may span multiple lines with { })
    let full = lines[i]!;
    let j = i;
    // Keep consuming lines if we haven't found both `from` and a closing quote
    while (j < lines.length - 1) {
      const hasSideEffect = /^import\s+["']/.test(full.trim());
      const hasFrom = /from\s+["'][^"']+["']/.test(full);
      if (hasSideEffect || hasFrom) break;
      j++;
      full += "\n" + lines[j]!;
    }
    i = j;

    result.push(transformSingleImport(full.trim()));
  }

  return result.join("\n");
}

function transformSingleImport(stmt: string): string {
  // Side effect import: import "module" or import 'module'
  const sideEffect = stmt.match(/^import\s+["']([^"']+)["']\s*;?$/);
  if (sideEffect) return `await import("${sideEffect[1]}")`;

  // Extract module name from `from "..."` or `from '...'`
  const moduleMatch = stmt.match(/from\s+["']([^"']+)["']/);
  if (!moduleMatch) return stmt;
  const mod = moduleMatch[1];

  // Extract import clause (everything between "import" and "from")
  const clauseMatch = stmt.match(/^import\s+([\s\S]+?)\s+from\s+["'][^"']+["']/);
  if (!clauseMatch) return stmt;
  const clause = clauseMatch[1]!.replace(/\n/g, " ").trim();

  // Namespace: import * as name from "..."
  const ns = clause.match(/^\*\s+as\s+(\w+)$/);
  if (ns) return `const ${ns[1]} = await import("${mod}")`;

  // Default only: import name from "..."
  const def = clause.match(/^(\w+)$/);
  if (def) return `const ${def[1]} = (await import("${mod}")).default`;

  // Named only: import { a, b } from "..."
  const named = clause.match(/^\{([^}]+)\}$/);
  if (named) return `const {${named[1]!.replace(/\n/g, " ")}} = await import("${mod}")`;

  // Default + named: import def, { a, b } from "..."
  const defNamed = clause.match(/^(\w+)\s*,\s*\{([^}]+)\}$/);
  if (defNamed) return `const { default: ${defNamed[1]}, ${defNamed[2]!.replace(/\n/g, " ").trim()} } = await import("${mod}")`;

  // Default + namespace: import def, * as ns from "..."
  const defNs = clause.match(/^(\w+)\s*,\s*\*\s+as\s+(\w+)$/);
  if (defNs) return `const ${defNs[2]} = await import("${mod}"); const ${defNs[1]} = ${defNs[2]}.default`;

  return stmt;
}

/**
 * Find the start index of a // line comment, ignoring // inside string literals.
 * Returns -1 if no line comment is found.
 */
function findLineCommentStart(line: string): number {
  let inString: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inString) {
      if (ch === "\\" ) { i++; continue; }
      if (ch === inString) inString = null;
    } else {
      if (ch === '"' || ch === "'" || ch === "`") { inString = ch; continue; }
      if (ch === "/" && line[i + 1] === "/") return i;
    }
  }
  return -1;
}

/**
 * Transform cell code for notebook execution:
 * 1. Transform static ESM imports to dynamic await import()
 * 2. Convert top-level const/let to var (for cross-cell variable persistence)
 * 3. Hoist var declarations to globalThis
 * 4. Wrap in async IIFE (for top-level await support)
 * 5. Return last expression as result
 */
export function transformCellCode(code: string): string {
  // Transform static imports first (produces const declarations that get handled below)
  code = transformImports(code);
  const lines = code.split("\n");
  const transformed: string[] = [];
  let braceDepth = 0;
  let pendingFuncHoist: string | null = null;

  // Single pass: convert const/let → var and hoist to globalThis (top-level only)
  // Note: brace depth tracking is a simple character counter that doesn't account for
  // braces inside string literals, template literals, comments, or regex. This is a known
  // limitation acceptable for typical notebook code.
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;
    const trimmed = line.trimStart();
    const indent = line.substring(0, line.length - trimmed.length);

    if (braceDepth === 0) {
      // Strip top-level export keyword
      if (trimmed.startsWith("export ")) {
        const afterExport = trimmed.slice(7);
        if (/^(const |let |var |function |class )/.test(afterExport)) {
          line = indent + afterExport;
        }
      }

      // Re-read trimmed/indent after potential export strip
      const trimmed2 = line.trimStart();
      const indent2 = line.substring(0, line.length - trimmed2.length);

      // Convert top-level const/let → var
      if (trimmed2.startsWith("const ")) {
        line = indent2 + "var " + trimmed2.slice(6);
      } else if (trimmed2.startsWith("let ")) {
        line = indent2 + "var " + trimmed2.slice(4);
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
          const pattern = destructMatch[1]!;
          const expr = destructMatch[2]!;
          const names = pattern.replace(/[{}\[\]\s\.]+/g, " ").trim().split(/\s*,\s*|\s+/).filter(n => /^\w+$/.test(n));
          const assignments = names.map(n => `globalThis.${n} = ${n}`).join("; ");
          line = `${indentAfter}var ${pattern} = ${expr}; ${assignments}`;
        }
      }

      // Mark top-level function declarations for globalThis hoisting
      const funcMatch = trimmed2.match(/^function\s+([a-zA-Z_$]\w*)\s*\(/);
      if (funcMatch) {
        pendingFuncHoist = funcMatch[1]!;
      }
    }

    transformed.push(line);

    // Track brace depth — strip comments before counting to avoid braces in comments
    const codeOnly = trimmed.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
    for (const ch of codeOnly) {
      if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth = Math.max(0, braceDepth - 1);
    }

    // When a function body closes, hoist it to globalThis
    if (pendingFuncHoist && braceDepth === 0) {
      transformed.push(`globalThis.${pendingFuncHoist} = ${pendingFuncHoist};`);
      pendingFuncHoist = null;
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
      const commentIdx = findLineCommentStart(trimmedLast);
      if (commentIdx >= 0) {
        const codePart = trimmedLast.slice(0, commentIdx).trimEnd().replace(/;$/, "");
        const comment = trimmedLast.slice(commentIdx);
        transformed[lastIdx] = leadingSpace + "return (" + codePart + ")  " + comment;
      } else {
        transformed[lastIdx] = leadingSpace + "return (" + trimmedLast.replace(/;$/, "") + ")";
      }
    }
  }

  // Wrap in async IIFE
  return "return (async () => {\n" + transformed.join("\n") + "\n})()";
}
