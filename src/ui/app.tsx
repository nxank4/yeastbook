import { useState, useEffect, useCallback } from "react";
import { NotebookView } from "./components/NotebookView.tsx";
import { useWebSocket } from "./useWebSocket.ts";
import type { Cell, CellOutput, WsIncoming } from "./types.ts";

export function App() {
  const [cells, setCells] = useState<Cell[]>([]);
  const [busyCells, setBusyCells] = useState<Set<string>>(new Set());
  const [liveOutputs, setLiveOutputs] = useState<Map<string, CellOutput[]>>(new Map());

  const handleWsMessage = useCallback((msg: WsIncoming) => {
    switch (msg.type) {
      case "status":
        setBusyCells((prev) => {
          const next = new Set(prev);
          if (msg.status === "busy") next.add(msg.cellId);
          else next.delete(msg.cellId);
          return next;
        });
        // When idle, merge live outputs into cell data
        if (msg.status === "idle") {
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
            {
              output_type: "stream",
              name: msg.name,
              text: [msg.text],
            },
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
      .then((data) => setCells(data.cells || []));
  }, []);

  const handleRunCell = useCallback(
    (cellId: string, code: string) => {
      // Clear live outputs for this cell
      setLiveOutputs((prev) => {
        const next = new Map(prev);
        next.set(cellId, []);
        return next;
      });
      send({ type: "execute", cellId, code });
    },
    [send]
  );

  const handleDeleteCell = useCallback(async (cellId: string) => {
    await fetch(`/api/cells/${cellId}`, { method: "DELETE" });
    setCells((prev) => prev.filter((c) => c.id !== cellId));
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
  }, []);

  return (
    <>
      <div className="toolbar">
        <h1>Yeastbook</h1>
        <div className={`status ${connected ? "connected" : ""}`}>
          {connected ? "ready" : "connecting..."}
        </div>
      </div>
      <NotebookView
        cells={cells}
        busyCells={busyCells}
        liveOutputs={liveOutputs}
        onRunCell={handleRunCell}
        onDeleteCell={handleDeleteCell}
        onClearOutput={handleClearOutput}
        onUpdateMarkdown={handleUpdateMarkdown}
        onAddCell={handleAddCell}
      />
    </>
  );
}
