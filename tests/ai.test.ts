import { test, expect, describe } from "bun:test";
import { buildPrompt, buildFixPrompt } from "../packages/app/src/ai.ts";

describe("AI module", () => {
  test("buildPrompt includes system prompt", () => {
    const result = buildPrompt("create fibonacci", []);
    expect(result.system).toContain("TypeScript");
    expect(result.system).toContain("Bun");
  });

  test("buildPrompt includes user prompt and context", () => {
    const result = buildPrompt("fetch data", ["const url = 'https://api.example.com'"]);
    expect(result.user).toContain("fetch data");
    expect(result.user).toContain("const url");
  });

  test("buildFixPrompt includes code and error", () => {
    const result = buildFixPrompt("const x: number = 'hello'", "TypeError: bad type");
    expect(result.user).toContain("const x");
    expect(result.user).toContain("TypeError");
  });

  test("buildPrompt without context omits context section", () => {
    const result = buildPrompt("hello", []);
    expect(result.user).toBe("hello");
    expect(result.user).not.toContain("Context");
  });
});
