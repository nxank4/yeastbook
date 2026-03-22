import type { Mode } from "../hooks/useKeyboardShortcuts.ts";

interface Props {
  mode: Mode;
  connected: boolean;
  saved: boolean;
  notification?: string | null;
}

export function StatusBar({ mode, connected, saved, notification }: Props) {
  return (
    <div className="status-bar">
      <span className={`mode-indicator mode-${mode}`}>{mode.toUpperCase()}</span>
      <span className="status-bar-spacer" />
      {notification && <span className="status-bar-notification">{notification}</span>}
      {notification && <span className="status-bar-sep">|</span>}
      <span className={`status-dot ${connected ? "connected" : ""}`} />
      <span className="status-bar-text">{connected ? "Connected" : "Disconnected"}</span>
      <span className="status-bar-sep">|</span>
      <span className="status-bar-text">{saved ? "Saved" : "Unsaved"}</span>
    </div>
  );
}
