export type RichOutput =
  | { type: "text"; text: string }
  | { type: "json"; data: unknown }
  | { type: "table"; rows: Record<string, unknown>[] }
  | { type: "chart"; data: unknown[]; config: { chartType: string; xKey?: string; yKey?: string; label?: string; title?: string } }
  | { type: "html"; html: string }
  | { type: "plugin"; pluginType: string; data: Record<string, unknown> }
  | { type: "mime"; mime: string; data?: string; url?: string }
  | { type: "widget"; widgetId: string; widgetType: string; value: unknown; config: Record<string, unknown> };

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
  richOutput?: RichOutput;
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

export interface Settings {
  editor: {
    fontSize: number;
    tabSize: number;
    wordWrap: boolean;
  };
  appearance: {
    theme: "light" | "dark";
    notifications: "show" | "minimize" | "hide";
  };
  execution: {
    autoSaveOnRun: boolean;
    clearOutputBeforeRun: boolean;
  };
  ai: {
    provider: "anthropic" | "openai" | "disabled";
    apiKey: string;
  };
  layout: {
    maxWidth: "small" | "medium" | "full" | "custom";
    customWidth?: number;
    sidebar: boolean;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  editor: { fontSize: 13, tabSize: 2, wordWrap: false },
  appearance: { theme: "light", notifications: "show" },
  execution: { autoSaveOnRun: true, clearOutputBeforeRun: false },
  ai: { provider: "disabled", apiKey: "" },
  layout: { maxWidth: "medium", sidebar: false },
};

export type CellLanguage = "typescript" | "python";

export interface PythonEnv {
  path: string;
  label: string;
  type: "venv" | "conda" | "system";
  version?: string;
}

export interface VariableDetails {
  type: string;
  value: unknown;
  serializable: boolean;
  shape?: number[];
  size?: number;
  dtype?: string;
  columns?: string[];
  head?: unknown[][];
  memoryBytes?: number;
}

export type WsOutgoing =
  | { type: "execute"; cellId: string; code: string; language?: CellLanguage }
  | { type: "interrupt" }
  | { type: "variable_inspect"; name: string }
  | { type: "bootstrap"; action: "create-venv" | "use-system" | "select-custom"; customPath?: string; installRequirements?: boolean; lewmPreset?: boolean };

// WebSocket message types
export type WsIncoming =
  | { type: "status"; cellId: string; status: "busy" | "idle"; executionCount?: number; timestamp?: number }
  | { type: "stream"; cellId: string; name: "stdout" | "stderr"; text: string }
  | { type: "result"; cellId: string; value: string; executionCount: number; richOutput?: RichOutput }
  | { type: "error"; cellId: string; ename: string; evalue: string; traceback: string[] }
  | { type: "install_start"; cellId: string; packages: string[] }
  | { type: "install_log"; cellId: string; text: string; stream: "stdout" | "stderr" }
  | { type: "install_done"; cellId: string; success: true; packageDts?: Record<string, string> }
  | { type: "install_error"; cellId: string; error: string }
  | { type: "notebook_updated" }
  | { type: "notebook_deleted" }
  | { type: "auto_saved" }
  | { type: "files_changed" }
  | { type: "dependencies_updated"; dependencies: Record<string, string> }
  | { type: "snapshot_restored"; restoredCount: number; variables: Record<string, { value: unknown; type: string; serializable: boolean }> }
  | { type: "variables_updated"; variables: Record<string, { value: unknown; type: string; serializable: boolean }> }
  | { type: "pong"; ts: number }
  | { type: "python_status"; status: "available" | "unavailable" | "starting"; pythonPath?: string }
  | { type: "python_env_missing" }
  | { type: "bootstrap_log"; text: string; stream: "stdout" | "stderr" }
  | { type: "bootstrap_done"; success: boolean; step: "venv" | "pip"; pythonPath?: string; error?: string }
  | { type: "bootstrap_requirements_found"; packages: string[] }
  | { type: "variable_details"; name: string; details: VariableDetails };
