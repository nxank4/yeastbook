import { test, expect, describe } from "bun:test";
import { executeCode } from "../packages/app/src/kernel/execute.ts";

describe("cross-cell context persistence", () => {
  test("variable defined in cell 1 is available in cell 2", async () => {
    const context: Record<string, unknown> = {};

    // Cell 1: define x
    const r1 = await executeCode("const x = 42", context);
    expect(r1.error).toBeUndefined();

    // Cell 2: use x
    const r2 = await executeCode("x", context);
    expect(r2.error).toBeUndefined();
    expect(r2.value).toBe(42);
  });

  test("variable updated in cell 2 reflects new value in cell 3", async () => {
    const context: Record<string, unknown> = {};

    await executeCode("let count = 0", context);
    await executeCode("count = count + 10", context);
    const r3 = await executeCode("count", context);
    expect(r3.error).toBeUndefined();
    expect(r3.value).toBe(10);
  });

  test("multiple variables persist across cells", async () => {
    const context: Record<string, unknown> = {};

    await executeCode("const a = 1", context);
    await executeCode("const b = 2", context);
    const r = await executeCode("a + b", context);
    expect(r.error).toBeUndefined();
    expect(r.value).toBe(3);
  });

  test("function assigned to variable persists across cells", async () => {
    const context: Record<string, unknown> = {};

    await executeCode("const double = (n) => n * 2", context);
    const r = await executeCode("double(21)", context);
    expect(r.error).toBeUndefined();
    expect(r.value).toBe(42);
  });

  test("object mutations persist", async () => {
    const context: Record<string, unknown> = {};

    await executeCode("const obj = { x: 1 }", context);
    await executeCode("obj.y = 2", context);
    const r = await executeCode("obj.x + obj.y", context);
    expect(r.error).toBeUndefined();
    expect(r.value).toBe(3);
  });
});
