import { test, expect, describe } from "bun:test";
import { transformCellCode } from "../packages/core/src/transform.ts";

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
