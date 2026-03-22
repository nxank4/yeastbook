import { describe, test, expect } from "bun:test";
import { applyForward, applyReverse, type HistoryEntry } from "../packages/ui/src/hooks/useHistory";
import type { Cell } from "../packages/core/src/types";

function makeCell(id: string, type: "code" | "markdown" = "code", source = ""): Cell {
  return { id, cell_type: type, source: [source], outputs: [], execution_count: null, metadata: {} };
}

describe("History: applyForward", () => {
  test("source_change updates cell source", () => {
    const cells = [makeCell("a", "code", "old")];
    const entry: HistoryEntry = { type: "source_change", cellId: "a", before: "old", after: "new" };
    const result = applyForward(cells, entry);
    expect(result[0].source).toEqual(["new"]);
  });

  test("add_cell inserts cell at index", () => {
    const cells = [makeCell("a"), makeCell("c")];
    const newCell = makeCell("b");
    const entry: HistoryEntry = { type: "add_cell", cell: newCell, index: 1 };
    const result = applyForward(cells, entry);
    expect(result.length).toBe(3);
    expect(result[1].id).toBe("b");
  });

  test("delete_cell removes cell", () => {
    const cells = [makeCell("a"), makeCell("b"), makeCell("c")];
    const entry: HistoryEntry = { type: "delete_cell", cell: cells[1], index: 1 };
    const result = applyForward(cells, entry);
    expect(result.length).toBe(2);
    expect(result.map((c) => c.id)).toEqual(["a", "c"]);
  });

  test("move_cell swaps positions", () => {
    const cells = [makeCell("a"), makeCell("b"), makeCell("c")];
    const entry: HistoryEntry = { type: "move_cell", cellId: "a", fromIndex: 0, toIndex: 2 };
    const result = applyForward(cells, entry);
    expect(result.map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  test("change_type changes cell type", () => {
    const cells = [makeCell("a", "code")];
    const entry: HistoryEntry = { type: "change_type", cellId: "a", before: "code", after: "markdown" };
    const result = applyForward(cells, entry);
    expect(result[0].cell_type).toBe("markdown");
  });

  test("batch applies multiple entries", () => {
    const cells = [makeCell("a", "code", "x")];
    const entry: HistoryEntry = {
      type: "batch",
      entries: [
        { type: "source_change", cellId: "a", before: "x", after: "y" },
        { type: "change_type", cellId: "a", before: "code", after: "markdown" },
      ],
    };
    const result = applyForward(cells, entry);
    expect(result[0].source).toEqual(["y"]);
    expect(result[0].cell_type).toBe("markdown");
  });
});

describe("History: applyReverse", () => {
  test("source_change restores previous source", () => {
    const cells = [makeCell("a", "code", "new")];
    const entry: HistoryEntry = { type: "source_change", cellId: "a", before: "old", after: "new" };
    const result = applyReverse(cells, entry);
    expect(result[0].source).toEqual(["old"]);
  });

  test("add_cell undo removes the cell", () => {
    const newCell = makeCell("b");
    const cells = [makeCell("a"), newCell, makeCell("c")];
    const entry: HistoryEntry = { type: "add_cell", cell: newCell, index: 1 };
    const result = applyReverse(cells, entry);
    expect(result.length).toBe(2);
    expect(result.map((c) => c.id)).toEqual(["a", "c"]);
  });

  test("delete_cell undo restores cell at correct index", () => {
    const deleted = makeCell("b", "code", "hello");
    const cells = [makeCell("a"), makeCell("c")];
    const entry: HistoryEntry = { type: "delete_cell", cell: deleted, index: 1 };
    const result = applyReverse(cells, entry);
    expect(result.length).toBe(3);
    expect(result[1].id).toBe("b");
    expect(result[1].source).toEqual(["hello"]);
  });

  test("move_cell undo reverses the move", () => {
    const cells = [makeCell("b"), makeCell("c"), makeCell("a")];
    const entry: HistoryEntry = { type: "move_cell", cellId: "a", fromIndex: 0, toIndex: 2 };
    const result = applyReverse(cells, entry);
    expect(result.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  test("change_type undo reverts type", () => {
    const cells = [makeCell("a", "markdown")];
    // Force the type for test
    cells[0].cell_type = "markdown";
    const entry: HistoryEntry = { type: "change_type", cellId: "a", before: "code", after: "markdown" };
    const result = applyReverse(cells, entry);
    expect(result[0].cell_type).toBe("code");
  });

  test("batch undo reverses in correct order", () => {
    const cells = [makeCell("a", "markdown", "y")];
    cells[0].cell_type = "markdown";
    const entry: HistoryEntry = {
      type: "batch",
      entries: [
        { type: "source_change", cellId: "a", before: "x", after: "y" },
        { type: "change_type", cellId: "a", before: "code", after: "markdown" },
      ],
    };
    const result = applyReverse(cells, entry);
    expect(result[0].source).toEqual(["x"]);
    expect(result[0].cell_type).toBe("code");
  });
});

describe("History: undo/redo sequences", () => {
  test("redo after undo re-applies change", () => {
    const cells = [makeCell("a", "code", "old")];
    const entry: HistoryEntry = { type: "source_change", cellId: "a", before: "old", after: "new" };
    // Apply forward
    const afterForward = applyForward(cells, entry);
    expect(afterForward[0].source).toEqual(["new"]);
    // Undo
    const afterUndo = applyReverse(afterForward, entry);
    expect(afterUndo[0].source).toEqual(["old"]);
    // Redo
    const afterRedo = applyForward(afterUndo, entry);
    expect(afterRedo[0].source).toEqual(["new"]);
  });

  test("multiple undo/redo sequence works", () => {
    let cells = [makeCell("a"), makeCell("b"), makeCell("c")];
    const entries: HistoryEntry[] = [
      { type: "delete_cell", cell: cells[1], index: 1 },
      { type: "move_cell", cellId: "a", fromIndex: 0, toIndex: 1 },
    ];

    // Apply both forward
    cells = applyForward(cells, entries[0]); // delete b → [a, c]
    cells = applyForward(cells, entries[1]); // move a 0→1 → [c, a]
    expect(cells.map((c) => c.id)).toEqual(["c", "a"]);

    // Undo second
    cells = applyReverse(cells, entries[1]); // undo move → [a, c]
    expect(cells.map((c) => c.id)).toEqual(["a", "c"]);

    // Undo first
    cells = applyReverse(cells, entries[0]); // undo delete → [a, b, c]
    expect(cells.map((c) => c.id)).toEqual(["a", "b", "c"]);

    // Redo both
    cells = applyForward(cells, entries[0]);
    cells = applyForward(cells, entries[1]);
    expect(cells.map((c) => c.id)).toEqual(["c", "a"]);
  });
});
