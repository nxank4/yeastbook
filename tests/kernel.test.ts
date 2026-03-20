// tests/kernel.test.ts
import { test, expect, describe } from "bun:test";
import { executeCode } from "../src/kernel/index.ts";

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
});
