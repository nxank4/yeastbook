import { useCallback } from "react";
import type { Settings } from "../types.ts";

interface Props {
  open: boolean;
  settings: Settings;
  version: string;
  bunVersion: string;
  onClose: () => void;
  onUpdate: (settings: Settings) => void;
}

export function SettingsPanel({ open, settings, version, bunVersion, onClose, onUpdate }: Props) {
  const update = useCallback(
    (patch: Partial<Settings>) => {
      const next = {
        editor: { ...settings.editor, ...patch.editor },
        appearance: { ...settings.appearance, ...patch.appearance },
        execution: { ...settings.execution, ...patch.execution },
      };
      onUpdate(next);
    },
    [settings, onUpdate]
  );

  if (!open) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="settings-close" onClick={onClose} title="Close settings">
            <i className="bi bi-x-lg" />
          </button>
        </div>

        <div className="settings-body">
          <section className="settings-section">
            <h3><i className="bi bi-code-slash" /> Editor</h3>

            <label className="settings-row">
              <span>Font size</span>
              <select
                value={settings.editor.fontSize}
                onChange={(e) => update({ editor: { ...settings.editor, fontSize: Number(e.target.value) } })}
              >
                <option value={12}>12px</option>
                <option value={13}>13px</option>
                <option value={14}>14px</option>
                <option value={16}>16px</option>
              </select>
            </label>

            <label className="settings-row">
              <span>Tab size</span>
              <select
                value={settings.editor.tabSize}
                onChange={(e) => update({ editor: { ...settings.editor, tabSize: Number(e.target.value) } })}
              >
                <option value={2}>2</option>
                <option value={4}>4</option>
              </select>
            </label>

            <label className="settings-row">
              <span>Word wrap</span>
              <button
                className={`toggle ${settings.editor.wordWrap ? "on" : ""}`}
                onClick={() => update({ editor: { ...settings.editor, wordWrap: !settings.editor.wordWrap } })}
                role="switch"
                aria-checked={settings.editor.wordWrap}
              >
                <span className="toggle-knob" />
              </button>
            </label>
          </section>

          <section className="settings-section">
            <h3><i className="bi bi-palette" /> Appearance</h3>

            <label className="settings-row">
              <span>Theme</span>
              <select
                value={settings.appearance.theme}
                onChange={(e) => update({ appearance: { theme: e.target.value as "light" | "dark" } })}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
          </section>

          <section className="settings-section">
            <h3><i className="bi bi-lightning" /> Execution</h3>

            <label className="settings-row">
              <span>Auto-save on run</span>
              <button
                className={`toggle ${settings.execution.autoSaveOnRun ? "on" : ""}`}
                onClick={() => update({ execution: { ...settings.execution, autoSaveOnRun: !settings.execution.autoSaveOnRun } })}
                role="switch"
                aria-checked={settings.execution.autoSaveOnRun}
              >
                <span className="toggle-knob" />
              </button>
            </label>

            <label className="settings-row">
              <span>Clear output before re-run</span>
              <button
                className={`toggle ${settings.execution.clearOutputBeforeRun ? "on" : ""}`}
                onClick={() => update({ execution: { ...settings.execution, clearOutputBeforeRun: !settings.execution.clearOutputBeforeRun } })}
                role="switch"
                aria-checked={settings.execution.clearOutputBeforeRun}
              >
                <span className="toggle-knob" />
              </button>
            </label>
          </section>

          <section className="settings-section">
            <h3><i className="bi bi-info-circle" /> About</h3>
            <div className="settings-row">
              <span>Version</span>
              <span className="settings-value">{version}</span>
            </div>
            <div className="settings-row">
              <span>Runtime</span>
              <span className="settings-value">Bun {bunVersion}</span>
            </div>
            <div className="settings-row">
              <span>Source</span>
              <a
                className="settings-link"
                href="https://github.com/nxank4/yeastbook"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub <i className="bi bi-box-arrow-up-right" />
              </a>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
