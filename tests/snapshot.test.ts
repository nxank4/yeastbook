import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { mkdir, rm, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  serializeContext,
  saveSnapshot,
  loadSnapshot,
  clearSnapshot,
} from "../packages/app/src/kernel/snapshot.ts";
import type { SessionSnapshot } from "../packages/app/src/kernel/snapshot.ts";

describe("serializeContext", () => {
  test("saves strings, numbers, booleans correctly", () => {
    const vars = serializeContext({ x: 42, name: "hello", flag: true });
    expect(vars.x).toEqual({ value: 42, type: "number", serializable: true });
    expect(vars.name).toEqual({ value: "hello", type: "string", serializable: true });
    expect(vars.flag).toEqual({ value: true, type: "boolean", serializable: true });
  });

  test("saves plain objects and arrays", () => {
    const vars = serializeContext({ obj: { a: 1 }, arr: [1, 2, 3] });
    expect(vars.obj).toEqual({ value: { a: 1 }, type: "object", serializable: true });
    expect(vars.arr).toEqual({ value: [1, 2, 3], type: "array", serializable: true });
  });

  test("skips functions", () => {
    const vars = serializeContext({ fn: () => {}, x: 1 });
    expect(vars.fn?.serializable).toBe(false);
    expect(vars.fn?.type).toBe("function");
    expect(vars.x?.serializable).toBe(true);
  });

  test("skips circular references", () => {
    const obj: any = { a: 1 };
    obj.self = obj;
    const vars = serializeContext({ circular: obj });
    expect(vars.circular?.serializable).toBe(false);
  });

  test("skips keys starting with __", () => {
    const vars = serializeContext({ __internal: 1, visible: 2 });
    expect(vars.__internal).toBeUndefined();
    expect(vars.visible).toBeDefined();
  });

  test("skips Bun and system keys", () => {
    const vars = serializeContext({ Bun: {}, $: {}, process: {}, normal: 1 });
    expect(vars.Bun).toBeUndefined();
    expect(vars.$).toBeUndefined();
    expect(vars.process).toBeUndefined();
    expect(vars.normal).toBeDefined();
  });

  test("handles null and undefined values", () => {
    const vars = serializeContext({ n: null, u: undefined });
    expect(vars.n).toEqual({ value: null, type: "object", serializable: true });
    // undefined is not JSON serializable
    expect(vars.u?.serializable).toBe(false);
  });

  test("Date serializes to ISO string", () => {
    const vars = serializeContext({ d: new Date("2024-01-01") });
    expect(vars.d).toBeDefined();
    expect(vars.d!.serializable).toBe(true);
    expect(typeof vars.d!.value).toBe("string");
    expect(vars.d!.value as string).toContain("2024-01-01");
  });

  test("Map with entries is not meaningfully serializable (round-trips as empty object)", () => {
    // JSON.stringify(new Map([["a", 1]])) returns "{}" — data is lost
    const map = new Map([["key", "value"]]);
    const vars = serializeContext({ m: map });
    expect(vars.m).toBeDefined();
    // Either serializable is false, or the serialized value lost the Map entries
    if (vars.m!.serializable) {
      // If serializable is true, the value must have lost the Map's data (round-tripped as {})
      expect(vars.m!.value).toEqual({});
    } else {
      expect(vars.m!.serializable).toBe(false);
    }
  });

  test("deeply nested plain object is serializable and preserves structure", () => {
    const vars = serializeContext({ deep: { a: { b: { c: 42 } } } });
    expect(vars.deep).toBeDefined();
    expect(vars.deep!.serializable).toBe(true);
    const val = vars.deep!.value as { a: { b: { c: number } } };
    expect(val.a.b.c).toBe(42);
  });
});

describe("saveSnapshot / loadSnapshot / clearSnapshot", () => {
  const testNotebookPath = "/tmp/yeastbook-test-snapshot-" + Date.now() + ".ybk";
  const hash = createHash("md5").update(testNotebookPath).digest("hex").slice(0, 8);
  const snapshotPath = resolve(homedir(), ".yeastbook", "sessions", `${hash}.json`);

  afterEach(async () => {
    try { await rm(snapshotPath); } catch {}
  });

  test("loadSnapshot returns null if no snapshot exists", async () => {
    const result = await loadSnapshot("/nonexistent/path.ybk");
    expect(result).toBeNull();
  });

  test("saveSnapshot writes and loadSnapshot reads correctly", async () => {
    const snapshot: SessionSnapshot = {
      notebookPath: testNotebookPath,
      savedAt: new Date().toISOString(),
      executionCount: 5,
      variables: {
        x: { value: 42, type: "number", serializable: true },
        fn: { value: null, type: "function", serializable: false },
      },
    };

    await saveSnapshot(testNotebookPath, snapshot);
    const loaded = await loadSnapshot(testNotebookPath);

    expect(loaded).not.toBeNull();
    expect(loaded!.executionCount).toBe(5);
    expect(loaded!.variables.x).toEqual({ value: 42, type: "number", serializable: true });
    expect(loaded!.variables.fn).toEqual({ value: null, type: "function", serializable: false });
  });

  test("loadSnapshot returns null for expired snapshots (>24h)", async () => {
    const snapshot: SessionSnapshot = {
      notebookPath: testNotebookPath,
      savedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25 hours ago
      executionCount: 3,
      variables: { x: { value: 1, type: "number", serializable: true } },
    };

    await saveSnapshot(testNotebookPath, snapshot);
    const loaded = await loadSnapshot(testNotebookPath);
    expect(loaded).toBeNull();
  });

  test("clearSnapshot removes snapshot file", async () => {
    const snapshot: SessionSnapshot = {
      notebookPath: testNotebookPath,
      savedAt: new Date().toISOString(),
      executionCount: 1,
      variables: {},
    };

    await saveSnapshot(testNotebookPath, snapshot);
    let loaded = await loadSnapshot(testNotebookPath);
    expect(loaded).not.toBeNull();

    await clearSnapshot(testNotebookPath);
    loaded = await loadSnapshot(testNotebookPath);
    expect(loaded).toBeNull();
  });
});
