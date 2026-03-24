import { useRef, useCallback } from "react";
import type { Cell } from "@codepawl/yeastbook-core";

export type HistoryEntry =
  | { type: "source_change"; cellId: string; before: string; after: string }
  | { type: "add_cell"; cell: Cell; index: number }
  | { type: "delete_cell"; cell: Cell; index: number }
  | { type: "move_cell"; cellId: string; fromIndex: number; toIndex: number }
  | { type: "change_type"; cellId: string; before: "code" | "markdown"; after: "code" | "markdown" }
  | { type: "batch"; entries: HistoryEntry[] };

const MAX_HISTORY = 100;

function applyForward(cells: Cell[], entry: HistoryEntry): Cell[] {
  switch (entry.type) {
    case "source_change":
      return cells.map((c) =>
        c.id === entry.cellId ? { ...c, source: [entry.after] } : c
      );
    case "add_cell":
      return [
        ...cells.slice(0, entry.index),
        entry.cell,
        ...cells.slice(entry.index),
      ];
    case "delete_cell":
      return cells.filter((c) => c.id !== entry.cell.id);
    case "move_cell": {
      const arr = [...cells];
      const [moved] = arr.splice(entry.fromIndex, 1);
      arr.splice(entry.toIndex, 0, moved!);
      return arr;
    }
    case "change_type":
      return cells.map((c) => {
        if (c.id !== entry.cellId) return c;
        if (entry.after === "markdown") return { ...c, cell_type: entry.after, outputs: [], execution_count: null };
        return { ...c, cell_type: entry.after };
      });
    case "batch":
      return entry.entries.reduce(applyForward, cells);
  }
}

function applyReverse(cells: Cell[], entry: HistoryEntry): Cell[] {
  switch (entry.type) {
    case "source_change":
      return cells.map((c) =>
        c.id === entry.cellId ? { ...c, source: [entry.before] } : c
      );
    case "add_cell":
      return cells.filter((c) => c.id !== entry.cell.id);
    case "delete_cell":
      return [
        ...cells.slice(0, entry.index),
        entry.cell,
        ...cells.slice(entry.index),
      ];
    case "move_cell": {
      const arr = [...cells];
      const [moved] = arr.splice(entry.toIndex, 1);
      arr.splice(entry.fromIndex, 0, moved!);
      return arr;
    }
    case "change_type":
      return cells.map((c) => {
        if (c.id !== entry.cellId) return c;
        if (entry.before === "markdown") return { ...c, cell_type: entry.before, outputs: [], execution_count: null };
        return { ...c, cell_type: entry.before };
      });
    case "batch":
      return [...entry.entries].reverse().reduce(applyReverse, cells);
  }
}

function labelFor(entry: HistoryEntry): string {
  switch (entry.type) {
    case "source_change": return "source change";
    case "add_cell": return "add cell";
    case "delete_cell": return "delete cell";
    case "move_cell": return "move cell";
    case "change_type": return "change type";
    case "batch": return "batch change";
  }
}

interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export function useHistory(
  getCells: () => Cell[],
  onApply: (cells: Cell[]) => void,
  onToast?: (msg: string) => void,
) {
  const historyRef = useRef<HistoryState>({ past: [], future: [] });

  const push = useCallback((entry: HistoryEntry) => {
    const h = historyRef.current;
    h.past.push(entry);
    h.future = [];
    if (h.past.length > MAX_HISTORY) h.past.shift();
  }, []);

  const undo = useCallback(() => {
    const h = historyRef.current;
    const entry = h.past.pop();
    if (!entry) return;
    h.future.push(entry);
    const newCells = applyReverse(getCells(), entry);
    onApply(newCells);
    onToast?.(`Undone: ${labelFor(entry)}`);
  }, [getCells, onApply, onToast]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    const entry = h.future.pop();
    if (!entry) return;
    h.past.push(entry);
    const newCells = applyForward(getCells(), entry);
    onApply(newCells);
    onToast?.(`Redone: ${labelFor(entry)}`);
  }, [getCells, onApply, onToast]);

  const canUndo = useCallback(() => historyRef.current.past.length > 0, []);
  const canRedo = useCallback(() => historyRef.current.future.length > 0, []);

  return { push, undo, redo, canUndo, canRedo };
}

export { applyForward, applyReverse };
