// src/format.ts — .ybk / .ipynb format conversion

import { extname } from "node:path";

// --- .ybk types ---

export interface YbkCell {
  id: string;
  type: "code" | "markdown";
  source: string;
  outputs?: YbkCellOutput[];
  executionCount?: number | null;
  metadata?: Record<string, unknown>;
}

export interface YbkCellOutput {
  output_type: string;
  text?: string[];
  data?: Record<string, string>;
  metadata?: Record<string, unknown>;
  execution_count?: number;
  ename?: string;
  evalue?: string;
  traceback?: string[];
  name?: string;
  richOutput?: Record<string, unknown>;
}

export interface YbkNotebook {
  version: string;
  metadata: {
    title: string;
    created: string;
    runtime: string;
    bunVersion: string;
    dependencies?: Record<string, string>;
  };
  settings: {
    fontSize: number;
    tabSize: number;
    wordWrap: boolean;
    theme: string;
  };
  cells: YbkCell[];
}

// --- .ipynb types ---

export interface IpynbCell {
  cell_type: "code" | "markdown";
  id: string;
  source: string[];
  metadata: Record<string, unknown>;
  outputs: YbkCellOutput[];
  execution_count: number | null;
}

export interface IpynbNotebook {
  nbformat: number;
  nbformat_minor: number;
  metadata: {
    kernelspec: { name: string; display_name: string; language: string };
    language_info: { name: string };
  };
  cells: IpynbCell[];
}

// --- Conversion ---

export function ybkToIpynb(ybk: YbkNotebook): IpynbNotebook {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { name: "yeastbook", display_name: "Yeastbook (Bun)", language: "typescript" },
      language_info: { name: "typescript" },
    },
    cells: ybk.cells.map((cell) => ({
      cell_type: cell.type,
      id: cell.id,
      source: cell.source ? [cell.source] : [],
      metadata: cell.metadata ?? {},
      outputs: cell.type === "code" ? (cell.outputs ?? []) : [],
      execution_count: cell.type === "code" ? (cell.executionCount ?? null) : null,
    })),
  };
}

export function ipynbToYbk(ipynb: IpynbNotebook): YbkNotebook {
  return {
    version: "0.1.0",
    metadata: {
      title: "Untitled",
      created: new Date().toISOString(),
      runtime: "bun",
      bunVersion: typeof Bun !== "undefined" ? Bun.version : "unknown",
    },
    settings: {
      fontSize: 13,
      tabSize: 2,
      wordWrap: false,
      theme: "light",
    },
    cells: ipynb.cells.map((cell) => {
      const base: YbkCell = {
        id: cell.id,
        type: cell.cell_type,
        source: Array.isArray(cell.source) ? cell.source.join("") : cell.source,
        metadata: Object.keys(cell.metadata || {}).length > 0 ? cell.metadata : undefined,
      };
      if (cell.cell_type === "code") {
        base.outputs = cell.outputs?.length ? cell.outputs : [];
        base.executionCount = cell.execution_count;
      }
      return base;
    }),
  };
}

// --- Format detection ---

export type NotebookFormat = "ybk" | "ipynb";

export function detectFormat(path: string): NotebookFormat {
  const ext = extname(path).toLowerCase();
  if (ext === ".ybk") return "ybk";
  return "ipynb";
}

// --- Load / Save ---

export async function loadNotebook(path: string): Promise<{ notebook: YbkNotebook; format: NotebookFormat }> {
  const format = detectFormat(path);
  const file = Bun.file(path);

  if (!(await file.exists())) {
    const notebook = createEmptyYbk();
    await saveNotebook(path, notebook);
    return { notebook, format };
  }

  const data = await file.json();

  if (format === "ybk") {
    return { notebook: data as YbkNotebook, format };
  }

  // ipynb → convert to ybk internally
  return { notebook: ipynbToYbk(data as IpynbNotebook), format };
}

export async function saveNotebook(path: string, notebook: YbkNotebook): Promise<void> {
  const format = detectFormat(path);

  if (format === "ybk") {
    await Bun.write(path, JSON.stringify(notebook, null, 2) + "\n");
  } else {
    const ipynb = ybkToIpynb(notebook);
    await Bun.write(path, JSON.stringify(ipynb, null, 2) + "\n");
  }
}

export function createEmptyYbk(): YbkNotebook {
  return {
    version: "0.1.0",
    metadata: {
      title: "Untitled",
      created: new Date().toISOString(),
      runtime: "bun",
      bunVersion: typeof Bun !== "undefined" ? Bun.version : "unknown",
    },
    settings: {
      fontSize: 13,
      tabSize: 2,
      wordWrap: false,
      theme: "light",
    },
    cells: [],
  };
}
