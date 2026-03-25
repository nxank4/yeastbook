import { test, expect, describe } from "bun:test";
import { validatePackageName, installPackages } from "../packages/app/src/kernel/installer.ts";

describe("validatePackageName", () => {
  test('"lodash" → true', () => {
    expect(validatePackageName("lodash")).toBe(true);
  });

  test('"@types/node" → true', () => {
    expect(validatePackageName("@types/node")).toBe(true);
  });

  test('"lodash@4.17.21" → true', () => {
    expect(validatePackageName("lodash@4.17.21")).toBe(true);
  });

  test('"@xenova/transformers@^2.0.0" → true', () => {
    expect(validatePackageName("@xenova/transformers@^2.0.0")).toBe(true);
  });

  test('"pkg@>=1.0.0" → true', () => {
    expect(validatePackageName("pkg@>=1.0.0")).toBe(true);
  });

  test('"; rm -rf /" → false', () => {
    expect(validatePackageName("; rm -rf /")).toBe(false);
  });

  test('"$(whoami)" → false', () => {
    expect(validatePackageName("$(whoami)")).toBe(false);
  });

  test('empty string "" → false', () => {
    expect(validatePackageName("")).toBe(false);
  });
});

describe("installPackages", () => {
  test("installPackages([], ...) → { success: false, error: 'No packages specified' }", async () => {
    const result = await installPackages([], () => {});
    expect(result).toEqual({ success: false, error: "No packages specified" });
  });
});
