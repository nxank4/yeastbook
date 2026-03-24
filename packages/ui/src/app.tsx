import { useState, useEffect, useCallback, useRef, useMemo, Profiler } from "react";
import { NotebookView } from "./components/NotebookView.tsx";
import { EditableFileName } from "./components/EditableFileName.tsx";
import { SettingsPanel } from "./components/SettingsPanel.tsx";
import { MenuBar, ShortcutsModal, AboutModal } from "./components/MenuBar.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { CommandPalette } from "./components/CommandPalette.tsx";
import { EnvExplorer } from "./components/EnvExplorer.tsx";
import { DependenciesPanel } from "./components/DependenciesPanel.tsx";
import { VariableExplorer } from "./components/VariableExplorer.tsx";
import { FileExplorer } from "./components/FileExplorer.tsx";
import { PerfHUD } from "./components/PerfHUD.tsx";
import { useWebSocket } from "./useWebSocket.ts";
import { useKeyboardShortcuts, type Mode } from "./hooks/useKeyboardShortcuts.ts";
import { useHistory } from "./hooks/useHistory.ts";
import { useDebugMode } from "./hooks/useDebugMode.ts";
import { usePerfMetrics } from "./hooks/usePerfMetrics.ts";
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
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, theme: getInitialTheme() } });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [version, setVersion] = useState("");
  const [bunVersion, setBunVersion] = useState("");
  const [fileFormat, setFileFormat] = useState<"ybk" | "ipynb">("ybk");
  const [dependencies, setDependencies] = useState<Record<string, string>>({});
  const [variables, setVariables] = useState<Record<string, { value: unknown; type: string; serializable: boolean }>>({});
  const [runningAll, setRunningAll] = useState(false);
  const [focusedCellId, setFocusedCellId] = useState<string | null>(null);
  const [clipboardCell, setClipboardCell] = useState<Cell | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [installStates, setInstallStates] = useState<Map<string, { packages: string[]; logs: string[]; done: boolean; error?: string }>>(new Map());
  const [mode, setMode] = useState<Mode>("command");
  const [isPresenting, setIsPresenting] = useState(
    new URLSearchParams(window.location.search).get("mode") === "present"
  );
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [fileTreeVersion, setFileTreeVersion] = useState(0);
  const [pythonPath, setPythonPath] = useState<string | null>(null);
  const [hasVenv, setHasVenv] = useState<boolean>(false);
  const runAllResolveRef = useRef<((hadError: boolean) => void) | null>(null);
  const runAllCellErrorRef = useRef(false);
  const runAllAbortedRef = useRef(false);
  const editorRefsMap = useRef<Map<string, { editor: any; monaco: any }>>(new Map());

  useEffect(() => {
    document.title = `${saved ? "" : "● "}${fileName} — Yeastbook`;
  }, [fileName, saved]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1500);
  }, []);

  const cellsRef = useRef(cells);
  cellsRef.current = cells;
  const getCells = useCallback(() => cellsRef.current, []);
  const applyCells = useCallback((newCells: Cell[]) => setCells(newCells), []);
  const history = useHistory(getCells, applyCells, showToast);

  // Load settings from server on mount
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setSettings({
          editor: data.editor,
          appearance: { notifications: "show", ...data.appearance },
          execution: data.execution,
          ai: data.ai || { provider: "disabled", apiKey: "" },
          layout: { maxWidth: "medium", sidebar: false, ...data.layout },
        });
        setTheme(data.appearance.theme);
        if (data.version) setVersion(data.version);
        if (data.bunVersion) setBunVersion(data.bunVersion);
      });
    fetch("/api/env/info")
      .then((r) => r.json())
      .then((data) => {
        if (data.pythonPath) setPythonPath(data.pythonPath);
        setHasVenv(data.hasVenv ?? false);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("yeastbook-theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === "light" ? "dark" : "light";
      setSettings((s) => {
        const updated = { ...s, appearance: { ...s.appearance, theme: next as "light" | "dark" } };
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

  useEffect(() => {
    const root = document.documentElement;
    const mode = settings.layout?.maxWidth ?? "medium";
    const customPx = Math.max(400, Math.min(2400, settings.layout?.customWidth ?? 1100));
    const WIDTH_MAP: Record<string, string> = { small: "800px", medium: "1100px", full: "100%", custom: `${customPx}px` };
    const pxValues: Record<string, number> = { small: 800, medium: 1100, full: Infinity, custom: customPx };

    const apply = () => {
      const available = window.innerWidth;
      const threshold = pxValues[mode] ?? 1100;
      if (mode !== "full" && available < threshold + 100) {
        root.style.setProperty("--notebook-max-width", "100%");
      } else {
        root.style.setProperty("--notebook-max-width", WIDTH_MAP[mode] ?? "1100px");
      }
    };

    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [settings.layout?.maxWidth, settings.layout?.customWidth]);

  // --- WebSocket ---
  const perfRef = useRef<{ recordPong: (ts: number) => void; recordExecStart: (id: string) => void; recordExecEnd: (id: string) => void }>({ recordPong: () => {}, recordExecStart: () => {}, recordExecEnd: () => {} });
  const handleWsMessage = useCallback((msg: WsIncoming) => {
    switch (msg.type) {
      case "pong":
        perfRef.current.recordPong(msg.ts);
        break;
      case "status":
        setBusyCells((prev) => {
          const next = new Set(prev);
          if (msg.status === "busy") next.add(msg.cellId);
          else next.delete(msg.cellId);
          return next;
        });
        if (msg.status === "idle") {
          perfRef.current.recordExecEnd(msg.cellId);
          setSaved(true);
          if (runAllResolveRef.current) {
            const resolve = runAllResolveRef.current;
            const hadError = runAllCellErrorRef.current;
            runAllResolveRef.current = null;
            runAllCellErrorRef.current = false;
            resolve(hadError);
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
        // Flag error for run-all abort (before idle status arrives)
        if (runAllResolveRef.current) {
          runAllCellErrorRef.current = true;
        }
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
            // Persist install output to cell outputs so copy/export captures it
            const text = state.logs.join("") + `\nInstalled ${state.packages.join(", ")}\n`;
            setCells((prevCells) => prevCells.map((c) =>
              c.id === msg.cellId ? { ...c, outputs: [{ output_type: "stream", name: "stdout", text: [text] }] } : c
            ));
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
            // Persist error to cell outputs
            const text = state.logs.join("") + `\nInstall failed: ${msg.error}\n`;
            setCells((prevCells) => prevCells.map((c) =>
              c.id === msg.cellId ? { ...c, outputs: [{ output_type: "stream", name: "stderr", text: [text] }] } : c
            ));
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
      case "files_changed":
        setFileTreeVersion((v) => v + 1);
        break;
      case "dependencies_updated":
        setDependencies(msg.dependencies);
        break;
      case "snapshot_restored":
        setVariables(msg.variables);
        showToast(`↩ Session restored — ${msg.restoredCount} variables recovered`);
        break;
      case "variables_updated":
        setVariables(msg.variables);
        break;
      case "python_status":
        if (msg.status === "available" && msg.pythonPath) {
          setPythonPath(msg.pythonPath);
        } else if (msg.status === "unavailable") {
          setPythonPath(null);
        }
        break;
    }
  }, [showToast]);

  const { send, connected } = useWebSocket(handleWsMessage);

  // --- Debug / Performance ---
  const { enabled: debugEnabled, toggle: toggleDebug } = useDebugMode();
  const perfMetrics = usePerfMetrics(debugEnabled, send);
  perfRef.current = perfMetrics;

  // --- Load notebook ---
  const loadNotebookData = useCallback((data: any) => {
    setCells(data.cells || []);
    if (data.fileName) setFileName(data.fileName);
    if (data.fileFormat) setFileFormat(data.fileFormat);
  }, []);

  useEffect(() => {
    fetch("/api/notebook").then((res) => res.json()).then(loadNotebookData);
    fetch("/api/dependencies").then((r) => r.json()).then((d) => setDependencies(d.dependencies || {})).catch(() => {});
    fetch("/api/variables").then((r) => r.json()).then((d) => setVariables(d.variables || {})).catch(() => {});
  }, [loadNotebookData]);

  // --- Cell operations ---
  const handleRunCell = useCallback(
    (cellId: string, code: string) => {
      // Always clear previous outputs when starting a new run
      setCells((prev) =>
        prev.map((c) => (c.id === cellId ? { ...c, outputs: [] } : c))
      );
      setLiveOutputs((prev) => {
        const next = new Map(prev);
        next.set(cellId, []);
        return next;
      });
      setSaved(false);
      perfRef.current.recordExecStart(cellId);
      // Send cell language from metadata so server can route to correct kernel
      const cell = cellsRef.current.find((c) => c.id === cellId);
      const language = cell?.metadata?.language as string | undefined;
      send({ type: "execute", cellId, code, ...(language ? { language } : {}) });
    },
    [send]
  );

  const handleCreateVenv = useCallback(async () => {
    showToast("Creating virtual environment...");
    try {
      const res = await fetch("/api/env/create-venv", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        showToast("Virtual environment created");
        setHasVenv(true);
        // Refresh env info to get python path
        const info = await fetch("/api/env/info").then((r) => r.json());
        if (info.pythonPath) setPythonPath(info.pythonPath);
        setHasVenv(info.hasVenv ?? true);
      } else {
        showToast(`Failed: ${data.error}`);
      }
    } catch {
      showToast("Failed to create virtual environment");
    }
  }, [showToast]);

  const handleEditorMount = useCallback((cellId: string, editor: any, monaco: any) => {
    editorRefsMap.current.set(cellId, { editor, monaco });
    // Clean up on dispose
    editor.onDidDispose(() => {
      editorRefsMap.current.delete(cellId);
    });
  }, []);

  const handleSelectAcrossCells = useCallback((searchText: string) => {
    for (const [, { editor, monaco }] of editorRefsMap.current) {
      const model = editor.getModel();
      if (!model) continue;
      const matches = model.findMatches(searchText, true, false, true, null, true);
      if (matches.length > 0) {
        const selections = matches.map((m: any) => new monaco.Selection(
          m.range.startLineNumber, m.range.startColumn,
          m.range.endLineNumber, m.range.endColumn,
        ));
        editor.setSelections(selections);
      }
    }
  }, []);

  const focusCellEditor = useCallback((targetCellId: string) => {
    setFocusedCellId(targetCellId);
    setMode("edit");
    // Delay to let React render the focused state before querying DOM
    setTimeout(() => {
      const el = document.querySelector(`#cell-${targetCellId} .monaco-editor`) as HTMLElement;
      el?.querySelector("textarea")?.focus();
    }, 50);
  }, []);

  const handleRunAndAdvance = useCallback(
    async (cellId: string, code: string) => {
      handleRunCell(cellId, code);
      const idx = cellsRef.current.findIndex((c) => c.id === cellId);
      if (idx >= 0 && idx < cellsRef.current.length - 1) {
        // Focus next existing cell
        focusCellEditor(cellsRef.current[idx + 1]!.id);
      } else if (idx === cellsRef.current.length - 1) {
        // Last cell — create a new one and focus it
        const res = await fetch("/api/cells/insert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "code", source: "", afterId: cellId }),
        });
        const { id } = await res.json();
        const cell: Cell = { id, cell_type: "code", source: [], outputs: [], execution_count: null, metadata: {} };
        setCells((prev) => [...prev, cell]);
        setSaved(true);
        // Longer delay for new cell to mount
        setTimeout(() => focusCellEditor(id), 100);
      }
    },
    [handleRunCell, focusCellEditor]
  );

  const handleDeleteCell = useCallback(async (cellId: string) => {
    const idx = cellsRef.current.findIndex((c) => c.id === cellId);
    const cell = cellsRef.current[idx];
    if (cell) history.push({ type: "delete_cell", cell, index: idx });
    await fetch(`/api/cells/${cellId}`, { method: "DELETE" });
    setCells((prev) => prev.filter((c) => c.id !== cellId));
    setSaved(true);
  }, [history]);

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

  const sourceChangeTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const handleSourceChange = useCallback((cellId: string, source: string) => {
    setCells((prev) =>
      prev.map((c) => (c.id === cellId ? { ...c, source: [source] } : c))
    );
    setSaved(false);
    // Debounce server save — 500ms after last keystroke
    const existing = sourceChangeTimers.current.get(cellId);
    if (existing) clearTimeout(existing);
    sourceChangeTimers.current.set(cellId, setTimeout(() => {
      sourceChangeTimers.current.delete(cellId);
      fetch(`/api/cells/${cellId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
    }, 500));
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
    const idx = cellsRef.current.findIndex((c) => c.id === cellId);
    const target = direction === "up" ? idx - 1 : idx + 1;
    if (idx !== -1 && target >= 0 && target < cellsRef.current.length) {
      history.push({ type: "move_cell", cellId, fromIndex: idx, toIndex: target });
    }
    await fetch(`/api/cells/${cellId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction }),
    });
    setCells((prev) => {
      const i = prev.findIndex((c) => c.id === cellId);
      if (i === -1) return prev;
      const t = direction === "up" ? i - 1 : i + 1;
      if (t < 0 || t >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[t]] = [next[t]!, next[i]!];
      return next;
    });
    setSaved(true);
  }, []);

  const handleReorderCell = useCallback(async (cellId: string, toIndex: number) => {
    const fromIndex = cellsRef.current.findIndex((c) => c.id === cellId);
    if (fromIndex === -1 || fromIndex === toIndex) return;
    history.push({ type: "move_cell", cellId, fromIndex, toIndex });
    setCells((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved!);
      return next;
    });
    await fetch(`/api/cells/${cellId}/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toIndex }),
    });
    setSaved(false);
  }, [history]);

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
    setVariables({});
  }, []);

  const runCellSequence = useCallback(async (codeCells: Cell[]) => {
    runAllAbortedRef.current = false;
    runAllCellErrorRef.current = false;
    setRunningAll(true);
    for (const cell of codeCells) {
      if (runAllAbortedRef.current) break;
      const code = cell.source.join("\n");
      if (!code.trim()) continue;
      const hadError = await new Promise<boolean>((resolve) => {
        runAllResolveRef.current = resolve;
        handleRunCell(cell.id, code);
      });
      if (hadError) {
        showToast("Run All stopped — cell error");
        break;
      }
    }
    setRunningAll(false);
  }, [handleRunCell, showToast]);

  const handleRunAll = useCallback(async () => {
    const currentCells = await new Promise<Cell[]>((resolve) => {
      setCells((prev) => { resolve(prev); return prev; });
    });
    await runCellSequence(currentCells.filter((c) => c.cell_type === "code"));
  }, [runCellSequence]);

  const handleRunAllAbove = useCallback(async (targetCellId?: string) => {
    const cellId = targetCellId ?? focusedCellId;
    if (!cellId) return;
    const currentCells = await new Promise<Cell[]>((resolve) => {
      setCells((prev) => { resolve(prev); return prev; });
    });
    const idx = currentCells.findIndex((c) => c.id === cellId);
    if (idx === -1) return;
    await runCellSequence(currentCells.slice(0, idx + 1).filter((c) => c.cell_type === "code"));
  }, [runCellSequence, focusedCellId]);

  const handleRunAllBelow = useCallback(async (targetCellId?: string) => {
    const cellId = targetCellId ?? focusedCellId;
    if (!cellId) return;
    const currentCells = await new Promise<Cell[]>((resolve) => {
      setCells((prev) => { resolve(prev); return prev; });
    });
    const idx = currentCells.findIndex((c) => c.id === cellId);
    if (idx === -1) return;
    await runCellSequence(currentCells.slice(idx).filter((c) => c.cell_type === "code"));
  }, [runCellSequence, focusedCellId]);

  const handleInterrupt = useCallback(() => {
    runAllAbortedRef.current = true;
    send({ type: "interrupt" });
  }, [send]);

  const handleSave = useCallback(async () => {
    await fetch("/api/save", { method: "POST" });
    setSaved(true);
    showToast("Saved");
  }, [showToast]);

  const handleInsertCellAt = useCallback(async (type: "code" | "markdown", position: "above" | "below", targetCellId: string) => {
    const targetIdx = cellsRef.current.findIndex((c) => c.id === targetCellId);
    if (position === "above") {
      const res = await fetch("/api/cells/insert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, source: "" }),
      });
      const { id } = await res.json();
      const cell: Cell = { id, cell_type: type, source: [], outputs: [], execution_count: null, metadata: {} };
      const insertIdx = targetIdx >= 0 ? targetIdx : 0;
      history.push({ type: "add_cell", cell, index: insertIdx });
      setCells((prev) => {
        const idx = prev.findIndex((c) => c.id === targetCellId);
        if (idx >= 0) {
          const next = [...prev];
          next.splice(idx, 0, cell);
          return next;
        }
        return [cell, ...prev];
      });
    } else {
      const res = await fetch("/api/cells/insert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, source: "", afterId: targetCellId }),
      });
      const { id } = await res.json();
      const cell: Cell = { id, cell_type: type, source: [], outputs: [], execution_count: null, metadata: {} };
      const insertIdx = targetIdx !== -1 ? targetIdx + 1 : cellsRef.current.length;
      history.push({ type: "add_cell", cell, index: insertIdx });
      setCells((prev) => {
        const idx = prev.findIndex((c) => c.id === targetCellId);
        if (idx !== -1) {
          const next = [...prev];
          next.splice(idx + 1, 0, cell);
          return next;
        }
        return [...prev, cell];
      });
    }
    setSaved(false);
  }, [history]);

  const handleCutCellById = useCallback((cellId: string) => {
    const cell = cells.find((c) => c.id === cellId);
    if (cell) {
      setClipboardCell({ ...cell });
      handleDeleteCell(cellId);
    }
  }, [cells, handleDeleteCell]);

  const handleCopyCellById = useCallback((cellId: string) => {
    const cell = cells.find((c) => c.id === cellId);
    if (cell) setClipboardCell({ ...cell });
  }, [cells]);

  const handlePasteCellBelow = useCallback(async (afterCellId: string) => {
    if (!clipboardCell) return;
    const res = await fetch("/api/cells/insert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: clipboardCell.cell_type, source: clipboardCell.source.join(""), afterId: afterCellId }),
    });
    const { id } = await res.json();
    const newCell: Cell = { ...clipboardCell, id, outputs: [], execution_count: null };
    setCells((prev) => {
      const idx = prev.findIndex((c) => c.id === afterCellId);
      if (idx !== -1) {
        const next = [...prev];
        next.splice(idx + 1, 0, newCell);
        return next;
      }
      return [...prev, newCell];
    });
    setSaved(false);
  }, [clipboardCell]);

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
      if (idx > 0) setFocusedCellId(prev[idx - 1]!.id);
      return prev;
    });
  }, [focusedCellId]);

  const handleFocusNext = useCallback(() => {
    setCells((prev) => {
      const idx = prev.findIndex((c) => c.id === focusedCellId);
      if (idx >= 0 && idx < prev.length - 1) setFocusedCellId(prev[idx + 1]!.id);
      return prev;
    });
  }, [focusedCellId]);

  const handleChangeCellType = useCallback(async (type: "code" | "markdown", cellId?: string) => {
    const id = cellId ?? focusedCellId;
    if (!id) return;
    const cell = cellsRef.current.find((c) => c.id === id);
    if (cell && cell.cell_type !== type) {
      history.push({ type: "change_type", cellId: id, before: cell.cell_type, after: type });
    }
    setCells((prev) => prev.map((c) => {
      if (c.id !== id) return c;
      if (type === "markdown") return { ...c, cell_type: type, outputs: [], execution_count: null };
      return { ...c, cell_type: type };
    }));
    await fetch(`/api/cells/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cell_type: type }),
    });
  }, [focusedCellId, history]);

  const handleChangeLanguage = useCallback(async (cellId: string, language: string) => {
    setCells((prev) => prev.map((c) =>
      c.id === cellId ? { ...c, metadata: { ...c.metadata, language } } : c
    ));
    await fetch(`/api/cells/${cellId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: { language } }),
    });
  }, []);

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
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      const cell = target.closest?.("[id^='cell-']");
      if (cell) {
        setFocusedCellId(cell.id.replace("cell-", ""));
      }
    };
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const cell = target.closest?.("[id^='cell-']");
      const isOverlay = target.closest?.(".context-menu, .palette-overlay, .settings-overlay, .modal-overlay, .menu-dropdown, .open-file-overlay");
      if (isOverlay) return; // don't change focus when clicking overlays
      if (cell) {
        // Clicking inside a cell — select it in command mode
        // (unless clicking inside Monaco editor, which will trigger focusin → edit mode)
        const cellId = cell.id.replace("cell-", "");
        setFocusedCellId(cellId);
        const isEditor = target.closest?.(".monaco-editor");
        if (!isEditor) setMode("command");
      } else {
        setFocusedCellId(null);
        setMode("command");
      }
    };
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("mousedown", handleMouseDown);
    };
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

  const togglePresentation = useCallback(() => {
    setIsPresenting((prev) => {
      const next = !prev;
      const url = new URL(window.location.href);
      if (next) url.searchParams.set("mode", "present");
      else url.searchParams.delete("mode");
      window.history.replaceState({}, "", url.toString());
      return next;
    });
  }, []);

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
    { id: "present", label: "Toggle Presentation Mode", shortcut: "Ctrl+Shift+E", action: togglePresentation },
    { id: "run-above", label: "Run All Above", action: () => handleRunAllAbove() },
    { id: "run-below", label: "Run All Below", action: () => handleRunAllBelow() },
    { id: "interrupt", label: "Interrupt Execution", shortcut: "I I", action: handleInterrupt },
    { id: "file-explorer", label: "Toggle File Explorer", shortcut: "Ctrl+B", action: () => setLeftSidebarOpen((p) => !p) },
  ], [handleRestart, handleRunAll, handleSave, handleAddCell, toggleTheme, handleExportIpynb, handleExportYbk, togglePresentation, handleRunAllAbove, handleRunAllBelow, handleInterrupt]);

  const FONT_SIZES = [12, 13, 14, 16];

  const handleFontSizeIncrease = useCallback(() => {
    setSettings((s) => {
      const idx = FONT_SIZES.indexOf(s.editor.fontSize);
      const next = idx < FONT_SIZES.length - 1 ? FONT_SIZES[idx + 1]! : s.editor.fontSize;
      const updated = { ...s, editor: { ...s.editor, fontSize: next } };
      fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updated) });
      return updated;
    });
  }, []);

  const handleFontSizeDecrease = useCallback(() => {
    setSettings((s) => {
      const idx = FONT_SIZES.indexOf(s.editor.fontSize);
      const next = idx > 0 ? FONT_SIZES[idx - 1]! : s.editor.fontSize;
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
    busyCells,
    mode,
    isPresenting,
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
    onTogglePresentation: togglePresentation,
    onInterrupt: handleInterrupt,
    onToggleLanguage: () => {
      if (!focusedCellId) return;
      const cell = cellsRef.current.find((c) => c.id === focusedCellId);
      const current = cell?.metadata?.language as string | undefined;
      handleChangeLanguage(focusedCellId, current === "python" ? "typescript" : "python");
    },
    onUndo: history.undo,
    onRedo: history.redo,
    onToggleFileExplorer: () => setLeftSidebarOpen((p) => !p),
    onFocusCell: (cellId: string) => setFocusedCellId(cellId),
  });

  return (
    <>
      {isPresenting ? (
        <div className="presentation-header">
          <span className="presentation-badge">&#9654; Presenting</span>
          <span className="presentation-title">{fileName}</span>
          <button onClick={togglePresentation} className="exit-present-btn">&#9998; Edit</button>
        </div>
      ) : (
        <>
          <div className="toolbar">
            <span className="toolbar-logo"><img src="./favicon.png" alt="" width="26" height="26" style={{ verticalAlign: "middle", marginRight: 6 }} />yeastbook</span>
            <EditableFileName fileName={fileName} onRename={handleRename} />
            <span style={{ flex: 1 }} />
            <button onClick={togglePresentation} className="toolbar-btn present-btn" title="Presentation mode (Ctrl+Shift+E)">
              &#9654; Present
            </button>
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
            onRunAllAbove={() => handleRunAllAbove()}
            onRunAllBelow={() => handleRunAllBelow()}
            onInterrupt={handleInterrupt}
            onRestart={handleRestart}
            onRestartAndRunAll={handleRestartAndRunAll}
            onToggleDarkMode={toggleTheme}
            onTogglePresentation={togglePresentation}
            onFontSizeIncrease={handleFontSizeIncrease}
            onFontSizeDecrease={handleFontSizeDecrease}
            onToggleWordWrap={handleToggleWordWrap}
            onShowShortcuts={() => setShortcutsOpen(true)}
            onShowAbout={() => setAboutOpen(true)}
            onUndo={history.undo}
            onRedo={history.redo}
            canUndo={history.canUndo()}
            canRedo={history.canRedo()}
            onToggleFileExplorer={() => setLeftSidebarOpen((p) => !p)}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
          />
        </>
      )}
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
      <Profiler id="notebook" onRender={perfMetrics.onProfilerRender}>
      <div className="notebook-layout">
      {!isPresenting && !leftSidebarOpen && (
        <button
          className="sidebar-left-tab"
          title="Open File Explorer (Ctrl+B)"
          onClick={() => setLeftSidebarOpen(true)}
        >
          <i className="bi bi-folder" />
        </button>
      )}
      {!isPresenting && (
        <div className={`sidebar-left ${leftSidebarOpen ? "" : "collapsed"}`}>
          <FileExplorer
            onOpenNotebook={handleOpenFile}
            onClose={() => setLeftSidebarOpen(false)}
            refreshTrigger={fileTreeVersion}
          />
        </div>
      )}
      <NotebookView
        cells={cells}
        busyCells={busyCells}
        liveOutputs={liveOutputs}
        settings={settings}
        installStates={installStates}
        mode={mode}
        focusedCellId={focusedCellId}
        isPresenting={isPresenting}
        onModeChange={handleModeChange}
        onRunCell={handleRunCell}
        onRunAndAdvance={handleRunAndAdvance}
        onSourceChange={handleSourceChange}
        onDeleteCell={handleDeleteCell}
        onClearOutput={handleClearOutput}
        onUpdateMarkdown={handleUpdateMarkdown}
        onAddCell={handleAddCell}
        onMoveCell={handleMoveCell}
        onRunAllAbove={handleRunAllAbove}
        onRunAllBelow={handleRunAllBelow}
        onInterrupt={handleInterrupt}
        onChangeCellType={handleChangeCellType}
        onChangeLanguage={handleChangeLanguage}
        onInsertCellAt={handleInsertCellAt}
        onCutCell={handleCutCellById}
        onCopyCell={handleCopyCellById}
        onPasteCellBelow={handlePasteCellBelow}
        hasClipboard={!!clipboardCell}
        onRunAll={handleRunAll}
        onHistoryPush={history.push}
        onReorderCell={handleReorderCell}
        onSave={handleSave}
        onOpenPalette={() => setPaletteOpen(true)}
        onEditorMount={handleEditorMount}
        onSelectAcrossCells={handleSelectAcrossCells}
      />
      {settings.layout?.sidebar && !isPresenting && (
        <div className="notebook-sidebar">
          <VariableExplorer variables={variables} />
          <EnvExplorer />
          <DependenciesPanel dependencies={dependencies} />
        </div>
      )}
      </div>
      </Profiler>
      {toast && settings.appearance.notifications === "show" && <div className="toast">{toast}</div>}
      {!isPresenting && <StatusBar mode={mode} connected={connected} saved={saved} notification={settings.appearance.notifications === "minimize" ? toast : null} bunVersion={bunVersion} pythonPath={pythonPath} hasVenv={hasVenv} onCreateVenv={handleCreateVenv} />}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={paletteCommands} />
      {debugEnabled && <PerfHUD metrics={perfMetrics.metrics} />}
    </>
  );
}
