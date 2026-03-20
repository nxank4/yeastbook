import { useRef, useEffect, useCallback } from "react";
import { CellOutput } from "./CellOutput.tsx";
import type { Cell, CellOutput as CellOutputType } from "../types.ts";

interface Props {
  cell: Cell;
  busy: boolean;
  liveOutputs: CellOutputType[];
  onRun: (cellId: string, code: string) => void;
  onDelete: (cellId: string) => void;
  onClear: (cellId: string) => void;
}

export function CodeCell({ cell, busy, liveOutputs, onRun, onDelete, onClear }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    }
  }, []);

  useEffect(() => { autoResize(); }, [autoResize]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      onRun(cell.id, textareaRef.current?.value || "");
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onRun(cell.id, textareaRef.current?.value || "");
    }
  };

  const displayOutputs = liveOutputs.length > 0 ? liveOutputs : cell.outputs;

  return (
    <div className="cell" id={`cell-${cell.id}`}>
      <div className="cell-header">
        <span className="exec-count">
          {busy && <span className="busy-indicator" />}
          {cell.execution_count ? `[${cell.execution_count}]` : "[ ]"}
        </span>
        <span className="cell-type">code</span>
        <div className="cell-actions">
          <button className="run-btn" onClick={() => onRun(cell.id, textareaRef.current?.value || "")}>
            Run
          </button>
          <button onClick={() => onClear(cell.id)}>Clear</button>
          <button onClick={() => onDelete(cell.id)}>Delete</button>
        </div>
      </div>
      <div className="code-area">
        <textarea
          ref={textareaRef}
          defaultValue={cell.source.join("\n")}
          spellCheck={false}
          onInput={autoResize}
          onKeyDown={handleKeyDown}
        />
      </div>
      <CellOutput outputs={displayOutputs} />
    </div>
  );
}
