// src/notebook.ts — Notebook model for .ipynb files

export interface CellOutput {
  output_type: string;
  text?: string[];
  data?: Record<string, string>;
  metadata?: Record<string, unknown>;
  execution_count?: number;
  ename?: string;
  evalue?: string;
  traceback?: string[];
  name?: string;
}

export interface Cell {
  cell_type: "code" | "markdown";
  id: string;
  source: string[];
  metadata: Record<string, unknown>;
  outputs: CellOutput[];
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

  private constructor(data: NotebookJson) {
    this.cells = data.cells;
    this.metadata = data.metadata;
  }

  static createEmpty(): Notebook {
    return new Notebook({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {
        kernelspec: { name: "yeastbook", display_name: "Yeastbook (Bun)", language: "typescript" },
        language_info: { name: "typescript" },
      },
      cells: [],
    });
  }

  static async load(filePath: string): Promise<Notebook> {
    const file = Bun.file(filePath);
    if (await file.exists()) {
      const data: NotebookJson = await file.json();
      return new Notebook(data);
    }
    const nb = Notebook.createEmpty();
    await nb.save(filePath);
    return nb;
  }

  async save(filePath: string): Promise<void> {
    const data: NotebookJson = {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: this.metadata,
      cells: this.cells,
    };
    await Bun.write(filePath, JSON.stringify(data, null, 2) + "\n");
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

  deleteCell(id: string): void {
    this.cells = this.cells.filter((c) => c.id !== id);
  }

  updateCellSource(id: string, source: string): void {
    const cell = this.cells.find((c) => c.id === id);
    if (cell) cell.source = [source];
  }

  setCellOutput(
    id: string,
    executionCount: number,
    result: { value?: string; stdout?: string; stderr?: string; error?: { ename: string; evalue: string; traceback: string[] } },
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
    if (result.error) {
      cell.outputs.push({
        output_type: "error",
        ename: result.error.ename,
        evalue: result.error.evalue,
        traceback: result.error.traceback,
      });
    } else if (result.value !== undefined) {
      cell.outputs.push({
        output_type: "execute_result",
        data: { "text/plain": result.value },
        metadata: {},
        execution_count: executionCount,
      });
    }
  }

  moveCell(id: string, direction: "up" | "down"): void {
    const idx = this.cells.findIndex((c) => c.id === id);
    if (idx === -1) return;
    const target = direction === "up" ? idx - 1 : idx + 1;
    if (target < 0 || target >= this.cells.length) return;
    [this.cells[idx], this.cells[target]] = [this.cells[target], this.cells[idx]];
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
