import { useRef, useEffect, useCallback, useMemo } from "react";
import { CellOutput } from "./CellOutput.tsx";
import type { Cell, CellOutput as CellOutputType } from "../types.ts";

declare const hljs: { highlightElement(el: HTMLElement): void } | undefined;

interface Props {
  cell: Cell;
  busy: boolean;
  liveOutputs: CellOutputType[];
  onRun: (cellId: string, code: string) => void;
  onRunAndAdvance: (cellId: string, code: string) => void;
  onDelete: (cellId: string) => void;
  onClear: (cellId: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export function CodeCell({ cell, busy, liveOutputs, onRun, onRunAndAdvance, onDelete, onClear, onMoveUp, onMoveDown }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLElement>(null);

  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    }
  }, []);

  useEffect(() => { autoResize(); }, [autoResize]);

  const applyHighlighting = useCallback(() => {
    const code = textareaRef.current?.value || "";
    const el = highlightRef.current;
    if (el && typeof hljs !== "undefined") {
      el.textContent = code;
      el.removeAttribute("data-highlighted");
      hljs.highlightElement(el);
    }
  }, []);

  // Apply highlighting on mount
  useEffect(() => { applyHighlighting(); }, [applyHighlighting]);

  // Debounced highlighting on input
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedHighlight = useMemo(() => () => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => applyHighlighting(), 150);
  }, [applyHighlighting]);

  const handleInput = useCallback(() => {
    autoResize();
    debouncedHighlight();
  }, [autoResize, debouncedHighlight]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      onRunAndAdvance(cell.id, textareaRef.current?.value || "");
      applyHighlighting();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onRun(cell.id, textareaRef.current?.value || "");
      applyHighlighting();
    }
  };

  const handleBlur = () => { applyHighlighting(); };

  const handleCellClick = (e: React.MouseEvent) => {
    const ta = textareaRef.current;
    if (ta && e.target !== ta) {
      ta.focus();
    }
  };

  const displayOutputs = liveOutputs.length > 0 ? liveOutputs : cell.outputs;

  return (
    <div className="cell code-cell" id={`cell-${cell.id}`} onClick={handleCellClick}>
      <div className="cell-header">
        <span className="exec-count">
          {busy && <span className="busy-indicator" />}
          {cell.execution_count ? `[${cell.execution_count}]` : "[ ]"}
        </span>
        <span className="cell-type">code</span>
        <div className="cell-actions">
          {onMoveUp && <button onClick={(e) => { e.stopPropagation(); onMoveUp(); }} title="Move up"><i className="bi bi-chevron-up" /></button>}
          {onMoveDown && <button onClick={(e) => { e.stopPropagation(); onMoveDown(); }} title="Move down"><i className="bi bi-chevron-down" /></button>}
          <button className="run-btn" onClick={(e) => { e.stopPropagation(); onRun(cell.id, textareaRef.current?.value || ""); applyHighlighting(); }} title="Run cell">
            <i className="bi bi-play-fill" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onClear(cell.id); }} title="Clear output"><i className="bi bi-eraser" /></button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(cell.id); }} title="Delete cell"><i className="bi bi-trash3" /></button>
        </div>
      </div>
      <div className="code-area">
        <pre className="code-highlight" aria-hidden="true">
          <code ref={highlightRef} className="language-typescript">{cell.source.join("\n")}</code>
        </pre>
        <textarea
          ref={textareaRef}
          defaultValue={cell.source.join("\n")}
          placeholder="Write TypeScript here..."
          spellCheck={false}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
        />
      </div>
      <CellOutput outputs={displayOutputs} />
    </div>
  );
}
