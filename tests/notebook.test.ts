import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { Notebook } from "../packages/core/src/notebook.ts";
import { unlink } from "node:fs/promises";

describe("Notebook", () => {
  const tmpPath = `/tmp/yeastbook-test-${Date.now()}.ipynb`;

  afterEach(async () => {
    try { await unlink(tmpPath); } catch {}
  });

  test("create empty notebook", () => {
    const nb = Notebook.createEmpty();
    expect(nb.cells).toEqual([]);
    expect(nb.metadata.kernelspec.name).toBe("yeastbook");
  });

  test("add code cell", () => {
    const nb = Notebook.createEmpty();
    const id = nb.addCell("code", "1 + 1");
    expect(nb.cells.length).toBe(1);
    expect(nb.cells[0]!.cell_type).toBe("code");
    expect(nb.cells[0]!.source).toEqual(["1 + 1"]);
    expect(nb.cells[0]!.id).toBe(id);
  });

  test("add markdown cell", () => {
    const nb = Notebook.createEmpty();
    nb.addCell("markdown", "# Hello");
    expect(nb.cells[0]!.cell_type).toBe("markdown");
  });

  test("delete cell", () => {
    const nb = Notebook.createEmpty();
    const id = nb.addCell("code", "x");
    nb.deleteCell(id);
    expect(nb.cells.length).toBe(0);
  });

  test("update cell source", () => {
    const nb = Notebook.createEmpty();
    const id = nb.addCell("code", "old");
    nb.updateCellSource(id, "new");
    expect(nb.cells[0]!.source).toEqual(["new"]);
  });

  test("set cell output", () => {
    const nb = Notebook.createEmpty();
    const id = nb.addCell("code", "1+1");
    nb.setCellOutput(id, 1, { value: "2", stdout: "", stderr: "" });
    expect(nb.cells[0]!.execution_count).toBe(1);
    expect(nb.cells[0]!.outputs.length).toBe(1);
  });

  test("save and load round-trip", async () => {
    const nb = Notebook.createEmpty();
    nb.addCell("code", "1 + 1");
    nb.addCell("markdown", "# hi");
    await nb.save(tmpPath);

    const loaded = await Notebook.load(tmpPath);
    expect(loaded.cells.length).toBe(2);
    expect(loaded.cells[0]!.cell_type).toBe("code");
    expect(loaded.cells[1]!.cell_type).toBe("markdown");
  });

  test("load creates file if missing", async () => {
    const missingPath = `/tmp/yeastbook-missing-${Date.now()}.ipynb`;
    const nb = await Notebook.load(missingPath);
    expect(nb.cells).toEqual([]);
    try { await unlink(missingPath); } catch {}
  });
});

describe("Notebook edge cases", () => {
  test("insertCellAfter with nonexistent afterId appends to end", () => {
    const nb = Notebook.createEmpty();
    nb.addCell("code", "first");
    nb.insertCellAfter("code", "x", "nonexistent-id");
    expect(nb.cells.length).toBe(2);
    expect(nb.cells[nb.cells.length - 1]!.source).toEqual(["x"]);
  });

  test("insertCellAfter without afterId appends to end", () => {
    const nb = Notebook.createEmpty();
    nb.addCell("code", "first");
    nb.insertCellAfter("code", "test");
    expect(nb.cells.length).toBe(2);
    expect(nb.cells[nb.cells.length - 1]!.source).toEqual(["test"]);
  });

  test("insertCellAfter with valid afterId inserts after that cell", () => {
    const nb = Notebook.createEmpty();
    const firstId = nb.addCell("code", "first");
    nb.addCell("code", "last");
    nb.insertCellAfter("code", "middle", firstId);
    expect(nb.cells.length).toBe(3);
    expect(nb.cells[1]!.source).toEqual(["middle"]);
  });

  test("deleteCell with nonexistent id leaves cells unchanged", () => {
    const nb = Notebook.createEmpty();
    nb.addCell("code", "only");
    nb.deleteCell("nonexistent");
    expect(nb.cells.length).toBe(1);
  });

  test("updateCellSource with nonexistent id does not throw and leaves other cells unchanged", () => {
    const nb = Notebook.createEmpty();
    nb.addCell("code", "original");
    expect(() => nb.updateCellSource("nonexistent", "new")).not.toThrow();
    expect(nb.cells[0]!.source).toEqual(["original"]);
  });

  test("updateCellType to markdown clears outputs and execution_count", () => {
    const nb = Notebook.createEmpty();
    const id = nb.addCell("code", "1+1");
    nb.setCellOutput(id, 1, { value: "2", stdout: "", stderr: "" });
    expect(nb.cells[0]!.outputs.length).toBeGreaterThan(0);
    nb.updateCellType(id, "markdown");
    expect(nb.cells[0]!.outputs).toEqual([]);
    expect(nb.cells[0]!.execution_count).toBeNull();
  });

  test("moveCell up when already at top leaves order unchanged", () => {
    const nb = Notebook.createEmpty();
    const firstId = nb.addCell("code", "first");
    nb.addCell("code", "second");
    nb.moveCell(firstId, "up");
    expect(nb.cells[0]!.source).toEqual(["first"]);
    expect(nb.cells[1]!.source).toEqual(["second"]);
  });

  test("moveCell down when already at bottom leaves order unchanged", () => {
    const nb = Notebook.createEmpty();
    nb.addCell("code", "first");
    const lastId = nb.addCell("code", "last");
    nb.moveCell(lastId, "down");
    expect(nb.cells[0]!.source).toEqual(["first"]);
    expect(nb.cells[1]!.source).toEqual(["last"]);
  });

  test("reorderCell with out-of-range index leaves order unchanged", () => {
    const nb = Notebook.createEmpty();
    const firstId = nb.addCell("code", "first");
    nb.addCell("code", "second");
    nb.reorderCell(firstId, 999);
    expect(nb.cells[0]!.source).toEqual(["first"]);
    expect(nb.cells[1]!.source).toEqual(["second"]);
  });

  test("toJSON returns correct nbformat, nbformat_minor, and metadata", () => {
    const nb = Notebook.createEmpty();
    const json = nb.toJSON();
    expect(json.nbformat).toBe(4);
    expect(json.nbformat_minor).toBe(5);
    expect(json.metadata.kernelspec).toBeDefined();
    expect(json.metadata.language_info).toBeDefined();
  });
});
