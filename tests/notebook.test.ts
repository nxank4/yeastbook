import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { Notebook } from "../src/notebook.ts";
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
