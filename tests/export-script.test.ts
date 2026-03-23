import { test, expect, describe, afterAll } from "bun:test";
import { exportToScript } from "../packages/app/src/exporter.ts";
import { resolve, join } from "node:path";
import { unlink } from "node:fs/promises";

const fixtureDir = resolve(import.meta.dirname!, "fixtures");
const testNotebook = join(fixtureDir, "export-test.ybk");
const testOutput = join(fixtureDir, "export-test.ts");

describe("export-script", () => {
  // Create a test notebook fixture
  const notebook = {
    version: "0.1.0",
    metadata: { title: "Test", created: "2024-01-01", runtime: "bun", bunVersion: "1.0" },
    settings: { fontSize: 13, tabSize: 2, wordWrap: false, theme: "light" },
    cells: [
      { id: "1", type: "markdown", source: "# Hello\nThis is a test.", outputs: [] },
      { id: "2", type: "code", source: "const x = 1\nconsole.log(x)", outputs: [] },
      { id: "3", type: "code", source: "const y = x + 1\ny", outputs: [] },
      { id: "4", type: "code", source: "", outputs: [] },
    ],
  };

  test("exports code cells as TypeScript", async () => {
    await Bun.write(testNotebook, JSON.stringify(notebook));
    await exportToScript(testNotebook, testOutput);

    const content = await Bun.file(testOutput).text();
    expect(content).toContain("const x = 1");
    expect(content).toContain("console.log(x)");
    expect(content).toContain("const y = x + 1");
  });

  test("exports markdown cells as block comments", async () => {
    const content = await Bun.file(testOutput).text();
    expect(content).toContain("/*");
    expect(content).toContain(" * # Hello");
    expect(content).toContain(" * This is a test.");
    expect(content).toContain(" */");
  });

  test("skips empty code cells", async () => {
    const content = await Bun.file(testOutput).text();
    // Cell 4 is empty, should not appear
    expect(content).not.toContain("Cell 4");
  });

  test("includes header comment", async () => {
    const content = await Bun.file(testOutput).text();
    expect(content).toContain("yeastbook export-script");
    expect(content).toContain("Generated from");
  });

  afterAll(async () => {
    try { await unlink(testNotebook); } catch {}
    try { await unlink(testOutput); } catch {}
    try { await unlink(fixtureDir); } catch {}
  });
});
