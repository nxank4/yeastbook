import { test, expect, describe, afterEach } from "bun:test";
import { unlink, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ybkToIpynb,
  ipynbToYbk,
  detectFormat,
  loadNotebook,
  saveNotebook,
  createEmptyYbk,
} from "../packages/core/src/format.ts";
import type { YbkNotebook, IpynbNotebook } from "../packages/core/src/format.ts";

function makeYbk(): YbkNotebook {
  return {
    version: "0.1.0",
    metadata: {
      title: "Test",
      created: "2026-03-21T00:00:00Z",
      runtime: "bun",
      bunVersion: "1.0.0",
    },
    settings: { fontSize: 13, tabSize: 2, wordWrap: false, theme: "light" },
    cells: [
      {
        id: "cell-1",
        type: "code",
        source: "const x = 1 + 1",
        outputs: [
          { output_type: "execute_result", data: { "text/plain": "2" }, metadata: {}, execution_count: 1 },
        ],
        executionCount: 1,
      },
      {
        id: "cell-2",
        type: "markdown",
        source: "# Hello",
      },
    ],
  };
}

function makeIpynb(): IpynbNotebook {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { name: "yeastbook", display_name: "Yeastbook (Bun)", language: "typescript" },
      language_info: { name: "typescript" },
    },
    cells: [
      {
        cell_type: "code",
        id: "cell-1",
        source: ["const x = 1 + 1"],
        metadata: {},
        outputs: [
          { output_type: "execute_result", data: { "text/plain": "2" }, metadata: {}, execution_count: 1 },
        ],
        execution_count: 1,
      },
      {
        cell_type: "markdown",
        id: "cell-2",
        source: ["# Hello"],
        metadata: {},
        outputs: [],
        execution_count: null,
      },
    ],
  };
}

describe("detectFormat", () => {
  test("detects .ybk", () => {
    expect(detectFormat("notebook.ybk")).toBe("ybk");
    expect(detectFormat("/path/to/my-notebook.ybk")).toBe("ybk");
  });

  test("detects .ipynb", () => {
    expect(detectFormat("notebook.ipynb")).toBe("ipynb");
    expect(detectFormat("/path/to/my-notebook.ipynb")).toBe("ipynb");
  });

  test("defaults to ipynb for unknown extensions", () => {
    expect(detectFormat("notebook.json")).toBe("ipynb");
  });
});

describe("ybkToIpynb", () => {
  test("preserves cells, source, and outputs", () => {
    const ybk = makeYbk();
    const ipynb = ybkToIpynb(ybk);

    expect(ipynb.nbformat).toBe(4);
    expect(ipynb.cells.length).toBe(2);

    // Code cell
    expect(ipynb.cells[0]!.cell_type).toBe("code");
    expect(ipynb.cells[0]!.id).toBe("cell-1");
    expect(ipynb.cells[0]!.source).toEqual(["const x = 1 + 1"]);
    expect(ipynb.cells[0]!.execution_count).toBe(1);
    expect(ipynb.cells[0]!.outputs.length).toBe(1);
    expect(ipynb.cells[0]!.outputs[0]!.output_type).toBe("execute_result");

    // Markdown cell
    expect(ipynb.cells[1]!.cell_type).toBe("markdown");
    expect(ipynb.cells[1]!.source).toEqual(["# Hello"]);
    expect(ipynb.cells[1]!.execution_count).toBeNull();
    expect(ipynb.cells[1]!.outputs).toEqual([]);
  });
});

describe("ipynbToYbk", () => {
  test("preserves cells", () => {
    const ipynb = makeIpynb();
    const ybk = ipynbToYbk(ipynb);

    expect(ybk.version).toBe("0.1.0");
    expect(ybk.cells.length).toBe(2);

    expect(ybk.cells[0]!.type).toBe("code");
    expect(ybk.cells[0]!.id).toBe("cell-1");
    expect(ybk.cells[0]!.source).toBe("const x = 1 + 1");
    expect(ybk.cells[0]!.executionCount).toBe(1);
    expect(ybk.cells[0]!.outputs!.length).toBe(1);

    expect(ybk.cells[1]!.type).toBe("markdown");
    expect(ybk.cells[1]!.source).toBe("# Hello");
    expect(ybk.cells[1]!.outputs).toBeUndefined();
  });
});

describe("round-trip", () => {
  test("ybk → ipynb → ybk produces equivalent result", () => {
    const original = makeYbk();
    const ipynb = ybkToIpynb(original);
    const roundTripped = ipynbToYbk(ipynb);

    expect(roundTripped.cells.length).toBe(original.cells.length);

    for (let i = 0; i < original.cells.length; i++) {
      expect(roundTripped.cells[i]!.id).toBe(original.cells[i]!.id);
      expect(roundTripped.cells[i]!.type).toBe(original.cells[i]!.type);
      expect(roundTripped.cells[i]!.source).toBe(original.cells[i]!.source);
      if (original.cells[i]!.type === "code") {
        expect(roundTripped.cells[i]!.executionCount).toBe(original.cells[i]!.executionCount);
        expect(roundTripped.cells[i]!.outputs!.length).toBe(original.cells[i]!.outputs!.length);
      }
    }
  });
});

describe("loadNotebook / saveNotebook", () => {
  const tmpYbk = `/tmp/yeastbook-format-test-${Date.now()}.ybk`;
  const tmpIpynb = `/tmp/yeastbook-format-test-${Date.now()}.ipynb`;

  afterEach(async () => {
    try { await unlink(tmpYbk); } catch {}
    try { await unlink(tmpIpynb); } catch {}
  });

  test("loadNotebook creates new .ybk file if missing", async () => {
    const { notebook, format } = await loadNotebook(tmpYbk);
    expect(format).toBe("ybk");
    expect(notebook.cells).toEqual([]);
    expect(notebook.version).toBe("0.1.0");
  });

  test("save and load .ybk round-trip", async () => {
    const ybk = makeYbk();
    await saveNotebook(tmpYbk, ybk);

    const { notebook, format } = await loadNotebook(tmpYbk);
    expect(format).toBe("ybk");
    expect(notebook.cells.length).toBe(2);
    expect(notebook.cells[0]!.source).toBe("const x = 1 + 1");
    expect(notebook.cells[1]!.source).toBe("# Hello");
  });

  test("save as .ipynb writes ipynb format", async () => {
    const ybk = makeYbk();
    await saveNotebook(tmpIpynb, ybk);

    const raw = await Bun.file(tmpIpynb).json();
    expect(raw.nbformat).toBe(4);
    expect(raw.cells[0].cell_type).toBe("code");
    expect(raw.cells[0].source).toEqual(["const x = 1 + 1"]);
  });

  test("loadNotebook works for .ipynb", async () => {
    // Write a real ipynb
    const ipynb = makeIpynb();
    await Bun.write(tmpIpynb, JSON.stringify(ipynb));

    const { notebook, format } = await loadNotebook(tmpIpynb);
    expect(format).toBe("ipynb");
    expect(notebook.cells.length).toBe(2);
    expect(notebook.cells[0]!.type).toBe("code");
    expect(notebook.cells[0]!.source).toBe("const x = 1 + 1");
  });
});

describe("format edge cases", () => {
  test("round-trip: ipynbToYbk(ybkToIpynb(ybk)) preserves cell sources", () => {
    const ybk = makeYbk();
    const roundTripped = ipynbToYbk(ybkToIpynb(ybk));
    expect(roundTripped.cells.length).toBe(ybk.cells.length);
    for (let i = 0; i < ybk.cells.length; i++) {
      expect(roundTripped.cells[i]!.source).toBe(ybk.cells[i]!.source);
    }
  });

  test("ipynbToYbk handles cell.source as single string", () => {
    const ipynb = makeIpynb();
    // Force source to a plain string (not an array)
    (ipynb.cells[0] as any).source = "hello";
    const ybk = ipynbToYbk(ipynb);
    expect(ybk.cells[0]!.source).toBe("hello");
  });

  test("detectFormat handles uppercase .YBK extension", () => {
    expect(detectFormat("test.YBK")).toBe("ybk");
  });

  test("detectFormat returns ipynb for .json", () => {
    expect(detectFormat("test.json")).toBe("ipynb");
  });

  test("loadNotebook with malformed JSON throws", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yeastbook-test-"));
    const badFile = join(dir, "bad.ybk");
    await writeFile(badFile, "{invalid json");
    let threw = false;
    try {
      await loadNotebook(badFile);
    } catch {
      threw = true;
    } finally {
      try { await unlink(badFile); } catch {}
    }
    expect(threw).toBe(true);
  });

  test("createEmptyYbk returns version 0.1.0 and empty cells", () => {
    const ybk = createEmptyYbk();
    expect(ybk.version).toBe("0.1.0");
    expect(ybk.cells).toEqual([]);
  });
});
