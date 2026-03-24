import { useState, useEffect, useRef, useCallback } from "react";
import type { Mode } from "../hooks/useKeyboardShortcuts.ts";

interface PythonEnv {
  path: string;
  label: string;
  type: "venv" | "conda" | "system";
  version?: string;
}

interface Props {
  mode: Mode;
  connected: boolean;
  saved: boolean;
  saveStatus?: "idle" | "saving" | "saved" | "error";
  notification?: string | null;
  bunVersion?: string;
  pythonPath?: string | null;
  hasVenv?: boolean;
  onCreateVenv?: () => void;
  onRetrySave?: () => void;
}

export function StatusBar({ mode, connected, saved, saveStatus, notification, bunVersion, pythonPath, hasVenv, onCreateVenv, onRetrySave }: Props) {
  const [envPickerOpen, setEnvPickerOpen] = useState(false);
  const [envs, setEnvs] = useState<PythonEnv[]>([]);
  const [loading, setLoading] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const fetchEnvs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/python/environments");
      const data = await res.json();
      setEnvs(data.environments ?? []);
    } catch {}
    setLoading(false);
  }, []);

  const selectEnv = useCallback(async (path: string) => {
    setEnvPickerOpen(false);
    await fetch("/api/python/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pythonPath: path }),
    });
  }, []);

  // Close picker on outside click
  useEffect(() => {
    if (!envPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setEnvPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [envPickerOpen]);

  const handlePythonClick = () => {
    setEnvPickerOpen(!envPickerOpen);
    if (!envPickerOpen) fetchEnvs();
  };

  // Shorten path for display
  const shortPath = pythonPath
    ? pythonPath.includes(".venv") ? ".venv"
    : pythonPath.includes("venv") ? "venv"
    : pythonPath.includes("conda") ? "conda"
    : "system"
    : null;

  return (
    <div className="status-bar">
      <span className={`mode-indicator mode-${mode}`}>{mode.toUpperCase()}</span>
      {notification && <span className="status-bar-sep">|</span>}
      {notification && <span className="status-bar-notification">{notification}</span>}
      <span className="status-bar-spacer" />
      {bunVersion && (
        <>
          <span className="status-env">Bun v{bunVersion}</span>
          <span className="status-bar-sep">|</span>
        </>
      )}
      <div className="status-env-picker-wrapper" ref={pickerRef}>
        {pythonPath ? (
          <button className="status-env-btn" onClick={handlePythonClick} title={pythonPath}>
            <i className="bi bi-filetype-py" /> {shortPath}
          </button>
        ) : hasVenv === false && onCreateVenv ? (
          <button className="status-create-venv" onClick={onCreateVenv}>Create venv</button>
        ) : (
          <button className="status-env-btn status-env-inactive" onClick={handlePythonClick}>
            <i className="bi bi-filetype-py" /> No Python
          </button>
        )}
        {envPickerOpen && (
          <div className="env-picker-dropdown">
            <div className="env-picker-header">Select Python Environment</div>
            {loading ? (
              <div className="env-picker-item env-picker-loading">Scanning...</div>
            ) : envs.length === 0 ? (
              <div className="env-picker-item env-picker-loading">No environments found</div>
            ) : (
              envs.map((env) => (
                <button
                  key={env.path}
                  className={`env-picker-item ${env.path === pythonPath ? "env-picker-active" : ""}`}
                  onClick={() => selectEnv(env.path)}
                >
                  <span className="env-picker-label">{env.label}</span>
                  <span className="env-picker-path">{env.path}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
      <span className="status-bar-sep">|</span>
      <span className={`status-dot ${connected ? "connected" : ""}`} />
      <span className="status-bar-text">{connected ? "Connected" : "Disconnected"}</span>
      <span className="status-bar-sep">|</span>
      {saveStatus === "saving" ? (
        <span className="status-bar-text status-saving"><i className="bi bi-arrow-repeat" /> Saving...</span>
      ) : saveStatus === "error" ? (
        <span className="status-bar-text status-save-error" onClick={onRetrySave} title="Click to retry">
          <i className="bi bi-exclamation-triangle" /> Save failed
        </span>
      ) : saveStatus === "saved" ? (
        <span className="status-bar-text status-saved"><i className="bi bi-check-lg" /> Saved</span>
      ) : (
        <span className="status-bar-text">{saved ? "Saved" : "Unsaved"}</span>
      )}
    </div>
  );
}
