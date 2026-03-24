// src/diff.ts — Human-readable .ybk notebook diffs

import { loadNotebook } from "@codepawl/yeastbook-core";
import type { YbkNotebook, YbkCell } from "@codepawl/yeastbook-core";
import { execSync } from "node:child_process";

export interface DiffCounts {
  added: number;
  modified: number;
  deleted: number;
}

export function computeDiff(
  old: Pick<YbkNotebook, "cells">,
  newer: Pick<YbkNotebook, "cells">
): DiffCounts {
  const maxCells = Math.max(old.cells.length, newer.cells.length);
  let added = 0;
  let modified = 0;
  let deleted = 0;

  for (let i = 0; i < maxCells; i++) {
    const oldCell = old.cells[i];
    const newCell = newer.cells[i];

    if (!oldCell && newCell) {
      added++;
    } else if (oldCell && !newCell) {
      deleted++;
    } else if (oldCell && newCell) {
      if (oldCell.source !== newCell.source || oldCell.type !== newCell.type) {
        modified++;
      }
    }
  }

  return { added, modified, deleted };
}

function printCellDiff(
  old: Pick<YbkNotebook, "cells" | "metadata">,
  newer: Pick<YbkNotebook, "cells" | "metadata">,
  oldLabel: string,
  newLabel: string
): void {
  const changes: string[] = [];

  console.log(`\n\x1b[1mNotebook diff\x1b[0m`);
  console.log(`  \x1b[31m--- ${oldLabel}\x1b[0m`);
  console.log(`  \x1b[32m+++ ${newLabel}\x1b[0m\n`);

  // Metadata changes
  if (old.metadata?.title !== newer.metadata?.title) {
    changes.push(`Title: "${old.metadata?.title ?? ""}" → "${newer.metadata?.title ?? ""}"`);
  }

  if (old.cells.length !== newer.cells.length) {
    changes.push(`Cells: ${old.cells.length} → ${newer.cells.length}`);
  }

  const maxCells = Math.max(old.cells.length, newer.cells.length);
  let changedCells = 0;

  for (let i = 0; i < maxCells; i++) {
    const oldCell = old.cells[i] as YbkCell | undefined;
    const newCell = newer.cells[i] as YbkCell | undefined;

    if (!oldCell && newCell) {
      changedCells++;
      console.log(`\x1b[32m+ Cell [${i + 1}] ADDED (${newCell.type})\x1b[0m`);
      const lines = newCell.source.split("\n").slice(0, 5);
      for (const line of lines) {
        console.log(`\x1b[32m+   ${line}\x1b[0m`);
      }
      const total = newCell.source.split("\n").length;
      if (total > 5) {
        console.log(`\x1b[32m+   ... (${total - 5} more lines)\x1b[0m`);
      }
      console.log();
      continue;
    }

    if (oldCell && !newCell) {
      changedCells++;
      console.log(`\x1b[31m- Cell [${i + 1}] DELETED (${oldCell.type})\x1b[0m`);
      const lines = oldCell.source.split("\n").slice(0, 5);
      for (const line of lines) {
        console.log(`\x1b[31m-   ${line}\x1b[0m`);
      }
      console.log();
      continue;
    }

    if (!oldCell || !newCell) continue;

    const sourceChanged = oldCell.source !== newCell.source;
    const typeChanged = oldCell.type !== newCell.type;

    if (!sourceChanged && !typeChanged) continue;

    changedCells++;
    console.log(`\x1b[33m~ Cell [${i + 1}] MODIFIED (${oldCell.type})\x1b[0m`);

    if (typeChanged) {
      console.log(`  Type: ${oldCell.type} → ${newCell.type}`);
    }

    if (sourceChanged) {
      const oldLines = oldCell.source.split("\n");
      const newLines = newCell.source.split("\n");
      const maxLines = Math.max(oldLines.length, newLines.length);

      for (let j = 0; j < maxLines; j++) {
        const oldLine = oldLines[j];
        const newLine = newLines[j];

        if (oldLine === newLine) continue;

        if (oldLine !== undefined && newLine === undefined) {
          console.log(`\x1b[31m-  ${oldLine}\x1b[0m`);
        } else if (oldLine === undefined && newLine !== undefined) {
          console.log(`\x1b[32m+  ${newLine}\x1b[0m`);
        } else {
          console.log(`\x1b[31m-  ${oldLine}\x1b[0m`);
          console.log(`\x1b[32m+  ${newLine}\x1b[0m`);
        }
      }
    }
    console.log();
  }

  // Summary
  console.log("\u2500".repeat(50));
  if (changedCells === 0 && changes.length === 0) {
    console.log("No changes");
  } else {
    for (const c of changes) console.log(`  ${c}`);
    console.log(`  ${changedCells} cell(s) changed`);
  }
  console.log();
}

export async function diffNotebook(
  filePath: string,
  options: {
    staged?: boolean;
    commit?: string;
    otherFile?: string;
  } = {}
): Promise<void> {
  let oldNotebook: Pick<YbkNotebook, "cells" | "metadata">;
  let newNotebook: Pick<YbkNotebook, "cells" | "metadata">;
  let oldLabel: string;
  let newLabel: string;

  if (options.otherFile) {
    const oldResult = await loadNotebook(filePath);
    const newResult = await loadNotebook(options.otherFile);
    oldNotebook = oldResult.notebook;
    newNotebook = newResult.notebook;
    oldLabel = filePath;
    newLabel = options.otherFile;
  } else {
    const ref = options.commit ?? (options.staged ? "--cached" : "HEAD");
    const gitArg = options.staged ? `git diff --cached -- ${filePath}` : `git show ${ref}:${filePath}`;
    try {
      let oldContent: string;
      if (options.staged) {
        // For staged, get the staged version from index
        oldContent = execSync(`git show :${filePath}`, { encoding: "utf8", cwd: process.cwd() });
      } else {
        oldContent = execSync(`git show ${ref}:${filePath}`, { encoding: "utf8", cwd: process.cwd() });
      }
      oldNotebook = JSON.parse(oldContent) as YbkNotebook;
    } catch {
      console.error(`Could not get ${ref} version of ${filePath}`);
      process.exit(1);
    }
    const newResult = await loadNotebook(filePath);
    newNotebook = newResult.notebook;
    oldLabel = `${ref}:${filePath}`;
    newLabel = filePath;
  }

  printCellDiff(oldNotebook, newNotebook, oldLabel, newLabel);
}

export async function diffText(filePath: string): Promise<void> {
  const { notebook } = await loadNotebook(filePath);
  for (let i = 0; i < notebook.cells.length; i++) {
    const cell = notebook.cells[i]!;
    console.log(`\n## Cell ${i + 1} [${cell.type}]`);
    console.log(cell.source);
    if (cell.outputs?.length) {
      console.log("### Output:");
      for (const out of cell.outputs) {
        if (out.text) console.log(out.text.join(""));
      }
    }
  }
}
