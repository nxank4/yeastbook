import { useState, useEffect, useRef, useCallback } from "react";
import type { Cell, Settings } from "@codepawl/yeastbook-core";

interface NotebookFile {
  name: string;
  path: string;
  size: number;
  modified: string;
}

function OpenFileMenu({ onOpen, onClose }: { onOpen: (path: string) => void; onClose: () => void }) {
  const [files, setFiles] = useState<NotebookFile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard/files")
      .then((r) => r.json())
      .then((d) => { setFiles(d.files || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="menu-dropdown open-file-dropdown">
      <div className="open-file-header">Open Notebook</div>
      {loading && <div className="menu-item disabled">Loading...</div>}
      {!loading && files.length === 0 && <div className="menu-item disabled">No .ybk or .ipynb files in current directory</div>}
      {files.map((f) => (
        <button key={f.path} className="menu-item" onClick={() => { onOpen(f.path); onClose(); }}>
          <span>{f.name}</span>
          <span className="menu-shortcut">{(f.size / 1024).toFixed(1)} KB</span>
        </button>
      ))}
    </div>
  );
}

type MenuItem =
  | { label: string; action: () => void; shortcut?: string; disabled?: boolean; icon?: string; checked?: boolean }
  | { label: string; icon?: string; submenu: MenuItem[] }
  | { separator: true };

interface MenuDef {
  label: string;
  items: MenuItem[];
}

interface Props {
  focusedCellId: string | null;
  cells: Cell[];
  clipboardCell: Cell | null;
  runningAll: boolean;
  onNewNotebook: () => void;
  onOpenFile: (path: string) => void;
  onSave: () => void;
  onExportIpynb: () => void;
  onExportYbk: () => void;
  onCutCell: () => void;
  onCopyCell: () => void;
  onPasteCell: () => void;
  onDeleteCell: () => void;
  onMoveCellUp: () => void;
  onMoveCellDown: () => void;
  onRunCell: () => void;
  onRunAll: () => void;
  onRunAllAbove: () => void;
  onRunAllBelow: () => void;
  onInterrupt: () => void;
  onRestart: () => void;
  onRestartAndRunAll: () => void;
  onToggleDarkMode: () => void;
  onTogglePresentation: () => void;
  onFontSizeIncrease: () => void;
  onFontSizeDecrease: () => void;
  onToggleWordWrap: () => void;
  onShowShortcuts: () => void;
  onShowAbout: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onToggleFileExplorer: () => void;
  settings: Settings;
  onUpdateSettings: (s: Settings) => void;
  pythonPath?: string | null;
  onSelectPythonEnv: () => void;
  onCreateVenv: () => void;
  onCloseNotebook?: () => void;
  performanceMode?: boolean;
  onTogglePerfMode?: () => void;
  showToast?: (msg: string) => void;
}

function CustomWidthModal({ currentWidth, onApply, onClose }: { currentWidth: number; onApply: (w: number) => void; onClose: () => void }) {
  const [value, setValue] = useState(String(currentWidth));
  const numValue = Math.max(400, Math.min(2400, Number(value) || 1100));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 340 }}>
        <div className="modal-header">
          <h2>Custom Cell Width</h2>
          <button className="settings-close" onClick={onClose}><i className="bi bi-x-lg" /></button>
        </div>
        <div style={{ padding: "16px 20px" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Width in pixels (400–2400)</span>
            <input
              type="number"
              min={400}
              max={2400}
              step={50}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onApply(numValue); }}
              className="widget-text-input"
              style={{ width: "100%", fontSize: 14, padding: "6px 10px" }}
              autoFocus
            />
          </label>
          <input
            type="range"
            min={400}
            max={2400}
            step={50}
            value={numValue}
            onChange={(e) => setValue(e.target.value)}
            style={{ width: "100%", marginTop: 8 }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button className="ai-cancel-btn" onClick={onClose}>Cancel</button>
            <button className="ai-generate-btn" onClick={() => onApply(numValue)}>Apply</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MenuBar(props: Props) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [showOpenFile, setShowOpenFile] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  const closeAll = useCallback(() => { setOpenMenu(null); setShowOpenFile(false); }, []);

  useEffect(() => {
    if (!openMenu) return;
    const handler = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) closeAll();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenu, closeAll]);

  useEffect(() => {
    if (!openMenu) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAll();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [openMenu, closeAll]);

  const hasFocus = !!props.focusedCellId;
  const currentWidth = props.settings.layout?.maxWidth ?? "medium";
  const setWidth = (w: "small" | "medium" | "full" | "custom") => {
    props.onUpdateSettings({ ...props.settings, layout: { ...props.settings.layout, maxWidth: w } });
  };
  const [customWidthInput, setCustomWidthInput] = useState(false);

  const menus: MenuDef[] = [
    {
      label: "File",
      items: [
        { label: "New Notebook (.ybk)", action: props.onNewNotebook, icon: "bi bi-file-earmark-plus" },
        { separator: true },
        { label: "Open Notebook...", action: () => setShowOpenFile(true), icon: "bi bi-folder2-open" },
        { separator: true },
        { label: "Save", action: props.onSave, shortcut: "Ctrl+S", icon: "bi bi-floppy" },
        { separator: true },
        { label: "Export as .ipynb", action: props.onExportIpynb, icon: "bi bi-file-earmark-arrow-down" },
        { label: "Export as .ybk", action: props.onExportYbk, icon: "bi bi-file-earmark-arrow-down" },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", action: props.onUndo, shortcut: "Ctrl+Z", disabled: !props.canUndo, icon: "bi bi-arrow-counterclockwise" },
        { label: "Redo", action: props.onRedo, shortcut: "Ctrl+Y", disabled: !props.canRedo, icon: "bi bi-arrow-clockwise" },
        { separator: true },
        { label: "Cut Cell", action: props.onCutCell, disabled: !hasFocus, icon: "bi bi-scissors" },
        { label: "Copy Cell", action: props.onCopyCell, disabled: !hasFocus, icon: "bi bi-copy" },
        { label: "Paste Cell Below", action: props.onPasteCell, disabled: !props.clipboardCell, icon: "bi bi-clipboard" },
        { separator: true },
        { label: "Delete Cell", action: props.onDeleteCell, disabled: !hasFocus, icon: "bi bi-trash3" },
        { separator: true },
        { label: "Move Cell Up", action: props.onMoveCellUp, disabled: !hasFocus, icon: "bi bi-arrow-up" },
        { label: "Move Cell Down", action: props.onMoveCellDown, disabled: !hasFocus, icon: "bi bi-arrow-down" },
      ],
    },
    {
      label: "Run",
      items: [
        { label: "Run Cell", action: props.onRunCell, shortcut: "Ctrl+Enter", disabled: !hasFocus, icon: "bi bi-play-fill" },
        { label: "Run Cell & Advance", action: props.onRunCell, shortcut: "Shift+Enter", disabled: !hasFocus, icon: "bi bi-skip-forward-fill" },
        { separator: true },
        { label: "Run All Above", action: props.onRunAllAbove, disabled: !hasFocus || props.runningAll, icon: "bi bi-chevron-double-up" },
        { label: "Run All Below", action: props.onRunAllBelow, disabled: !hasFocus || props.runningAll, icon: "bi bi-chevron-double-down" },
        { label: "Run All", action: props.onRunAll, disabled: props.runningAll, icon: "bi bi-fast-forward-fill" },
        { separator: true },
        { label: "Interrupt Execution", action: props.onInterrupt, shortcut: "I I", icon: "bi bi-stop-fill" },
        { separator: true },
        { label: "Restart Kernel", action: props.onRestart, icon: "bi bi-arrow-repeat" },
        { label: "Restart & Run All", action: props.onRestartAndRunAll, icon: "bi bi-bootstrap-reboot" },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Toggle Sidebar", action: props.onToggleFileExplorer, shortcut: "Ctrl+B", icon: "bi bi-layout-sidebar-inset" },
        { label: "Sidebar Panels", icon: "bi bi-columns-gap", submenu: [
          { label: "File Explorer", action: () => window.dispatchEvent(new CustomEvent("yeastbook-open-tab", { detail: "files" })), icon: "bi bi-files" },
          { label: "Table of Contents", action: () => window.dispatchEvent(new CustomEvent("yeastbook-open-tab", { detail: "toc" })), icon: "bi bi-list-nested" },
          { label: "Variables", action: () => window.dispatchEvent(new CustomEvent("yeastbook-open-tab", { detail: "variables" })), icon: "bi bi-braces" },
          { label: "Resources", action: () => window.dispatchEvent(new CustomEvent("yeastbook-open-tab", { detail: "resources" })), icon: "bi bi-speedometer2" },
          { label: "Environment", action: () => window.dispatchEvent(new CustomEvent("yeastbook-open-tab", { detail: "env" })), icon: "bi bi-key" },
        ]},
        { separator: true },
        { label: "Presentation Mode", action: props.onTogglePresentation, shortcut: "Ctrl+Shift+E", icon: "bi bi-easel" },
        { separator: true },
        { label: "Toggle Dark Mode", action: props.onToggleDarkMode, icon: "bi bi-moon" },
        { separator: true },
        { label: "Font Size: Increase", action: props.onFontSizeIncrease, icon: "bi bi-zoom-in" },
        { label: "Font Size: Decrease", action: props.onFontSizeDecrease, icon: "bi bi-zoom-out" },
        { label: "Word Wrap: Toggle", action: props.onToggleWordWrap, icon: "bi bi-text-wrap" },
        { separator: true },
        { label: "Performance Mode", action: () => props.onTogglePerfMode?.(), icon: "bi bi-lightning-charge-fill", checked: !!props.performanceMode },
        { separator: true },
        { label: "Cell Size", icon: "bi bi-arrows", submenu: [
          { label: "Small (800px)", action: () => setWidth("small"), checked: currentWidth === "small" },
          { label: "Medium (1100px)", action: () => setWidth("medium"), checked: currentWidth === "medium" },
          { label: "Full", action: () => setWidth("full"), checked: currentWidth === "full" },
          { separator: true },
          { label: `Custom${currentWidth === "custom" ? ` (${props.settings.layout?.customWidth ?? 1100}px)` : ""}...`, action: () => setCustomWidthInput(true), checked: currentWidth === "custom" },
        ]},
      ],
    },
    {
      label: "Runtime",
      items: [
        { label: props.pythonPath ? `Python: ${props.pythonPath.includes(".venv") ? ".venv" : props.pythonPath.includes("venv") ? "venv" : props.pythonPath.includes("conda") ? "conda" : "system"}` : "No Python configured", action: () => {}, disabled: true, icon: "bi bi-filetype-py" },
        { separator: true },
        { label: "Change Python Environment...", action: props.onSelectPythonEnv, icon: "bi bi-arrow-left-right" },
        { label: "Create Virtual Environment...", action: props.onCreateVenv, icon: "bi bi-plus-circle" },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Keyboard Shortcuts", action: props.onShowShortcuts, icon: "bi bi-keyboard" },
        { separator: true },
        { label: "About Yeastbook", action: props.onShowAbout, icon: "bi bi-info-circle" },
        { label: "GitHub", action: () => window.open("https://github.com/nxank4/yeastbook", "_blank"), icon: "bi bi-github" },
      ],
    },
  ];

  const copyNotebook = useCallback((mode: "inputs" | "outputs" | "both") => {
    const parts: string[] = [];
    for (const cell of props.cells) {
      const src = cell.source.join("\n");
      const out = (cell.outputs || []).map((o: any) => {
        if (o.output_type === "stream") return (o.text || []).join("");
        if (o.output_type === "execute_result") return o.data?.["text/plain"] ?? "";
        if (o.output_type === "error") return `${o.ename}: ${o.evalue}`;
        return "";
      }).filter(Boolean).join("\n");
      if (mode === "inputs") { if (src.trim()) parts.push(src); }
      else if (mode === "outputs") { if (out.trim()) parts.push(out); }
      else {
        const lines: string[] = [];
        if (src.trim()) lines.push(`// [${cell.cell_type}]\n${src}`);
        if (out.trim()) lines.push(`// [output]\n${out}`);
        if (lines.length) parts.push(lines.join("\n"));
      }
    }
    navigator.clipboard.writeText(parts.join("\n\n"));
    closeAll();
    props.showToast?.("Copied to clipboard");
  }, [props.cells, closeAll, props.showToast]);

  return (
    <>
      <div className="menubar" ref={barRef}>
        {menus.map((menu) => (
          <div key={menu.label} className="menu-container">
            <button
              className={`menu-trigger ${openMenu === menu.label ? "active" : ""}`}
              onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
              onMouseEnter={() => openMenu && setOpenMenu(menu.label)}
            >
              {menu.label}
            </button>
            {openMenu === menu.label && (
              <div className="menu-dropdown">
                {menu.items.map((item, i) =>
                  "separator" in item ? (
                    <hr key={i} className="menu-separator" />
                  ) : "submenu" in item ? (
                    <div key={i} className="menu-item-submenu">
                      <span className="menu-item">
                        <span className="menu-item-label">{item.icon && <i className={item.icon} />} {item.label}</span>
                        <i className="bi bi-chevron-right" style={{ fontSize: 10, opacity: 0.5 }} />
                      </span>
                      <div className="menu-dropdown menu-submenu">
                        {item.submenu.map((sub, j) =>
                          "separator" in sub ? (
                            <hr key={j} className="menu-separator" />
                          ) : (
                            <button
                              key={j}
                              className={`menu-item ${"disabled" in sub && sub.disabled ? "disabled" : ""}`}
                              onClick={() => { if (!("disabled" in sub) || !sub.disabled) { if ("action" in sub) { sub.action(); } closeAll(); } }}
                            >
                              <span className="menu-item-label">{"checked" in sub ? <i className={sub.checked ? "bi bi-check-lg" : ""} style={{ width: 16, display: "inline-block" }} /> : sub.icon && <i className={sub.icon} />} {sub.label}</span>
                              {"shortcut" in sub && sub.shortcut && <span className="menu-shortcut">{sub.shortcut}</span>}
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  ) : (
                    <button
                      key={i}
                      className={`menu-item ${item.disabled ? "disabled" : ""}`}
                      onClick={() => { if (!item.disabled) { item.action(); closeAll(); } }}
                      disabled={item.disabled}
                    >
                      <span className="menu-item-label">{"checked" in item ? <i className={item.checked ? "bi bi-check-lg" : ""} style={{ width: 16, display: "inline-block" }} /> : item.icon && <i className={item.icon} />} {item.label}</span>
                      {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        ))}
        <div className="menubar-actions">
          <div className="menu-container">
            <button
              className={`menubar-action-btn ${openMenu === "_copy" ? "active" : ""}`}
              onClick={() => setOpenMenu(openMenu === "_copy" ? null : "_copy")}
              title="Copy notebook content"
            >
              <i className="bi bi-clipboard" /> Copy All
            </button>
            {openMenu === "_copy" && (
              <div className="menu-dropdown">
                <button className="menu-item" onClick={() => copyNotebook("inputs")}>
                  <span className="menu-item-label"><i className="bi bi-code-slash" /> Copy Inputs</span>
                </button>
                <button className="menu-item" onClick={() => copyNotebook("outputs")}>
                  <span className="menu-item-label"><i className="bi bi-terminal" /> Copy Outputs</span>
                </button>
                <button className="menu-item" onClick={() => copyNotebook("both")}>
                  <span className="menu-item-label"><i className="bi bi-files" /> Copy Both</span>
                </button>
              </div>
            )}
          </div>
          <button
            className="menubar-action-btn"
            onClick={props.onRunCell}
            disabled={!props.focusedCellId}
            title="Run Cell (Shift+Enter)"
          >
            <i className="bi bi-play-fill" /> Run
          </button>
          <button
            className="menubar-action-btn"
            onClick={() => { props.onRunAll(); }}
            disabled={props.runningAll}
            title="Run All Cells"
          >
            <i className="bi bi-fast-forward-fill" /> Run All
          </button>
          <button
            className="menubar-action-btn"
            onClick={props.onRestart}
            title="Restart Kernel"
          >
            <i className="bi bi-arrow-repeat" /> Restart
          </button>
          {props.onCloseNotebook && (
            <button
              className="menubar-action-btn"
              onClick={props.onCloseNotebook}
              title="Close Notebook"
            >
              <i className="bi bi-x-circle" /> Close
            </button>
          )}
        </div>
      </div>
      {showOpenFile && (
        <div className="open-file-overlay" onClick={() => setShowOpenFile(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <OpenFileMenu onOpen={props.onOpenFile} onClose={() => setShowOpenFile(false)} />
          </div>
        </div>
      )}
      {customWidthInput && (
        <CustomWidthModal
          currentWidth={props.settings.layout?.customWidth ?? 1100}
          onApply={(w) => {
            props.onUpdateSettings({ ...props.settings, layout: { ...props.settings.layout, maxWidth: "custom", customWidth: w } });
            setCustomWidthInput(false);
          }}
          onClose={() => setCustomWidthInput(false)}
        />
      )}
    </>
  );
}

// --- Modals ---

interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsModal({ open, onClose }: ShortcutsModalProps) {
  if (!open) return null;
  const shortcuts = [
    ["Shift+Enter", "Run cell & advance"],
    ["Ctrl+Enter", "Run cell & stay"],
    ["Ctrl+S", "Save"],
    ["Ctrl+Z", "Undo (native)"],
    ["Escape", "Deselect cell"],
    ["I I", "Interrupt execution"],
    ["Ctrl+Shift+E", "Toggle presentation mode"],
  ];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Keyboard Shortcuts</h2>
          <button className="settings-close" onClick={onClose}><i className="bi bi-x-lg" /></button>
        </div>
        <table className="shortcuts-table">
          <thead><tr><th>Shortcut</th><th>Action</th></tr></thead>
          <tbody>
            {shortcuts.map(([key, desc]) => (
              <tr key={key}><td><kbd>{key}</kbd></td><td>{desc}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
  version: string;
  bunVersion: string;
}

export function AboutModal({ open, onClose, version, bunVersion }: AboutModalProps) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>About Yeastbook</h2>
          <button className="settings-close" onClick={onClose}><i className="bi bi-x-lg" /></button>
        </div>
        <div className="about-body">
          <p><strong>Yeastbook</strong> v{version}</p>
          <p>A standalone Bun TypeScript notebook.</p>
          <p>Runtime: Bun {bunVersion}</p>
          <p>License: MIT</p>
          <p><a href="https://github.com/nxank4/yeastbook" target="_blank" rel="noopener noreferrer" className="settings-link">GitHub <i className="bi bi-box-arrow-up-right" /></a></p>
        </div>
      </div>
    </div>
  );
}
