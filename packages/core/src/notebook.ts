// src/notebook.ts — Notebook model (delegates to format.ts for persistence)

import { loadNotebook, saveNotebook, createEmptyYbk, detectFormat, ybkToIpynb } from "./format.ts";
import type { YbkNotebook, YbkCell, YbkCellOutput, NotebookFormat } from "./format.ts";

export type { YbkCellOutput as CellOutput };

export interface Cell {
  cell_type: "code" | "markdown";
  id: string;
  source: string[];
  metadata: Record<string, unknown>;
  outputs: YbkCellOutput[];
  execution_count: number | null;
}

interface NotebookJson {
  nbformat: number;
  nbformat_minor: number;
  metadata: {
    kernelspec: { name: string; display_name: string; language: string };
    language_info: { name: string };
  };
  cells: Cell[];
}

export class Notebook {
  cells: Cell[];
  metadata: NotebookJson["metadata"];
  ybk: YbkNotebook;
  format: NotebookFormat;

  private constructor(ybk: YbkNotebook, format: NotebookFormat) {
    this.ybk = ybk;
    this.format = format;
    this.cells = ybk.cells.map(ybkCellToCell);
    this.metadata = {
      kernelspec: { name: "yeastbook", display_name: "Yeastbook (Bun)", language: "typescript" },
      language_info: { name: "typescript" },
    };

    // Migrate legacy %%python cells to metadata-based language
    for (const cell of this.cells) {
      if (cell.cell_type === "code" && !cell.metadata?.language) {
        const src = cell.source.join("\n").trimStart();
        if (src.startsWith("%%python")) {
          cell.metadata = { ...cell.metadata, language: "python" };
          const lines = cell.source.join("\n").split("\n");
          const idx = lines.findIndex((l) => l.trim() === "%%python");
          if (idx !== -1) {
            cell.source = [lines.slice(idx + 1).join("\n")];
          }
        }
      }
    }
  }

  static createEmpty(): Notebook {
    return new Notebook(createEmptyYbk(), "ybk");
  }

  static async load(filePath: string): Promise<Notebook> {
    const { notebook, format } = await loadNotebook(filePath);
    return new Notebook(notebook, format);
  }

  async save(filePath: string): Promise<void> {
    this.syncToYbk();
    const format = detectFormat(filePath);
    await saveNotebook(filePath, this.ybk);
    this.format = format;
  }

  syncForExport(): void {
    this.syncToYbk();
  }

  private syncToYbk(): void {
    this.ybk.cells = this.cells.map(cellToYbkCell);
  }

  addCell(type: "code" | "markdown", source: string = ""): string {
    const id = crypto.randomUUID();
    const cell: Cell = {
      cell_type: type,
      id,
      source: source ? [source] : [],
      metadata: {},
      outputs: [],
      execution_count: null,
    };
    this.cells.push(cell);
    return id;
  }

  insertCellAfter(type: "code" | "markdown", source: string = "", afterId?: string): string {
    const id = crypto.randomUUID();
    const cell: Cell = {
      cell_type: type,
      id,
      source: source ? [source] : [],
      metadata: {},
      outputs: [],
      execution_count: null,
    };
    if (afterId) {
      const idx = this.cells.findIndex((c) => c.id === afterId);
      if (idx !== -1) {
        this.cells.splice(idx + 1, 0, cell);
        return id;
      }
    }
    this.cells.push(cell);
    return id;
  }

  deleteCell(id: string): void {
    this.cells = this.cells.filter((c) => c.id !== id);
  }

  updateCellSource(id: string, source: string): void {
    const cell = this.cells.find((c) => c.id === id);
    if (cell) cell.source = [source];
  }

  updateCellMetadata(id: string, updates: Record<string, unknown>): void {
    const cell = this.cells.find((c) => c.id === id);
    if (cell) cell.metadata = { ...cell.metadata, ...updates };
  }

  updateCellType(id: string, type: "code" | "markdown"): void {
    const cell = this.cells.find((c) => c.id === id);
    if (cell) {
      cell.cell_type = type;
      if (type === "markdown") {
        cell.outputs = [];
        cell.execution_count = null;
      }
    }
  }

  setCellOutput(
    id: string,
    executionCount: number,
    result: { value?: string; stdout?: string; stderr?: string; error?: { ename: string; evalue: string; traceback: string[] }; richOutput?: Record<string, unknown>; tables?: Record<string, unknown>[] },
  ): void {
    const cell = this.cells.find((c) => c.id === id);
    if (!cell) return;
    cell.execution_count = executionCount;
    cell.outputs = [];

    if (result.stdout) {
      cell.outputs.push({ output_type: "stream", name: "stdout", text: [result.stdout] });
    }
    if (result.stderr) {
      cell.outputs.push({ output_type: "stream", name: "stderr", text: [result.stderr] });
    }
    if (result.tables && result.tables.length > 0) {
      cell.outputs.push({
        output_type: "execute_result",
        data: { "text/plain": "" },
        metadata: {},
        execution_count: executionCount,
        richOutput: { type: "table", rows: result.tables },
      } as any);
    }
    if (result.error) {
      cell.outputs.push({
        output_type: "error",
        ename: result.error.ename,
        evalue: result.error.evalue,
        traceback: result.error.traceback,
      });
    } else if (result.value !== undefined) {
      const output: any = {
        output_type: "execute_result",
        data: { "text/plain": result.value },
        metadata: {},
        execution_count: executionCount,
      };
      if (result.richOutput) output.richOutput = result.richOutput;
      cell.outputs.push(output);
    }
  }

  moveCell(id: string, direction: "up" | "down"): void {
    const idx = this.cells.findIndex((c) => c.id === id);
    if (idx === -1) return;
    const target = direction === "up" ? idx - 1 : idx + 1;
    if (target < 0 || target >= this.cells.length) return;
    [this.cells[idx], this.cells[target]] = [this.cells[target]!, this.cells[idx]!];
  }

  reorderCell(id: string, toIndex: number): void {
    const fromIndex = this.cells.findIndex((c) => c.id === id);
    if (fromIndex === -1 || toIndex < 0 || toIndex >= this.cells.length) return;
    const [cell] = this.cells.splice(fromIndex, 1);
    this.cells.splice(toIndex, 0, cell!);
  }

  getCell(id: string): Cell | undefined {
    return this.cells.find((c) => c.id === id);
  }

  toJSON(): NotebookJson {
    return {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: this.metadata,
      cells: this.cells,
    };
  }
}

// --- Helpers ---

function ybkCellToCell(ybk: YbkCell): Cell {
  return {
    cell_type: ybk.type,
    id: ybk.id,
    source: ybk.source ? [ybk.source] : [],
    metadata: ybk.metadata ?? {},
    outputs: ybk.outputs ?? [],
    execution_count: ybk.executionCount ?? null,
  };
}

function cellToYbkCell(cell: Cell): YbkCell {
  const base: YbkCell = {
    id: cell.id,
    type: cell.cell_type,
    source: cell.source.join(""),
    metadata: Object.keys(cell.metadata || {}).length > 0 ? cell.metadata : undefined,
  };
  if (cell.cell_type === "code") {
    base.outputs = cell.outputs?.length ? cell.outputs : [];
    base.executionCount = cell.execution_count;
  }
  return base;
}
