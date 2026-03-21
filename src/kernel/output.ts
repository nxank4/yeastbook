// src/kernel/output.ts — Detect output type from execution result value

export type OutputData =
  | { type: "text"; text: string }
  | { type: "json"; data: unknown }
  | { type: "table"; rows: Record<string, unknown>[] }
  | { type: "chart"; data: unknown[]; config: ChartConfig }
  | { type: "html"; html: string };

export interface ChartConfig {
  chartType: "bar" | "line" | "pie" | "scatter" | "doughnut";
  xKey?: string;
  yKey?: string;
  label?: string;
  title?: string;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val) && val.constructor === Object;
}

export function detectOutputType(value: unknown): OutputData | null {
  if (value === null || value === undefined) return null;

  // Check for marker objects
  if (isPlainObject(value)) {
    const v = value as Record<string, unknown>;
    if (v.__type === "chart" && Array.isArray(v.data) && v.config) {
      return { type: "chart", data: v.data, config: v.config as ChartConfig };
    }
    if (v.__type === "html" && typeof v.html === "string") {
      return { type: "html", html: v.html };
    }
  }

  // Array of plain objects -> table
  if (Array.isArray(value) && value.length > 0 && value.every(item => isPlainObject(item))) {
    return { type: "table", rows: value as Record<string, unknown>[] };
  }

  // Any other object or array -> json tree
  if (typeof value === "object") {
    return { type: "json", data: value };
  }

  // Primitives -> text
  return { type: "text", text: String(value) };
}
