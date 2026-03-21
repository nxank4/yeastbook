import { test, expect, describe } from "bun:test";
import { detectOutputType } from "../src/kernel/output.ts";

describe("detectOutputType", () => {
  test("null returns null (skip)", () => {
    expect(detectOutputType(null)).toBeNull();
  });

  test("undefined returns null (skip)", () => {
    expect(detectOutputType(undefined)).toBeNull();
  });

  test("chart marker object returns chart type", () => {
    const val = {
      __type: "chart",
      data: [10, 20, 30],
      config: { chartType: "bar", label: "Sales" },
    };
    const result = detectOutputType(val);
    expect(result).toEqual({
      type: "chart",
      data: [10, 20, 30],
      config: { chartType: "bar", label: "Sales" },
    });
  });

  test("html marker object returns html type", () => {
    const val = { __type: "html", html: "<h1>Hello</h1>" };
    const result = detectOutputType(val);
    expect(result).toEqual({ type: "html", html: "<h1>Hello</h1>" });
  });

  test("array of plain objects returns table type", () => {
    const val = [
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ];
    const result = detectOutputType(val);
    expect(result).toEqual({ type: "table", rows: val });
  });

  test("empty array returns json type (not table)", () => {
    const result = detectOutputType([]);
    expect(result).toEqual({ type: "json", data: [] });
  });

  test("array of non-objects returns json type", () => {
    const result = detectOutputType([1, 2, 3]);
    expect(result).toEqual({ type: "json", data: [1, 2, 3] });
  });

  test("plain object returns json type", () => {
    const val = { name: "Alice", age: 30 };
    const result = detectOutputType(val);
    expect(result).toEqual({ type: "json", data: val });
  });

  test("string returns text type", () => {
    const result = detectOutputType("hello world");
    expect(result).toEqual({ type: "text", text: "hello world" });
  });

  test("number returns text type", () => {
    const result = detectOutputType(42);
    expect(result).toEqual({ type: "text", text: "42" });
  });

  test("boolean returns text type", () => {
    const result = detectOutputType(true);
    expect(result).toEqual({ type: "text", text: "true" });
  });

  test("array of mixed types returns json type", () => {
    const val = [{ name: "Alice" }, "not an object"];
    const result = detectOutputType(val);
    expect(result).toEqual({ type: "json", data: val });
  });

  test("array with null items returns json type", () => {
    const result = detectOutputType([null, { a: 1 }]);
    expect(result).toEqual({ type: "json", data: [null, { a: 1 }] });
  });
});
