import { useState, useEffect } from "react";

interface Props {
  dependencies: Record<string, string>;
}

export function DependenciesPanel({ dependencies }: Props) {
  const [isOpen, setIsOpen] = useState(true);
  const entries = Object.entries(dependencies);

  return (
    <div className="env-explorer">
      <button className="env-explorer-toggle" onClick={() => setIsOpen(!isOpen)}>
        <i className="bi bi-box-seam" />
        <span>DEPS</span>
        <span className="env-count">{entries.length}</span>
        <i className={`bi bi-chevron-${isOpen ? "up" : "down"}`} />
      </button>

      {isOpen && (
        <div className="env-explorer-content">
          {entries.length === 0 ? (
            <p className="env-empty">No dependencies yet</p>
          ) : (
            entries.map(([pkg, version]) => (
              <div key={pkg} className="env-var-row">
                <span className="env-key">{pkg}</span>
                <span className="env-value">{version}</span>
              </div>
            ))
          )}
          <p className="env-hint">
            Use <code>%install package</code> in a cell to add dependencies.
          </p>
        </div>
      )}
    </div>
  );
}
