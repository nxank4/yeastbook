import { test, expect, describe, afterAll } from "bun:test";
import { stripOutputs } from "../packages/app/src/exporter.ts";
import { resolve, join } from "node:path";
import { unlink } from "node:fs/promises";

const fixtureDir = resolve(import.meta.dirname!, "fixtures");
const testInput = join(fixtureDir, "strip-test.ybk");
const testOutput = join(fixtureDir, "strip-test-clean.ybk");

describe("strip-outputs", () => {
  const notebook = {
    version: "0.1.0",
    metadata: { title: "Test", created: "2024-01-01", runtime: "bun", bunVersion: "1.0" },
    settings: { fontSize: 13, tabSize: 2, wordWrap: false, theme: "light" },
    cells: [
      {
        id: "1",
        type: "code",
        source: "const x = 1",
        outputs: [{ output_type: "execute_result", text: ["1"] }],
        executionCount: 1,
      },
      {
        id: "2",
        type: "code",
        source: "console.log('hi')",
        outputs: [{ output_type: "stream", name: "stdout", text: ["hi\n"] }],
        executionCount: 2,
      },
      {
        id: "3",
        type: "markdown",
        source: "# Notes",
        outputs: [],
      },
    ],
  };

  test("strips all outputs from cells", async () => {
    await Bun.write(testInput, JSON.stringify(notebook));
    await stripOutputs(testInput, testOutput);

    const result = await Bun.file(testOutput).json();
    for (const cell of result.cells) {
      expect(cell.outputs).toEqual([]);
    }
  });

  test("sets executionCount to null", async () => {
    const result = await Bun.file(testOutput).json();
    for (const cell of result.cells) {
      expect(cell.executionCount).toBeNull();
    }
  });

  test("preserves cell sources", async () => {
    const result = await Bun.file(testOutput).json();
    expect(result.cells[0].source).toBe("const x = 1");
    expect(result.cells[1].source).toBe("console.log('hi')");
    expect(result.cells[2].source).toBe("# Notes");
  });

  test("preserves metadata", async () => {
    const result = await Bun.file(testOutput).json();
    expect(result.metadata.title).toBe("Test");
    expect(result.version).toBe("0.1.0");
  });

  afterAll(async () => {
    try { await unlink(testInput); } catch {}
    try { await unlink(testOutput); } catch {}
  });
});
