import { useState, useMemo } from "react";

interface VariableEntry {
  value: unknown;
  type: string;
  serializable: boolean;
}

interface VariableExplorerProps {
  variables: Record<string, VariableEntry>;
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

export function VariableExplorer({ variables }: VariableExplorerProps) {
  const [isOpen, setIsOpen] = useState(true);
  const entries = useMemo(() => Object.entries(variables), [variables]);

  return (
    <div className="env-explorer">
      <button className="env-explorer-toggle" onClick={() => setIsOpen(!isOpen)}>
        <i className="bi bi-braces" />
        <span>VARIABLES</span>
        <span className="env-count">{entries.length}</span>
        <i className={`bi bi-chevron-${isOpen ? "up" : "down"}`} />
      </button>

      {isOpen && (
        <div className="env-explorer-content">
          {entries.length === 0 ? (
            <p className="env-empty">No variables in context</p>
          ) : (
            entries.map(([key, entry]) => (
              <div key={key} className="var-row">
                <span className="var-name">{key}</span>
                <span className="var-type">{entry.type}</span>
                <span className="var-preview">{preview(entry)}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
