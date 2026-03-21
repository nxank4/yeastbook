import { test, expect, describe } from "bun:test";
import { executeCode } from "../src/kernel/execute.ts";

describe("Bun Shell in cells", () => {
  test("$ is available in cell context", async () => {
    const ctx: Record<string, unknown> = {};
    const result = await executeCode("typeof $", ctx);
    expect(result.error).toBeUndefined();
    expect(result.value).toBe("function");
  });

  test("Bun is available in cell context", async () => {
    const ctx: Record<string, unknown> = {};
    const result = await executeCode("typeof Bun", ctx);
    expect(result.error).toBeUndefined();
    expect(result.value).toBe("object");
  });

  test("Bun Shell executes commands", async () => {
    const ctx: Record<string, unknown> = {};
    const result = await executeCode("await $`echo hello`.text()", ctx);
    expect(result.error).toBeUndefined();
    expect(result.value).toContain("hello");
  });
});
