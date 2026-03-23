import { test, expect, describe } from "bun:test";
import { computeDiff } from "../packages/app/src/diff.ts";

describe("notebook diff", () => {
  test("detects added cell", () => {
    const old = { cells: [{ id: "1", type: "code" as const, source: "x = 1", outputs: [] }] };
    const newer = {
      cells: [
        { id: "1", type: "code" as const, source: "x = 1", outputs: [] },
        { id: "2", type: "code" as const, source: "y = 2", outputs: [] },
      ],
    };
    const changes = computeDiff(old, newer);
    expect(changes.added).toBe(1);
    expect(changes.modified).toBe(0);
    expect(changes.deleted).toBe(0);
  });

  test("detects modified cell", () => {
    const old = { cells: [{ id: "1", type: "code" as const, source: "x = 1", outputs: [] }] };
    const newer = { cells: [{ id: "1", type: "code" as const, source: "x = 99", outputs: [] }] };
    const changes = computeDiff(old, newer);
    expect(changes.modified).toBe(1);
    expect(changes.added).toBe(0);
    expect(changes.deleted).toBe(0);
  });

  test("detects deleted cell", () => {
    const old = {
      cells: [
        { id: "1", type: "code" as const, source: "x = 1", outputs: [] },
        { id: "2", type: "code" as const, source: "y = 2", outputs: [] },
      ],
    };
    const newer = { cells: [{ id: "1", type: "code" as const, source: "x = 1", outputs: [] }] };
    const changes = computeDiff(old, newer);
    expect(changes.deleted).toBe(1);
    expect(changes.added).toBe(0);
    expect(changes.modified).toBe(0);
  });

  test("no changes returns empty diff", () => {
    const nb = { cells: [{ id: "1", type: "code" as const, source: "x = 1", outputs: [] }] };
    const changes = computeDiff(nb, nb);
    expect(changes.added + changes.modified + changes.deleted).toBe(0);
  });

  test("detects type change as modification", () => {
    const old = { cells: [{ id: "1", type: "code" as const, source: "hello", outputs: [] }] };
    const newer = { cells: [{ id: "1", type: "markdown" as const, source: "hello", outputs: [] }] };
    const changes = computeDiff(old, newer);
    expect(changes.modified).toBe(1);
  });

  test("handles multiple changes at once", () => {
    const old = {
      cells: [
        { id: "1", type: "code" as const, source: "a = 1", outputs: [] },
        { id: "2", type: "code" as const, source: "b = 2", outputs: [] },
        { id: "3", type: "code" as const, source: "c = 3", outputs: [] },
      ],
    };
    const newer = {
      cells: [
        { id: "1", type: "code" as const, source: "a = 100", outputs: [] },
        { id: "4", type: "code" as const, source: "d = 4", outputs: [] },
      ],
    };
    const changes = computeDiff(old, newer);
    // Cell 1: modified (source changed), Cell 2: modified (different source), Cell 3: deleted
    expect(changes.modified).toBe(2);
    expect(changes.deleted).toBe(1);
    expect(changes.added).toBe(0);
  });

  test("handles empty notebooks", () => {
    const empty = { cells: [] as any[] };
    const changes = computeDiff(empty, empty);
    expect(changes.added + changes.modified + changes.deleted).toBe(0);
  });

  test("handles old empty, new with cells", () => {
    const empty = { cells: [] as any[] };
    const nb = {
      cells: [
        { id: "1", type: "code" as const, source: "x = 1", outputs: [] },
        { id: "2", type: "markdown" as const, source: "# hi", outputs: [] },
      ],
    };
    const changes = computeDiff(empty, nb);
    expect(changes.added).toBe(2);
    expect(changes.modified).toBe(0);
    expect(changes.deleted).toBe(0);
  });
});
