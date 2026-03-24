import type { Mode } from "../hooks/useKeyboardShortcuts.ts";

interface Props {
  mode: Mode;
  connected: boolean;
  saved: boolean;
  notification?: string | null;
  bunVersion?: string;
  pythonPath?: string | null;
  hasVenv?: boolean;
  onCreateVenv?: () => void;
}

export function StatusBar({ mode, connected, saved, notification, bunVersion, pythonPath, hasVenv, onCreateVenv }: Props) {
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
      {pythonPath ? (
        <>
          <span className="status-env" title={pythonPath}>Python: {pythonPath}</span>
          <span className="status-bar-sep">|</span>
        </>
      ) : hasVenv === false && onCreateVenv ? (
        <>
          <button className="status-create-venv" onClick={onCreateVenv}>Create venv</button>
          <span className="status-bar-sep">|</span>
        </>
      ) : null}
      <span className={`status-dot ${connected ? "connected" : ""}`} />
      <span className="status-bar-text">{connected ? "Connected" : "Disconnected"}</span>
      <span className="status-bar-sep">|</span>
      <span className="status-bar-text">{saved ? "Saved" : "Unsaved"}</span>
    </div>
  );
}
