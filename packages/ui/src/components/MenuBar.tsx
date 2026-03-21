import { useState, useEffect, useRef, useCallback } from "react";
import type { Cell } from "@yeastbook/core";

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
  | { label: string; action: () => void; shortcut?: string; disabled?: boolean }
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
  onRestart: () => void;
  onRestartAndRunAll: () => void;
  onToggleDarkMode: () => void;
  onFontSizeIncrease: () => void;
  onFontSizeDecrease: () => void;
  onToggleWordWrap: () => void;
  onShowShortcuts: () => void;
  onShowAbout: () => void;
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

  const menus: MenuDef[] = [
    {
      label: "File",
      items: [
        { label: "New Notebook (.ybk)", action: props.onNewNotebook },
        { separator: true },
        { label: "Open Notebook...", action: () => setShowOpenFile(true) },
        { separator: true },
        { label: "Save", action: props.onSave, shortcut: "Ctrl+S" },
        { separator: true },
        { label: "Export as .ipynb", action: props.onExportIpynb },
        { label: "Export as .ybk", action: props.onExportYbk },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Cut Cell", action: props.onCutCell, disabled: !hasFocus },
        { label: "Copy Cell", action: props.onCopyCell, disabled: !hasFocus },
        { label: "Paste Cell Below", action: props.onPasteCell, disabled: !props.clipboardCell },
        { separator: true },
        { label: "Delete Cell", action: props.onDeleteCell, disabled: !hasFocus },
        { separator: true },
        { label: "Move Cell Up", action: props.onMoveCellUp, disabled: !hasFocus },
        { label: "Move Cell Down", action: props.onMoveCellDown, disabled: !hasFocus },
      ],
    },
    {
      label: "Run",
      items: [
        { label: "Run Cell", action: props.onRunCell, shortcut: "Shift+Enter", disabled: !hasFocus },
        { label: "Run All", action: props.onRunAll, disabled: props.runningAll },
        { separator: true },
        { label: "Restart Kernel", action: props.onRestart },
        { label: "Restart & Run All", action: props.onRestartAndRunAll },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Toggle Dark Mode", action: props.onToggleDarkMode },
        { separator: true },
        { label: "Font Size: Increase", action: props.onFontSizeIncrease },
        { label: "Font Size: Decrease", action: props.onFontSizeDecrease },
        { label: "Word Wrap: Toggle", action: props.onToggleWordWrap },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Keyboard Shortcuts", action: props.onShowShortcuts },
        { separator: true },
        { label: "About Yeastbook", action: props.onShowAbout },
        { label: "GitHub", action: () => window.open("https://github.com/nxank4/yeastbook", "_blank") },
      ],
    },
  ];

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
                  ) : (
                    <button
                      key={i}
                      className={`menu-item ${item.disabled ? "disabled" : ""}`}
                      onClick={() => { if (!item.disabled) { item.action(); closeAll(); } }}
                      disabled={item.disabled}
                    >
                      <span>{item.label}</span>
                      {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {showOpenFile && (
        <div className="open-file-overlay" onClick={() => setShowOpenFile(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <OpenFileMenu onOpen={props.onOpenFile} onClose={() => setShowOpenFile(false)} />
          </div>
        </div>
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
