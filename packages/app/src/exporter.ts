// src/exporter.ts — Export notebook to TypeScript script

import { loadNotebook } from "@codepawl/yeastbook-core";

export async function exportToScript(
  notebookPath: string,
  outputPath: string
): Promise<void> {
  const { notebook } = await loadNotebook(notebookPath);
  const lines: string[] = [];

  lines.push(`// Generated from ${notebookPath}`);
  lines.push(`// yeastbook export-script`);
  lines.push(`// ${new Date().toISOString()}`);
  lines.push("");

  for (let i = 0; i < notebook.cells.length; i++) {
    const cell = notebook.cells[i]!;

    if (cell.type === "markdown") {
      lines.push("/*");
      for (const line of cell.source.split("\n")) {
        lines.push(` * ${line}`);
      }
      lines.push(" */");
      lines.push("");
      continue;
    }

    if (cell.type === "code" && cell.source.trim()) {
      lines.push(`// Cell ${i + 1}`);
      lines.push(cell.source);
      lines.push("");
    }
  }

  await Bun.write(outputPath, lines.join("\n"));
  console.log(`✓ Exported to ${outputPath}`);
  console.log(`  Run with: bun ${outputPath}`);
}

export async function stripOutputs(
  inputPath: string,
  outputPath: string
): Promise<void> {
  const raw = await Bun.file(inputPath).json();

  const stripped = {
    ...raw,
    cells: (raw.cells ?? []).map((cell: any) => ({
      ...cell,
      outputs: [],
      executionCount: null,
    })),
  };

  await Bun.write(outputPath, JSON.stringify(stripped, null, 2) + "\n");
  const count = (raw.cells ?? []).filter((c: any) => c.outputs?.length > 0).length;
  console.log(`✓ Stripped outputs from ${count} cells → ${outputPath}`);
}
