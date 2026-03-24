// ybk-md.ts — Readable markdown format for .ybk notebooks
// Format: .ybk.md (human-readable) + .ybk.outputs.json (sidecar for outputs)

import type { YbkNotebook, YbkCell, YbkCellOutput } from "./format.ts";

/**
 * Convert a YbkNotebook to markdown string.
 * Code cells become fenced code blocks with ```typescript or ```python.
 * Markdown cells are rendered as-is with a separator comment.
 */
export function notebookToMarkdown(notebook: YbkNotebook): string {
  const lines: string[] = [];

  // YAML frontmatter with metadata
  lines.push("---");
  lines.push(`title: "${notebook.metadata.title}"`);
  lines.push(`created: "${notebook.metadata.created}"`);
  lines.push(`version: "${notebook.version}"`);
  lines.push("---");
  lines.push("");

  for (const cell of notebook.cells) {
    if (cell.type === "code") {
      const lang = (cell.metadata?.language as string) || "typescript";
      lines.push(`<!-- cell:${cell.id} type:code lang:${lang} -->`);
      lines.push(`\`\`\`${lang}`);
      lines.push(cell.source);
      lines.push("```");
    } else {
      lines.push(`<!-- cell:${cell.id} type:markdown -->`);
      lines.push(cell.source);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Extract outputs from notebook into a sidecar JSON structure.
 * Keyed by cell ID.
 */
export function extractOutputs(notebook: YbkNotebook): Record<string, { outputs: YbkCellOutput[]; executionCount?: number | null }> {
  const result: Record<string, { outputs: YbkCellOutput[]; executionCount?: number | null }> = {};
  for (const cell of notebook.cells) {
    if (cell.outputs && cell.outputs.length > 0) {
      result[cell.id] = {
        outputs: cell.outputs,
        executionCount: cell.executionCount,
      };
    }
  }
  return result;
}

/**
 * Parse a .ybk.md file back into a YbkNotebook.
 */
export function markdownToNotebook(md: string, outputsJson?: string): YbkNotebook {
  const cells: YbkCell[] = [];
  let title = "Untitled";
  let created = new Date().toISOString();
  let version = "0.1.0";

  // Parse frontmatter
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---\n/);
  if (fmMatch) {
    const fm = fmMatch[1]!;
    const titleMatch = fm.match(/title:\s*"([^"]*)"/);
    const createdMatch = fm.match(/created:\s*"([^"]*)"/);
    const versionMatch = fm.match(/version:\s*"([^"]*)"/);
    if (titleMatch) title = titleMatch[1]!;
    if (createdMatch) created = createdMatch[1]!;
    if (versionMatch) version = versionMatch[1]!;
  }

  // Parse cells
  const body = fmMatch ? md.slice(fmMatch[0].length) : md;
  const cellPattern = /<!-- cell:(\S+) type:(code|markdown)(?:\s+lang:(\S+))? -->\n/g;
  let match: RegExpExecArray | null;
  const cellStarts: { id: string; type: "code" | "markdown"; lang?: string; index: number }[] = [];

  while ((match = cellPattern.exec(body)) !== null) {
    cellStarts.push({
      id: match[1]!,
      type: match[2] as "code" | "markdown",
      lang: match[3],
      index: match.index + match[0].length,
    });
  }

  // Parse outputs sidecar
  let outputs: Record<string, { outputs: YbkCellOutput[]; executionCount?: number | null }> = {};
  if (outputsJson) {
    try { outputs = JSON.parse(outputsJson); } catch {}
  }

  for (let i = 0; i < cellStarts.length; i++) {
    const start = cellStarts[i]!;
    const end = i + 1 < cellStarts.length ? cellStarts[i + 1]!.index - (body.slice(0, cellStarts[i + 1]!.index).lastIndexOf("<!--") - (cellStarts[i]!.index)) : undefined;

    // Get content between this cell marker and the next
    const nextMarkerIdx = i + 1 < cellStarts.length
      ? body.lastIndexOf("<!-- cell:", cellStarts[i + 1]!.index)
      : body.length;
    let content = body.slice(start.index, nextMarkerIdx).trim();

    if (start.type === "code") {
      // Strip fenced code block markers
      const fenceMatch = content.match(/^```\S*\n([\s\S]*?)```$/);
      if (fenceMatch) content = fenceMatch[1]!.trimEnd();
    }

    const cellOutputs = outputs[start.id];
    cells.push({
      id: start.id,
      type: start.type,
      source: content,
      outputs: cellOutputs?.outputs ?? [],
      executionCount: cellOutputs?.executionCount,
      metadata: start.lang ? { language: start.lang } : undefined,
    });
  }

  return {
    version,
    metadata: {
      title,
      created,
      runtime: "bun",
      bunVersion: typeof Bun !== "undefined" ? Bun.version : "unknown",
    },
    settings: { fontSize: 14, tabSize: 2, wordWrap: false, theme: "dark" },
    cells,
  };
}
