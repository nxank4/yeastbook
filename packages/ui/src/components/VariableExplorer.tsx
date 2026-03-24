import { useState, useMemo, useCallback } from "react";
import type { VariableDetails } from "@codepawl/yeastbook-core";

interface VariableEntry {
  value: unknown;
  type: string;
  serializable: boolean;
}

interface VariableExplorerProps {
  variables: Record<string, VariableEntry>;
  onInspect?: (name: string) => void;
  inspectionResults?: Map<string, VariableDetails>;
}

function preview(entry: VariableEntry): string {
  if (!entry.serializable) return `[${entry.type}]`;
  try {
    const str = JSON.stringify(entry.value);
    return str.length > 30 ? str.slice(0, 27) + "..." : str;
  } catch {
    return "[error]";
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DetailPanel({ details }: { details: VariableDetails }) {
  return (
    <div className="var-details">
      <div className="var-detail-row">
        <span className="var-detail-label">Type</span>
        <span className="var-detail-value">{details.type}</span>
      </div>
      {details.shape && (
        <div className="var-detail-row">
          <span className="var-detail-label">Shape</span>
          <span className="var-detail-value var-badge">[{details.shape.join(" x ")}]</span>
        </div>
      )}
      {details.size != null && (
        <div className="var-detail-row">
          <span className="var-detail-label">Size</span>
          <span className="var-detail-value">{details.size.toLocaleString()} items</span>
        </div>
      )}
      {details.dtype && (
        <div className="var-detail-row">
          <span className="var-detail-label">Dtype</span>
          <span className="var-detail-value">{details.dtype}</span>
        </div>
      )}
      {details.memoryBytes != null && (
        <div className="var-detail-row">
          <span className="var-detail-label">Memory</span>
          <span className="var-detail-value">{formatBytes(details.memoryBytes)}</span>
        </div>
      )}
      {details.columns && details.columns.length > 0 && (
        <div className="var-detail-row">
          <span className="var-detail-label">Keys</span>
          <span className="var-detail-value var-columns">{details.columns.join(", ")}</span>
        </div>
      )}
      {details.head && (
        <div className="var-detail-table-wrap">
          <table className="var-detail-table">
            <tbody>
              {details.head.slice(0, 5).map((row, i) => (
                <tr key={i}>
                  {(row as unknown[]).map((cell, j) => (
                    <td key={j}>{String(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {details.value != null && !details.head && details.serializable && (
        <div className="var-detail-preview">
          <pre>{typeof details.value === "string" ? details.value : JSON.stringify(details.value, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export function VariableExplorer({ variables, onInspect, inspectionResults }: VariableExplorerProps) {
  const [filter, setFilter] = useState("");
  const [expandedVar, setExpandedVar] = useState<string | null>(null);
  const entries = useMemo(() => Object.entries(variables), [variables]);

  const filtered = useMemo(() => {
    if (!filter) return entries;
    const lc = filter.toLowerCase();
    return entries.filter(([key]) => key.toLowerCase().includes(lc));
  }, [entries, filter]);

  const handleExpand = useCallback((name: string) => {
    if (expandedVar === name) {
      setExpandedVar(null);
    } else {
      setExpandedVar(name);
      onInspect?.(name);
    }
  }, [expandedVar, onInspect]);

  return (
    <div className="var-explorer">
      {entries.length > 3 && (
        <div className="var-search">
          <i className="bi bi-search" />
          <input
            type="text"
            placeholder="Filter variables..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="var-search-input"
          />
        </div>
      )}
      {filtered.length === 0 ? (
        <p className="env-empty">{entries.length === 0 ? "No variables in context" : "No matches"}</p>
      ) : (
        filtered.map(([key, entry]) => {
          const isExpanded = expandedVar === key;
          const details = inspectionResults?.get(key);
          return (
            <div key={key} className={`var-item ${isExpanded ? "expanded" : ""}`}>
              <button className="var-row" onClick={() => handleExpand(key)}>
                <i className={`bi bi-chevron-${isExpanded ? "down" : "right"} var-expand-icon`} />
                <span className="var-name">{key}</span>
                <span className="var-type">{entry.type}</span>
                <span className="var-preview">{preview(entry)}</span>
              </button>
              {isExpanded && (
                details ? <DetailPanel details={details} /> : (
                  <div className="var-details var-loading">
                    <span className="var-detail-value">Inspecting...</span>
                  </div>
                )
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
