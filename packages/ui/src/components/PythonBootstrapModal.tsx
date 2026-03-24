import { useState, useRef, useEffect } from "react";

export type BootstrapPhase = "choose" | "creating" | "dependencies" | "installing" | "done";

interface Props {
  onClose: () => void;
  onComplete: (pythonPath: string) => void;
  logs: string[];
  phase: BootstrapPhase;
  requirements: string[] | null;
  error: string | null;
  pythonPath: string | null;
  onAction: (
    action: "create-venv" | "use-system" | "select-custom",
    opts?: { customPath?: string; installRequirements?: boolean; lewmPreset?: boolean }
  ) => void;
  onInstallDeps: (opts: { installRequirements: boolean; lewmPreset: boolean }) => void;
}

export function PythonBootstrapModal({
  onClose, onComplete, logs, phase, requirements, error, pythonPath, onAction, onInstallDeps,
}: Props) {
  const [customPath, setCustomPath] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [installReqs, setInstallReqs] = useState(true);
  const [lewmPreset, setLewmPreset] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  // Auto-close on done
  useEffect(() => {
    if (phase === "done" && pythonPath) {
      const timer = setTimeout(() => {
        onComplete(pythonPath);
        onClose();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [phase, pythonPath, onComplete, onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2>
            {phase === "choose" && "Python Environment Setup"}
            {phase === "creating" && "Creating Environment..."}
            {phase === "dependencies" && "Install Dependencies"}
            {phase === "installing" && "Installing Packages..."}
            {phase === "done" && "Setup Complete"}
          </h2>
          <button className="settings-close" onClick={onClose}>
            <i className="bi bi-x-lg" />
          </button>
        </div>

        {phase === "choose" && (
          <div className="bootstrap-options">
            <button className="bootstrap-btn" onClick={() => onAction("create-venv")}>
              <i className="bi bi-plus-circle" />
              <div className="bootstrap-btn-text">
                <span className="bootstrap-btn-title">Quick Create .venv</span>
                <span className="bootstrap-btn-desc">Create a local virtual environment in this directory</span>
              </div>
            </button>
            <button className="bootstrap-btn" onClick={() => onAction("use-system")}>
              <i className="bi bi-terminal" />
              <div className="bootstrap-btn-text">
                <span className="bootstrap-btn-title">Use System Python</span>
                <span className="bootstrap-btn-desc">Use the system-wide Python interpreter</span>
              </div>
            </button>
            {!showCustomInput ? (
              <button className="bootstrap-btn" onClick={() => setShowCustomInput(true)}>
                <i className="bi bi-folder2-open" />
                <div className="bootstrap-btn-text">
                  <span className="bootstrap-btn-title">Custom Python Path</span>
                  <span className="bootstrap-btn-desc">Specify a path to a Python interpreter</span>
                </div>
              </button>
            ) : (
              <div style={{ padding: "0 4px" }}>
                <input
                  type="text"
                  value={customPath}
                  onChange={(e) => setCustomPath(e.target.value)}
                  placeholder="/usr/bin/python3 or /path/to/venv/bin/python"
                  style={{
                    width: "100%", padding: "8px 12px", fontSize: 13,
                    background: "var(--bg-app)", border: "1px solid var(--border-subtle)",
                    borderRadius: 6, color: "var(--text-primary)", fontFamily: "monospace",
                    boxSizing: "border-box",
                  }}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && customPath.trim()) {
                      onAction("select-custom", { customPath: customPath.trim() });
                    } else if (e.key === "Escape") {
                      setShowCustomInput(false);
                    }
                  }}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                  <button className="ai-cancel-btn" onClick={() => setShowCustomInput(false)}>Cancel</button>
                  <button
                    className="ai-generate-btn"
                    disabled={!customPath.trim()}
                    onClick={() => onAction("select-custom", { customPath: customPath.trim() })}
                  >
                    Use This
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {(phase === "creating" || phase === "installing") && (
          <>
            <div className="bootstrap-phase-label">
              <div className="loading-bar" />
            </div>
            <pre className="bootstrap-log" ref={logRef}>
              {logs.length > 0 ? logs.join("") : "Starting...\n"}
            </pre>
          </>
        )}

        {phase === "dependencies" && (
          <>
            <div style={{ padding: "12px 20px", fontSize: 13, color: "var(--text-secondary)" }}>
              Environment ready. Would you like to install dependencies?
            </div>
            {requirements && requirements.length > 0 && (
              <div className="bootstrap-checkbox">
                <input
                  type="checkbox" id="install-reqs"
                  checked={installReqs} onChange={(e) => setInstallReqs(e.target.checked)}
                />
                <label htmlFor="install-reqs">
                  Install from requirements.txt ({requirements.length} package{requirements.length !== 1 ? "s" : ""})
                </label>
              </div>
            )}
            <div className="bootstrap-checkbox">
              <input
                type="checkbox" id="lewm-preset"
                checked={lewmPreset} onChange={(e) => setLewmPreset(e.target.checked)}
              />
              <label htmlFor="lewm-preset">
                Pre-configure for LeWorldModel (torch, torchvision, stable-worldmodel)
              </label>
            </div>
            <div className="bootstrap-actions">
              <button className="ai-cancel-btn" onClick={onClose}>Skip</button>
              <button
                className="ai-generate-btn"
                disabled={!installReqs && !lewmPreset}
                onClick={() => onInstallDeps({ installRequirements: installReqs, lewmPreset })}
              >
                Install
              </button>
            </div>
          </>
        )}

        {phase === "done" && (
          <div className="bootstrap-success">
            <i className="bi bi-check-circle-fill" />
            <p>Python environment configured</p>
            {pythonPath && (
              <p style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)" }}>
                {pythonPath}
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="bootstrap-error">
            <i className="bi bi-exclamation-triangle" /> {error}
          </div>
        )}
      </div>
    </div>
  );
}
