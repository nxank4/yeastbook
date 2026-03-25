// tests/kernel.test.ts
import { test, expect, describe } from "bun:test";
import { executeCode } from "../packages/app/src/kernel/execute.ts";

describe("executeCode", () => {
  test("returns last expression value", async () => {
    const result = await executeCode("1 + 2", {});
    expect(result.value).toBe(3);
    expect(result.error).toBeUndefined();
  });

  test("captures console.log output", async () => {
    const result = await executeCode('console.log("hello")', {});
    expect(result.stdout).toContain("hello");
  });

  test("captures console.error as stderr", async () => {
    const result = await executeCode('console.error("oops")', {});
    expect(result.stderr).toContain("oops");
  });

  test("persists variables across calls via context", async () => {
    const ctx: Record<string, unknown> = {};
    await executeCode("var x = 42", ctx);
    const result = await executeCode("x", ctx);
    expect(result.value).toBe(42);
  });

  test("returns undefined for statements", async () => {
    const result = await executeCode("let a = 1", {});
    expect(result.value).toBeUndefined();
  });

  test("catches errors and returns traceback", async () => {
    const result = await executeCode("throw new Error('boom')", {});
    expect(result.error).toBeDefined();
    expect(result.error!.ename).toBe("Error");
    expect(result.error!.evalue).toBe("boom");
    expect(result.error!.traceback.length).toBeGreaterThan(0);
  });

  test("handles async code", async () => {
    const result = await executeCode("await Promise.resolve(99)", {});
    expect(result.value).toBe(99);
  });

  test("does not return value for for-loops", async () => {
    const result = await executeCode("for (let i = 0; i < 3; i++) {}", {});
    expect(result.value).toBeUndefined();
  });

  test("does not return value for if-statements", async () => {
    const result = await executeCode("if (true) { 42 }", {});
    expect(result.value).toBeUndefined();
  });

  test("handles trailing semicolons on expressions", async () => {
    const result = await executeCode("1 + 2;", {});
    expect(result.value).toBe(3);
  });

  test("handles multiline code with last expression", async () => {
    const result = await executeCode("const a = 10\nconst b = 20\na + b", {});
    expect(result.value).toBe(30);
  });

  test("persists const variables across cells via context", async () => {
    const ctx: Record<string, unknown> = {};
    await executeCode("const x = 42", ctx);
    const result = await executeCode("x", ctx);
    expect(result.value).toBe(42);
  });

  test("persists let variables across cells via context", async () => {
    const ctx: Record<string, unknown> = {};
    await executeCode("let y = 'hello'", ctx);
    const result = await executeCode("y", ctx);
    expect(result.value).toBe("hello");
  });

  test("top-level await with const works", async () => {
    const ctx: Record<string, unknown> = {};
    await executeCode("const val = await Promise.resolve(123)", ctx);
    const result = await executeCode("val", ctx);
    expect(result.value).toBe(123);
  });

  test("const inside function stays const", async () => {
    const result = await executeCode(
      "function foo() { const x = 1; return x }\nfoo()",
      {}
    );
    expect(result.value).toBe(1);
  });

  test("destructured const persists across cells", async () => {
    const ctx: Record<string, unknown> = {};
    await executeCode("const { a, b } = { a: 10, b: 20 }", ctx);
    const result = await executeCode("a + b", ctx);
    expect(result.value).toBe(30);
  });

  test("array destructured let persists across cells", async () => {
    const ctx: Record<string, unknown> = {};
    await executeCode("let [x, y] = [3, 4]", ctx);
    const result = await executeCode("x * y", ctx);
    expect(result.value).toBe(12);
  });

  test("error includes traceback lines", async () => {
    const result = await executeCode("const a = 1\nundefinedVar.foo", {});
    expect(result.error).toBeDefined();
    expect(result.error!.ename).toBe("ReferenceError");
    expect(result.error!.traceback.length).toBeGreaterThan(0);
  });

  test("console.warn output goes to stderr", async () => {
    const result = await executeCode('console.warn("warning msg")', {});
    expect(result.stderr).toContain("warning msg");
  });

  test("console.table with array of objects populates tables", async () => {
    const result = await executeCode("console.table([{a:1},{a:2}])", {});
    expect(Array.isArray(result.tables)).toBe(true);
    expect(result.tables).toHaveLength(2);
  });

  test("TypeScript generics in function return correct value", async () => {
    const result = await executeCode(`
      function typed<T>(v: T): T { return v }
      typed<number>(42)
    `, {});
    expect(result.error).toBeUndefined();
    expect(result.value).toBe(42);
  });

  test("thrown error has traceback array with length > 0", async () => {
    const result = await executeCode('throw new Error("test")', {});
    expect(result.error).toBeDefined();
    expect(Array.isArray(result.error!.traceback)).toBe(true);
    expect(result.error!.traceback.length).toBeGreaterThan(0);
  });

  test("console.log without return expression leaves value undefined", async () => {
    const result = await executeCode('console.log("hello")', {});
    expect(result.value).toBeUndefined();
  });

  test("awaited empty-string promise has undefined value", async () => {
    const result = await executeCode('await Promise.resolve("")', {});
    // Empty string is falsy but defined — value should be empty string
    expect(result.error).toBeUndefined();
    expect(result.value).toBe("");
  });
});
