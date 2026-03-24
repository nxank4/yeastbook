import { useMemo } from "react";
import type { Cell } from "@codepawl/yeastbook-core";

export interface TocEntry {
  cellId: string;
  level: number;
  text: string;
  children: TocEntry[];
}

const HEADER_RE = /^(#{1,4})\s+(.+)$/;

export function useTableOfContents(cells: Cell[]): TocEntry[] {
  return useMemo(() => {
    const flat: { cellId: string; level: number; text: string }[] = [];

    for (const cell of cells) {
      if (cell.cell_type !== "markdown") continue;
      const lines = cell.source.join("").split("\n");
      for (const line of lines) {
        const m = line.match(HEADER_RE);
        if (m) {
          flat.push({ cellId: cell.id, level: m[1].length, text: m[2].trim() });
        }
      }
    }

    // Build nested tree using a stack
    const root: TocEntry[] = [];
    const stack: TocEntry[] = [];

    for (const { cellId, level, text } of flat) {
      const entry: TocEntry = { cellId, level, text, children: [] };

      // Pop stack until we find a parent with a lower level
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      if (stack.length === 0) {
        root.push(entry);
      } else {
        stack[stack.length - 1].children.push(entry);
      }
      stack.push(entry);
    }

    return root;
  }, [cells]);
}
