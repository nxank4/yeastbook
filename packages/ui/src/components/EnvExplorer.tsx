import { useState, useEffect, useCallback } from "react";

export function EnvExplorer() {
  const [keys, setKeys] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    fetch("/api/env").then((r) => r.json()).then((d) => setKeys(d.keys || []));
  }, []);

  const reload = useCallback(() => {
    fetch("/api/env/reload", { method: "POST" })
      .then((r) => r.json())
      .then((d) => setKeys(d.keys || []));
  }, []);

  return (
    <div className="env-explorer">
      <button className="env-explorer-toggle" onClick={() => setIsOpen(!isOpen)}>
        <i className="bi bi-key" />
        <span>ENV</span>
        <span className="env-count">{keys.length}</span>
        <i className={`bi bi-chevron-${isOpen ? "up" : "down"}`} />
      </button>

      {isOpen && (
        <div className="env-explorer-content">
          {keys.length === 0 ? (
            <p className="env-empty">No .env file found</p>
          ) : (
            keys.map((key) => (
              <div key={key} className="env-var-row">
                <span className="env-key">{key}</span>
                <span className="env-value">••••••</span>
              </div>
            ))
          )}
          <button className="env-reload-btn" onClick={reload}>
            <i className="bi bi-arrow-clockwise" /> Reload
          </button>
          <p className="env-hint">
            Add a <code>.env</code> file next to your notebook.
            Use <code>process.env.KEY</code> in cells.
          </p>
        </div>
      )}
    </div>
  );
}
