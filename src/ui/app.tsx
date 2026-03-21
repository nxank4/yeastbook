import { useState, useEffect, useCallback, useRef } from "react";
import { NotebookView } from "./components/NotebookView.tsx";
import { EditableFileName } from "./components/EditableFileName.tsx";
import { SettingsPanel } from "./components/SettingsPanel.tsx";
import { useWebSocket } from "./useWebSocket.ts";
import type { Cell, CellOutput, WsIncoming, Settings } from "./types.ts";
import { DEFAULT_SETTINGS } from "./types.ts";

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
  const [runningAll, setRunningAll] = useState(false);
  const pendingFocusCellId = useRef<string | null>(null);
  const runAllResolveRef = useRef<(() => void) | null>(null);

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
    // Switch highlight.js theme
    const light = document.getElementById("hljs-light") as HTMLLinkElement | null;
    const dark = document.getElementById("hljs-dark") as HTMLLinkElement | null;
    if (light) light.media = theme === "light" ? "all" : "not all";
    if (dark) dark.media = theme === "dark" ? "all" : "not all";
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

  // Apply editor settings as CSS custom properties
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--editor-font-size", settings.editor.fontSize + "px");
    root.style.setProperty("--editor-tab-size", String(settings.editor.tabSize));
    root.style.setProperty("--editor-word-wrap", settings.editor.wordWrap ? "pre-wrap" : "pre");
  }, [settings.editor]);

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
    }
  }, []);

  const { send, connected } = useWebSocket(handleWsMessage);

  useEffect(() => {
    fetch("/api/notebook")
      .then((res) => res.json())
      .then((data) => {
        setCells(data.cells || []);
        if (data.fileName) setFileName(data.fileName);
      });
  }, []);

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
      setCells((prev) => {
        const idx = prev.findIndex((c) => c.id === cellId);
        if (idx >= 0 && idx < prev.length - 1) {
          pendingFocusCellId.current = prev[idx + 1].id;
        }
        return prev;
      });
    },
    [handleRunCell]
  );

  // Focus next cell after state update
  useEffect(() => {
    if (pendingFocusCellId.current) {
      const id = pendingFocusCellId.current;
      pendingFocusCellId.current = null;
      requestAnimationFrame(() => {
        const el = document.querySelector(`#cell-${id} textarea`) as HTMLTextAreaElement | null;
        el?.focus();
      });
    }
  }, [cells]);

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

  const handleAddCell = useCallback(async (type: "code" | "markdown") => {
    const res = await fetch("/api/cells", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, source: "" }),
    });
    const { id } = await res.json();
    const cell: Cell = {
      id,
      cell_type: type,
      source: [],
      outputs: [],
      execution_count: null,
      metadata: {},
    };
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
    // Snapshot current cells
    const currentCells = await new Promise<Cell[]>((resolve) => {
      setCells((prev) => { resolve(prev); return prev; });
    });
    const codeCells = currentCells.filter((c) => c.cell_type === "code");

    for (const cell of codeCells) {
      // Get latest source from textarea
      const ta = document.querySelector(`#cell-${cell.id} textarea`) as HTMLTextAreaElement | null;
      const code = ta?.value ?? cell.source.join("\n");
      if (!code.trim()) continue;

      // Wait for this cell to finish
      await new Promise<void>((resolve) => {
        runAllResolveRef.current = resolve;
        handleRunCell(cell.id, code);
      });
    }
    setRunningAll(false);
  }, [handleRunCell]);

  return (
    <>
      <div className="toolbar">
        <EditableFileName fileName={fileName} onRename={handleRename} />
        <span className="save-indicator">
          {saved ? <><i className="bi bi-check-circle" /> Saved</> : <><i className="bi bi-pencil" /> Unsaved</>}
        </span>
        <button className="toolbar-btn run-all-btn" onClick={handleRunAll} disabled={runningAll} title="Run all cells">
          <i className={`bi ${runningAll ? "bi-hourglass-split" : "bi-play-fill"}`} /> {runningAll ? "Running..." : "Run All"}
        </button>
        <button className="restart-btn" onClick={handleRestart} title="Restart kernel">
          <i className="bi bi-arrow-counterclockwise" /> Restart
        </button>
        <button className="toolbar-btn" onClick={toggleTheme} title="Toggle light/dark mode">
          <i className={`bi ${theme === "light" ? "bi-moon-fill" : "bi-sun-fill"}`} />
        </button>
        <button className="toolbar-btn" onClick={() => setSettingsOpen(true)} title="Settings">
          <i className="bi bi-gear" />
        </button>
        <div className={`status ${connected ? "connected" : ""}`}>
          <i className={`bi ${connected ? "bi-wifi" : "bi-wifi-off"}`} /> {connected ? "ready" : "connecting..."}
        </div>
      </div>
      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        version={version}
        bunVersion={bunVersion}
        onClose={() => setSettingsOpen(false)}
        onUpdate={handleUpdateSettings}
      />
      <NotebookView
        cells={cells}
        busyCells={busyCells}
        liveOutputs={liveOutputs}
        onRunCell={handleRunCell}
        onRunAndAdvance={handleRunAndAdvance}
        onDeleteCell={handleDeleteCell}
        onClearOutput={handleClearOutput}
        onUpdateMarkdown={handleUpdateMarkdown}
        onAddCell={handleAddCell}
        onMoveCell={handleMoveCell}
      />
    </>
  );
}
