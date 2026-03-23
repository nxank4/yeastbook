import { useCallback } from "react";
import type { Settings } from "@yeastbook/core";

interface Props {
  open: boolean;
  settings: Settings;
  version: string;
  bunVersion: string;
  fileFormat: "ybk" | "ipynb";
  onClose: () => void;
  onUpdate: (settings: Settings) => void;
}

export function SettingsPanel({ open, settings, version, bunVersion, fileFormat, onClose, onUpdate }: Props) {
  const update = useCallback(
    (patch: Partial<Settings>) => {
      const next = {
        editor: { ...settings.editor, ...patch.editor },
        appearance: { ...settings.appearance, ...patch.appearance },
        execution: { ...settings.execution, ...patch.execution },
        ai: { ...settings.ai, ...patch.ai },
        layout: { ...settings.layout, ...patch.layout },
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
                onChange={(e) => update({ appearance: { ...settings.appearance, theme: e.target.value as "light" | "dark" } })}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>

            <label className="settings-row">
              <span>Notifications</span>
              <select
                value={settings.appearance.notifications ?? "show"}
                onChange={(e) => update({ appearance: { ...settings.appearance, notifications: e.target.value as "show" | "minimize" | "hide" } })}
              >
                <option value="show">Show (top-right)</option>
                <option value="minimize">Minimize (status bar)</option>
                <option value="hide">Hide</option>
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
            <h3><i className="bi bi-layout-sidebar" /> Layout</h3>

            <label className="settings-row">
              <span>Cell width</span>
              <select
                value={settings.layout?.maxWidth ?? "medium"}
                onChange={(e) => update({ layout: { ...settings.layout, maxWidth: e.target.value as "small" | "medium" | "full" | "custom" } })}
              >
                <option value="small">Small (800px)</option>
                <option value="medium">Medium (1100px)</option>
                <option value="full">Full width</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            {settings.layout?.maxWidth === "custom" && (
              <label className="settings-row">
                <span>Width: {settings.layout?.customWidth ?? 1100}px</span>
                <input
                  type="range"
                  min={400}
                  max={2400}
                  step={50}
                  value={settings.layout?.customWidth ?? 1100}
                  onChange={(e) => update({ layout: { ...settings.layout, customWidth: Number(e.target.value) } })}
                  style={{ width: 120 }}
                />
              </label>
            )}

            <label className="settings-row">
              <span>Sidebar</span>
              <button
                className={`toggle ${settings.layout?.sidebar ? "on" : ""}`}
                onClick={() => update({ layout: { ...settings.layout, sidebar: !settings.layout?.sidebar } })}
                role="switch"
                aria-checked={settings.layout?.sidebar ?? false}
              >
                <span className="toggle-knob" />
              </button>
            </label>
          </section>

          <section className="settings-section">
            <h3><i className="bi bi-stars" /> AI Assistant</h3>
            <div className="settings-row">
              <span>Provider</span>
              <select
                value={settings.ai?.provider ?? "disabled"}
                onChange={(e) => onUpdate({ ...settings, ai: { ...settings.ai, provider: e.target.value as any } })}
              >
                <option value="disabled">Disabled</option>
                <option value="anthropic">Claude (Anthropic)</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>
            {settings.ai?.provider !== "disabled" && (
              <div className="settings-row">
                <span>API Key</span>
                <input
                  type="password"
                  value={settings.ai?.apiKey ?? ""}
                  onChange={(e) => onUpdate({ ...settings, ai: { ...settings.ai, apiKey: e.target.value } })}
                  placeholder="sk-..."
                  className="widget-text-input"
                  style={{ width: 200 }}
                />
              </div>
            )}
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
              <span>File format</span>
              <span className="settings-value">.{fileFormat}</span>
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
