import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { NotebookView } from "./components/NotebookView.tsx";
import { EditableFileName } from "./components/EditableFileName.tsx";
import { SettingsPanel } from "./components/SettingsPanel.tsx";
import { MenuBar, ShortcutsModal, AboutModal } from "./components/MenuBar.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { CommandPalette } from "./components/CommandPalette.tsx";
import { useWebSocket } from "./useWebSocket.ts";
import { useKeyboardShortcuts, type Mode } from "./hooks/useKeyboardShortcuts.ts";
import type { Cell, CellOutput, WsIncoming, Settings } from "@yeastbook/core";
import { DEFAULT_SETTINGS } from "@yeastbook/core";

function getInitialTheme(): "light" | "dark" {
  const stored = localStorage.getItem("yeastbook-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function App() {
  const [cells, setCells] = useState<Cell[]>([]);
  const [busyCells, setBusyCells] = useState<Set<string>>(new Set());
  const [liveOutputs, setLiveOutputs] = useState<Map<string, CellOutput[]>>(new Map());
  const [fileName, setFileName] = useState("notebook.ipynb");
  const [saved, setSaved] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">(getInitialTheme);
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS, appearance: { theme: getInitialTheme() } });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [version, setVersion] = useState("");
  const [bunVersion, setBunVersion] = useState("");
  const [fileFormat, setFileFormat] = useState<"ybk" | "ipynb">("ybk");
  const [runningAll, setRunningAll] = useState(false);
  const [focusedCellId, setFocusedCellId] = useState<string | null>(null);
  const [clipboardCell, setClipboardCell] = useState<Cell | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [installStates, setInstallStates] = useState<Map<string, { packages: string[]; logs: string[]; done: boolean; error?: string }>>(new Map());
  const [mode, setMode] = useState<Mode>("command");
  const runAllResolveRef = useRef<(() => void) | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Load settings from server on mount
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setSettings({ editor: data.editor, appearance: data.appearance, execution: data.execution });
        setTheme(data.appearance.theme);
        if (data.version) setVersion(data.version);
        if (data.bunVersion) setBunVersion(data.bunVersion);
      });
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("yeastbook-theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === "light" ? "dark" : "light";
      setSettings((s) => {
        const updated = { ...s, appearance: { theme: next } };
        fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updated),
        });
        return updated;
      });
      return next;
    });
  }, []);

  const handleUpdateSettings = useCallback((next: Settings) => {
    setSettings(next);
    setTheme(next.appearance.theme);
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--editor-font-size", settings.editor.fontSize + "px");
    root.style.setProperty("--editor-tab-size", String(settings.editor.tabSize));
    root.style.setProperty("--editor-word-wrap", settings.editor.wordWrap ? "pre-wrap" : "pre");
  }, [settings.editor]);

  // --- WebSocket ---
  const handleWsMessage = useCallback((msg: WsIncoming) => {
    switch (msg.type) {
      case "status":
        setBusyCells((prev) => {
          const next = new Set(prev);
          if (msg.status === "busy") next.add(msg.cellId);
          else next.delete(msg.cellId);
          return next;
        });
        if (msg.status === "idle") {
          setSaved(true);
          if (runAllResolveRef.current) {
            const resolve = runAllResolveRef.current;
            runAllResolveRef.current = null;
            resolve();
          }
          if (msg.executionCount != null) {
            setCells((prev) =>
              prev.map((c) =>
                c.id === msg.cellId ? { ...c, execution_count: msg.executionCount! } : c
              )
            );
          }
          setLiveOutputs((prev) => {
            const outputs = prev.get(msg.cellId);
            if (outputs) {
              setCells((prevCells) =>
                prevCells.map((c) =>
                  c.id === msg.cellId ? { ...c, outputs: [...outputs] } : c
                )
              );
              const next = new Map(prev);
              next.delete(msg.cellId);
              return next;
            }
            return prev;
          });
        }
        break;
      case "stream":
        setLiveOutputs((prev) => {
          const next = new Map(prev);
          const existing = next.get(msg.cellId) || [];
          next.set(msg.cellId, [
            ...existing,
            { output_type: "stream", name: msg.name, text: [msg.text] },
          ]);
          return next;
        });
        break;
      case "result":
        setLiveOutputs((prev) => {
          const next = new Map(prev);
          const existing = next.get(msg.cellId) || [];
          next.set(msg.cellId, [
            ...existing,
            {
              output_type: "execute_result",
              data: { "text/plain": msg.value },
              metadata: {},
              execution_count: msg.executionCount,
              richOutput: msg.richOutput,
            },
          ]);
          return next;
        });
        setCells((prev) =>
          prev.map((c) =>
            c.id === msg.cellId ? { ...c, execution_count: msg.executionCount } : c
          )
        );
        break;
      case "error":
        setLiveOutputs((prev) => {
          const next = new Map(prev);
          const existing = next.get(msg.cellId) || [];
          next.set(msg.cellId, [
            ...existing,
            {
              output_type: "error",
              ename: msg.ename,
              evalue: msg.evalue,
              traceback: msg.traceback,
            },
          ]);
          return next;
        });
        break;
      case "install_start":
        setInstallStates((prev) => {
          const next = new Map(prev);
          next.set(msg.cellId, { packages: msg.packages, logs: [], done: false });
          return next;
        });
        break;
      case "install_log":
        setInstallStates((prev) => {
          const next = new Map(prev);
          const state = next.get(msg.cellId);
          if (state) {
            next.set(msg.cellId, { ...state, logs: [...state.logs, msg.text] });
          }
          return next;
        });
        break;
      case "install_done":
        setInstallStates((prev) => {
          const next = new Map(prev);
          const state = next.get(msg.cellId);
          if (state) {
            next.set(msg.cellId, { ...state, done: true });
          }
          return next;
        });
        break;
      case "install_error":
        setInstallStates((prev) => {
          const next = new Map(prev);
          const state = next.get(msg.cellId);
          if (state) {
            next.set(msg.cellId, { ...state, done: true, error: msg.error });
          }
          return next;
        });
        break;
      case "notebook_updated":
        showToast("Notebook updated externally. Reloading...");
        fetch("/api/notebook").then((r) => r.json()).then((data) => {
          setCells(data.cells || []);
          if (data.fileName) setFileName(data.fileName);
          if (data.fileFormat) setFileFormat(data.fileFormat);
        });
        break;
      case "auto_saved":
        setSaved(true);
        showToast("Auto-saved");
        break;
    }
  }, [showToast]);

  const { send, connected } = useWebSocket(handleWsMessage);

  // --- Load notebook ---
  const loadNotebookData = useCallback((data: any) => {
    setCells(data.cells || []);
    if (data.fileName) setFileName(data.fileName);
    if (data.fileFormat) setFileFormat(data.fileFormat);
  }, []);

  useEffect(() => {
    fetch("/api/notebook").then((res) => res.json()).then(loadNotebookData);
  }, [loadNotebookData]);

  // --- Cell operations ---
  const handleRunCell = useCallback(
    (cellId: string, code: string) => {
      if (settings.execution.clearOutputBeforeRun) {
        setCells((prev) =>
          prev.map((c) => (c.id === cellId ? { ...c, outputs: [] } : c))
        );
      }
      setLiveOutputs((prev) => {
        const next = new Map(prev);
        next.set(cellId, []);
        return next;
      });
      setSaved(false);
      send({ type: "execute", cellId, code });
    },
    [send, settings.execution.clearOutputBeforeRun]
  );

  const handleRunAndAdvance = useCallback(
    (cellId: string, code: string) => {
      handleRunCell(cellId, code);
    },
    [handleRunCell]
  );

  const handleDeleteCell = useCallback(async (cellId: string) => {
    await fetch(`/api/cells/${cellId}`, { method: "DELETE" });
    setCells((prev) => prev.filter((c) => c.id !== cellId));
    setSaved(true);
  }, []);

  const handleClearOutput = useCallback((cellId: string) => {
    setCells((prev) =>
      prev.map((c) => (c.id === cellId ? { ...c, outputs: [] } : c))
    );
    setLiveOutputs((prev) => {
      const next = new Map(prev);
      next.delete(cellId);
      return next;
    });
  }, []);

  const handleUpdateMarkdown = useCallback(async (cellId: string, source: string) => {
    await fetch(`/api/cells/${cellId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source }),
    });
    setCells((prev) =>
      prev.map((c) => (c.id === cellId ? { ...c, source: [source] } : c))
    );
    setSaved(true);
  }, []);

  const handleSourceChange = useCallback((cellId: string, source: string) => {
    setCells((prev) =>
      prev.map((c) => (c.id === cellId ? { ...c, source: [source] } : c))
    );
  }, []);

  const handleAddCell = useCallback(async (type: "code" | "markdown") => {
    const res = await fetch("/api/cells", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, source: "" }),
    });
    const { id } = await res.json();
    const cell: Cell = { id, cell_type: type, source: [], outputs: [], execution_count: null, metadata: {} };
    setCells((prev) => [...prev, cell]);
    setSaved(true);
  }, []);

  const handleMoveCell = useCallback(async (cellId: string, direction: "up" | "down") => {
    await fetch(`/api/cells/${cellId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction }),
    });
    setCells((prev) => {
      const idx = prev.findIndex((c) => c.id === cellId);
      if (idx === -1) return prev;
      const target = direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
    setSaved(true);
  }, []);

  const handleRename = useCallback(async (newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const res = await fetch("/api/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    const data = await res.json();
    if (data.fileName) setFileName(data.fileName);
    if (data.fileFormat) setFileFormat(data.fileFormat);
  }, []);

  const handleRestart = useCallback(async () => {
    await fetch("/api/restart", { method: "POST" });
    setCells((prev) =>
      prev.map((c) => ({ ...c, outputs: [], execution_count: null }))
    );
    setLiveOutputs(new Map());
    setBusyCells(new Set());
  }, []);

  const handleRunAll = useCallback(async () => {
    setRunningAll(true);
    const currentCells = await new Promise<Cell[]>((resolve) => {
      setCells((prev) => { resolve(prev); return prev; });
    });
    const codeCells = currentCells.filter((c) => c.cell_type === "code");

    for (const cell of codeCells) {
      const code = cell.source.join("\n");
      if (!code.trim()) continue;
      await new Promise<void>((resolve) => {
        runAllResolveRef.current = resolve;
        handleRunCell(cell.id, code);
      });
    }
    setRunningAll(false);
  }, [handleRunCell]);

  const handleSave = useCallback(async () => {
    await fetch("/api/save", { method: "POST" });
    setSaved(true);
    showToast("Saved");
  }, [showToast]);

  // --- Keyboard shortcut handlers ---
  const handleAddCellAbove = useCallback(async () => {
    if (!focusedCellId) return;
    const res = await fetch("/api/cells/insert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "code", source: "", afterId: undefined }),
    });
    const { id } = await res.json();
    const cell: Cell = { id, cell_type: "code", source: [], outputs: [], execution_count: null, metadata: {} };
    setCells((prev) => {
      const idx = prev.findIndex((c) => c.id === focusedCellId);
      if (idx > 0) {
        const next = [...prev];
        next.splice(idx, 0, cell);
        return next;
      }
      return [cell, ...prev];
    });
  }, [focusedCellId]);

  const handleAddCellBelow = useCallback(async () => {
    const afterId = focusedCellId || undefined;
    const res = await fetch("/api/cells/insert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "code", source: "", afterId }),
    });
    const { id } = await res.json();
    const cell: Cell = { id, cell_type: "code", source: [], outputs: [], execution_count: null, metadata: {} };
    setCells((prev) => {
      if (afterId) {
        const idx = prev.findIndex((c) => c.id === afterId);
        if (idx !== -1) {
          const next = [...prev];
          next.splice(idx + 1, 0, cell);
          return next;
        }
      }
      return [...prev, cell];
    });
    setFocusedCellId(id);
  }, [focusedCellId]);

  const handleFocusPrev = useCallback(() => {
    setCells((prev) => {
      const idx = prev.findIndex((c) => c.id === focusedCellId);
      if (idx > 0) setFocusedCellId(prev[idx - 1].id);
      return prev;
    });
  }, [focusedCellId]);

  const handleFocusNext = useCallback(() => {
    setCells((prev) => {
      const idx = prev.findIndex((c) => c.id === focusedCellId);
      if (idx >= 0 && idx < prev.length - 1) setFocusedCellId(prev[idx + 1].id);
      return prev;
    });
  }, [focusedCellId]);

  const handleChangeCellType = useCallback(async (type: "code" | "markdown") => {
    if (!focusedCellId) return;
    setCells((prev) => prev.map((c) => c.id === focusedCellId ? { ...c, cell_type: type } : c));
  }, [focusedCellId]);

  const handleEnterEdit = useCallback(() => {
    setMode("edit");
    if (focusedCellId) {
      const el = document.querySelector(`#cell-${focusedCellId} .monaco-editor`) as HTMLElement;
      el?.querySelector("textarea")?.focus();
    }
  }, [focusedCellId]);

  const handleModeChange = useCallback((newMode: Mode) => {
    setMode(newMode);
  }, []);

  // --- Track focused cell ---
  useEffect(() => {
    const handler = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      const cell = target.closest?.("[id^='cell-']");
      if (cell) {
        setFocusedCellId(cell.id.replace("cell-", ""));
      }
    };
    document.addEventListener("focusin", handler);
    return () => document.removeEventListener("focusin", handler);
  }, []);

  // --- Menu actions ---
  const handleNewNotebook = useCallback(async () => {
    const res = await fetch("/api/new", { method: "POST" });
    const data = await res.json();
    loadNotebookData(data);
    showToast("New notebook created");
  }, [loadNotebookData, showToast]);

  const handleOpenFile = useCallback(async (path: string) => {
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) { showToast("Failed to open file"); return; }
    const data = await res.json();
    loadNotebookData(data);
    showToast(`Opened ${data.fileName}`);
  }, [loadNotebookData, showToast]);

  const handleExportIpynb = useCallback(async () => {
    const res = await fetch("/api/export/ipynb", { method: "POST" });
    const data = await res.json();
    showToast(`Exported to ${data.fileName}`);
  }, [showToast]);

  const handleExportYbk = useCallback(async () => {
    const res = await fetch("/api/export/ybk", { method: "POST" });
    const data = await res.json();
    showToast(`Exported to ${data.fileName}`);
  }, [showToast]);

  const handleCutCell = useCallback(() => {
    if (!focusedCellId) return;
    const cell = cells.find((c) => c.id === focusedCellId);
    if (cell) {
      setClipboardCell({ ...cell });
      handleDeleteCell(focusedCellId);
    }
  }, [focusedCellId, cells, handleDeleteCell]);

  const handleCopyCell = useCallback(() => {
    if (!focusedCellId) return;
    const cell = cells.find((c) => c.id === focusedCellId);
    if (cell) {
      setClipboardCell({ ...cell });
    }
  }, [focusedCellId, cells]);

  const handlePasteCell = useCallback(async () => {
    if (!clipboardCell) return;
    const afterId = focusedCellId || undefined;
    const res = await fetch("/api/cells/insert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: clipboardCell.cell_type, source: clipboardCell.source.join(""), afterId }),
    });
    const { id } = await res.json();
    const newCell: Cell = {
      ...clipboardCell,
      id,
      outputs: clipboardCell.cell_type === "code" ? [] : [],
      execution_count: null,
    };
    setCells((prev) => {
      if (afterId) {
        const idx = prev.findIndex((c) => c.id === afterId);
        if (idx !== -1) {
          const next = [...prev];
          next.splice(idx + 1, 0, newCell);
          return next;
        }
      }
      return [...prev, newCell];
    });
    setSaved(true);
  }, [clipboardCell, focusedCellId]);

  const handleMenuRunCell = useCallback(() => {
    if (!focusedCellId) return;
    const cell = cells.find((c) => c.id === focusedCellId);
    if (cell && cell.cell_type === "code") {
      const code = cell.source.join("\n");
      handleRunCell(focusedCellId, code);
    }
  }, [focusedCellId, cells, handleRunCell]);

  const handleRestartAndRunAll = useCallback(async () => {
    await handleRestart();
    await handleRunAll();
  }, [handleRestart, handleRunAll]);

  const paletteCommands = useMemo(() => [
    { id: "restart", label: "Restart Kernel", action: handleRestart },
    { id: "run-all", label: "Run All Cells", action: handleRunAll },
    { id: "clear-all", label: "Clear All Outputs", action: () => {
      setCells((prev) => prev.map((c) => ({ ...c, outputs: [], execution_count: null })));
      setLiveOutputs(new Map());
    }},
    { id: "save", label: "Save Notebook", shortcut: "Ctrl+S", action: handleSave },
    { id: "add-code", label: "Add Code Cell", shortcut: "B", action: () => handleAddCell("code") },
    { id: "add-md", label: "Add Markdown Cell", action: () => handleAddCell("markdown") },
    { id: "theme", label: "Toggle Dark Mode", action: toggleTheme },
    { id: "export-ipynb", label: "Export as .ipynb", action: handleExportIpynb },
    { id: "export-ybk", label: "Export as .ybk", action: handleExportYbk },
    { id: "settings", label: "Open Settings", action: () => setSettingsOpen(true) },
    { id: "shortcuts", label: "Show Keyboard Shortcuts", action: () => setShortcutsOpen(true) },
  ], [handleRestart, handleRunAll, handleSave, handleAddCell, toggleTheme, handleExportIpynb, handleExportYbk]);

  const FONT_SIZES = [12, 13, 14, 16];

  const handleFontSizeIncrease = useCallback(() => {
    setSettings((s) => {
      const idx = FONT_SIZES.indexOf(s.editor.fontSize);
      const next = idx < FONT_SIZES.length - 1 ? FONT_SIZES[idx + 1] : s.editor.fontSize;
      const updated = { ...s, editor: { ...s.editor, fontSize: next } };
      fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updated) });
      return updated;
    });
  }, []);

  const handleFontSizeDecrease = useCallback(() => {
    setSettings((s) => {
      const idx = FONT_SIZES.indexOf(s.editor.fontSize);
      const next = idx > 0 ? FONT_SIZES[idx - 1] : s.editor.fontSize;
      const updated = { ...s, editor: { ...s.editor, fontSize: next } };
      fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updated) });
      return updated;
    });
  }, []);

  const handleToggleWordWrap = useCallback(() => {
    setSettings((s) => {
      const updated = { ...s, editor: { ...s.editor, wordWrap: !s.editor.wordWrap } };
      fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updated) });
      return updated;
    });
  }, []);

  // Keyboard shortcuts — must be after all callback definitions to avoid TDZ
  useKeyboardShortcuts({
    cells,
    focusedCellId,
    mode,
    onSetMode: setMode,
    onAddCellAbove: handleAddCellAbove,
    onAddCellBelow: handleAddCellBelow,
    onDeleteCell: () => focusedCellId && handleDeleteCell(focusedCellId),
    onChangeCellType: handleChangeCellType,
    onFocusPrev: handleFocusPrev,
    onFocusNext: handleFocusNext,
    onEnterEdit: handleEnterEdit,
    onRunCell: handleMenuRunCell,
    onSave: handleSave,
    onOpenPalette: () => setPaletteOpen(true),
  });

  return (
    <>
      <div className="toolbar">
        <EditableFileName fileName={fileName} onRename={handleRename} />
        <span className="save-indicator">
          {saved ? <><i className="bi bi-check-circle" /> Saved</> : <><i className="bi bi-pencil" /> Unsaved</>}
        </span>
        <div className={`status ${connected ? "connected" : ""}`}>
          <i className={`bi ${connected ? "bi-wifi" : "bi-wifi-off"}`} /> {connected ? "ready" : "connecting..."}
        </div>
      </div>
      <MenuBar
        focusedCellId={focusedCellId}
        cells={cells}
        clipboardCell={clipboardCell}
        runningAll={runningAll}
        onNewNotebook={handleNewNotebook}
        onOpenFile={handleOpenFile}
        onSave={handleSave}
        onExportIpynb={handleExportIpynb}
        onExportYbk={handleExportYbk}
        onCutCell={handleCutCell}
        onCopyCell={handleCopyCell}
        onPasteCell={handlePasteCell}
        onDeleteCell={() => focusedCellId && handleDeleteCell(focusedCellId)}
        onMoveCellUp={() => focusedCellId && handleMoveCell(focusedCellId, "up")}
        onMoveCellDown={() => focusedCellId && handleMoveCell(focusedCellId, "down")}
        onRunCell={handleMenuRunCell}
        onRunAll={handleRunAll}
        onRestart={handleRestart}
        onRestartAndRunAll={handleRestartAndRunAll}
        onToggleDarkMode={toggleTheme}
        onFontSizeIncrease={handleFontSizeIncrease}
        onFontSizeDecrease={handleFontSizeDecrease}
        onToggleWordWrap={handleToggleWordWrap}
        onShowShortcuts={() => setShortcutsOpen(true)}
        onShowAbout={() => setAboutOpen(true)}
      />
      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        version={version}
        bunVersion={bunVersion}
        fileFormat={fileFormat}
        onClose={() => setSettingsOpen(false)}
        onUpdate={handleUpdateSettings}
      />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} version={version} bunVersion={bunVersion} />
      <NotebookView
        cells={cells}
        busyCells={busyCells}
        liveOutputs={liveOutputs}
        settings={settings}
        installStates={installStates}
        mode={mode}
        focusedCellId={focusedCellId}
        onModeChange={handleModeChange}
        onRunCell={handleRunCell}
        onRunAndAdvance={handleRunAndAdvance}
        onSourceChange={handleSourceChange}
        onDeleteCell={handleDeleteCell}
        onClearOutput={handleClearOutput}
        onUpdateMarkdown={handleUpdateMarkdown}
        onAddCell={handleAddCell}
        onMoveCell={handleMoveCell}
      />
      {toast && <div className="toast">{toast}</div>}
      <StatusBar mode={mode} connected={connected} saved={saved} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={paletteCommands} />
    </>
  );
}
