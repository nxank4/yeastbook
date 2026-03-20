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

export interface NotebookData {
  nbformat: number;
  nbformat_minor: number;
  metadata: {
    kernelspec: { name: string; display_name: string; language: string };
    language_info: { name: string };
  };
  cells: Cell[];
}

// WebSocket message types
export type WsIncoming =
  | { type: "status"; cellId: string; status: "busy" | "idle" }
  | { type: "stream"; cellId: string; name: "stdout" | "stderr"; text: string }
  | { type: "result"; cellId: string; value: string; executionCount: number }
  | { type: "error"; cellId: string; ename: string; evalue: string; traceback: string[] };
