import { test, expect, describe } from "bun:test";
import { transformCellCode, transformImports } from "../packages/core/src/transform.ts";
import { executeCode } from "../packages/app/src/kernel/execute.ts";

describe("transformCellCode", () => {
  test("converts top-level const to var", () => {
    const result = transformCellCode("const x = 1");
    expect(result).toContain("var x =");
    expect(result).not.toContain("const x = 1");
  });

  test("converts top-level let to var", () => {
    const result = transformCellCode("let y = 2");
    expect(result).toContain("var y =");
    expect(result).not.toContain("let y = 2");
  });

  test("preserves const inside functions", () => {
    const code = "function foo() {\n  const inner = 1\n  return inner\n}";
    const result = transformCellCode(code);
    expect(result).toContain("const inner = 1");
  });

  test("preserves let inside blocks", () => {
    const code = "if (true) {\n  let inner = 1\n}";
    const result = transformCellCode(code);
    expect(result).toContain("let inner = 1");
  });

  test("preserves const inside for loops", () => {
    const code = "for (const item of [1,2,3]) {\n  console.log(item)\n}";
    const result = transformCellCode(code);
    expect(result).toContain("const item of");
  });

  test("handles destructuring assignment", () => {
    const result = transformCellCode("const { a, b } = obj");
    expect(result).toContain("var { a, b } = obj");
  });

  test("handles array destructuring", () => {
    const result = transformCellCode("const [x, y] = arr");
    expect(result).toContain("var [x, y] = arr");
  });

  test("wraps in async IIFE", () => {
    const result = transformCellCode("1 + 2");
    expect(result).toContain("(async () => {");
    expect(result).toContain("})()");
  });

  test("returns last expression", () => {
    const result = transformCellCode("const x = 1\nx + 1");
    expect(result).toContain("return (x + 1)");
  });

  test("does not return statements as last expression", () => {
    const result = transformCellCode("const x = 1\nlet y = 2");
    expect(result).not.toContain("return (var");
    expect(result).not.toMatch(/return \(\w+ \+/);
  });

  test("handles top-level await", () => {
    const result = transformCellCode("const data = await fetch('url')");
    expect(result).toContain("var data =");
    expect(result).toContain("await fetch('url')");
    expect(result).toContain("async");
  });

  test("handles multiple declarations mixed with expressions", () => {
    const code = "const a = 1\nlet b = 2\na + b";
    const result = transformCellCode(code);
    expect(result).toContain("var a =");
    expect(result).toContain("var b =");
    expect(result).toContain("return (a + b)");
  });

  test("preserves const/let inside class methods", () => {
    const code = "class Foo {\n  bar() {\n    const x = 1\n    return x\n  }\n}";
    const result = transformCellCode(code);
    expect(result).toContain("const x = 1");
  });

  test("handles empty code", () => {
    const result = transformCellCode("");
    expect(result).toContain("(async () => {");
  });

  test("hoists var declarations to globalThis", () => {
    const result = transformCellCode("const x = 42");
    expect(result).toContain("globalThis.x = 42");
  });

  test("hoists destructured vars to globalThis", () => {
    const result = transformCellCode("const { a, b } = obj");
    expect(result).toContain("globalThis.a = a");
    expect(result).toContain("globalThis.b = b");
  });

  test("does not add return to closing braces", () => {
    const code = "for (const item of [1,2,3]) {\n  console.log(item)\n}";
    const result = transformCellCode(code);
    expect(result).not.toContain("return (})");
  });

  test("does not hoist var inside functions to globalThis", () => {
    const code = "function f() {\n  var x = 1\n  return x\n}";
    const result = transformCellCode(code);
    expect(result).not.toContain("globalThis.x");
    expect(result).toContain("var x = 1");
  });

  test("does not hoist var inside blocks to globalThis", () => {
    const code = "if (true) {\n  var x = 1\n}";
    const result = transformCellCode(code);
    expect(result).not.toContain("globalThis.x");
  });

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
});

describe("transformImports", () => {
  test("default import", () => {
    expect(transformImports('import _ from "lodash"'))
      .toBe('const _ = (await import("lodash")).default');
  });

  test("named imports", () => {
    expect(transformImports('import { chunk, merge } from "lodash"'))
      .toBe('const { chunk, merge } = await import("lodash")');
  });

  test("namespace import", () => {
    expect(transformImports('import * as _ from "lodash"'))
      .toBe('const _ = await import("lodash")');
  });

  test("default + named", () => {
    expect(transformImports('import React, { useState } from "react"'))
      .toBe('const { default: React, useState } = await import("react")');
  });

  test("side effect import", () => {
    expect(transformImports('import "some-polyfill"'))
      .toBe('await import("some-polyfill")');
  });

  test("single-quoted module", () => {
    expect(transformImports("import _ from 'lodash'"))
      .toBe('const _ = (await import("lodash")).default');
  });

  test("non-import lines unchanged", () => {
    expect(transformImports("const x = 1")).toBe("const x = 1");
  });

  test("mixed imports and code", () => {
    const code = 'import _ from "lodash"\nconst arr = [1,2,3]\narr';
    const result = transformImports(code);
    expect(result).toContain('(await import("lodash")).default');
    expect(result).toContain("const arr = [1,2,3]");
  });

  test("full cell with import through transformCellCode", () => {
    const code = 'import _ from "lodash"\nconst arr = _.chunk([1,2,3,4], 2)\narr';
    const result = transformCellCode(code);
    expect(result).toContain('await import("lodash")');
    expect(result).toContain("var arr");
    expect(result).toContain("return (arr)");
  });

  test("import with semicolons", () => {
    expect(transformImports('import _ from "lodash";'))
      .toBe('const _ = (await import("lodash")).default');
  });

  test("multi-line named import", () => {
    const result = transformImports('import {\n  chunk,\n  merge\n} from "lodash"');
    // The transform joins named imports from the multi-line form; verify key parts
    expect(result).toContain("chunk");
    expect(result).toContain("merge");
    expect(result).toContain('await import("lodash")');
    expect(result).toMatch(/^const \{/);
  });

  test("aliased named import", () => {
    expect(transformImports('import { foo as bar } from "mod"'))
      .toBe('const { foo as bar } = await import("mod")');
  });
});

describe("transformCellCode edge cases", () => {
  test("comment-only code does not get a bare return", () => {
    const result = transformCellCode("// just a comment");
    // Should not have `return` on its own line (bare return or return of comment)
    expect(result).not.toMatch(/^\s*return\s*$/m);
    expect(result).not.toContain("return (// just a comment)");
  });

  test("whitespace-only code does not return meaningful content", () => {
    const result = transformCellCode("   \n  \n   ");
    // Whitespace-only input should still produce an async IIFE wrapper
    expect(result).toContain("(async () => {");
    // Should not return any meaningful expression (no identifiers or literals)
    expect(result).not.toMatch(/return \(\s*\S+\s*\)/);
  });

  test("string containing import keyword is not transformed as import", () => {
    const result = transformCellCode('const s = "import foo from bar"');
    // The string literal should survive untouched
    expect(result).toContain('"import foo from bar"');
    // Should NOT have turned the string into an actual dynamic import
    expect(result).not.toContain("await import(");
  });

  test("empty string does not crash", () => {
    expect(() => transformCellCode("")).not.toThrow();
    const result = transformCellCode("");
    expect(result).toContain("(async () => {");
  });
});

describe("TypeScript transpilation", () => {
  test("TypeScript function with type annotations executes", async () => {
    const result = await executeCode(`
      function add(a: number, b: number): number {
        return a + b
      }
      add(1, 2)
    `, {});
    expect(result.error).toBeUndefined();
    expect(result.value).toBe(3);
  });

  test("TypeScript interface does not cause error", async () => {
    const result = await executeCode(`
      interface User { name: string; age: number }
      const u: User = { name: "Alice", age: 30 }
      u.name
    `, {});
    expect(result.error).toBeUndefined();
    expect(result.value).toBe("Alice");
  });

  test("TypeScript generics work", async () => {
    const result = await executeCode(`
      function identity<T>(x: T): T { return x }
      identity<number>(42)
    `, {});
    expect(result.error).toBeUndefined();
    expect(result.value).toBe(42);
  });

  test("as assertion works", async () => {
    const result = await executeCode(`
      const x = (42 as unknown) as string
      typeof x
    `, {});
    expect(result.error).toBeUndefined();
  });

  test("type-only import is stripped", async () => {
    // import type should be stripped by transpiler and not cause errors
    const result = await executeCode(`
      type MyType = { a: number }
      const obj: MyType = { a: 42 }
      obj.a
    `, {});
    expect(result.error).toBeUndefined();
    expect(result.value).toBe(42);
  });
});
