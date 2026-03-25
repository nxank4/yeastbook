import { test, expect, describe } from "bun:test";
import { parseFlags } from "../packages/app/src/parse-flags.ts";

describe("parseFlags", () => {
  test("parseFlags([]) → default values", () => {
    const result = parseFlags([]);
    expect(result.positional).toEqual([]);
    expect(result.noOpen).toBe(false);
    expect(result.ipynb).toBe(false);
    expect(result.dev).toBe(false);
    expect(result.template).toBe(null);
    expect(result.dir).toBe(null);
    expect(result.port).toBe(parseInt(process.env.PORT ?? "3000", 10));
  });

  test('parseFlags(["--port", "8080"]) → port: 8080', () => {
    const result = parseFlags(["--port", "8080"]);
    expect(result.port).toBe(8080);
  });

  test('parseFlags(["--port=8080"]) → port: 8080', () => {
    const result = parseFlags(["--port=8080"]);
    expect(result.port).toBe(8080);
  });

  test('parseFlags(["--no-open"]) → noOpen: true', () => {
    const result = parseFlags(["--no-open"]);
    expect(result.noOpen).toBe(true);
  });

  test('parseFlags(["--ipynb"]) → ipynb: true', () => {
    const result = parseFlags(["--ipynb"]);
    expect(result.ipynb).toBe(true);
  });

  test('parseFlags(["--dev"]) → dev: true', () => {
    const result = parseFlags(["--dev"]);
    expect(result.dev).toBe(true);
  });

  test('parseFlags(["--template", "data-science"]) → template: "data-science"', () => {
    const result = parseFlags(["--template", "data-science"]);
    expect(result.template).toBe("data-science");
  });

  test('parseFlags(["new", "--port", "4000", "--no-open"]) → positional: ["new"], port: 4000, noOpen: true', () => {
    const result = parseFlags(["new", "--port", "4000", "--no-open"]);
    expect(result.positional).toEqual(["new"]);
    expect(result.port).toBe(4000);
    expect(result.noOpen).toBe(true);
  });
});
