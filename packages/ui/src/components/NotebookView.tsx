import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { draggable, dropTargetForElements, monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";

function LiveTimer({ startTime }: { startTime: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);
  const ms = now - startTime;
  const label = ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}m`;
  return <span className="cell-exec-time cell-exec-time-live">{label}</span>;
}
import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
import { attachClosestEdge, extractClosestEdge, type Edge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { CodeCell } from "./CodeCell.tsx";
import { MarkdownCell } from "./MarkdownCell.tsx";
import type { Cell, CellOutput, Settings } from "@codepawl/yeastbook-core";
import type { Mode } from "../hooks/useKeyboardShortcuts.ts";

interface Props {
  cells: Cell[];
  busyCells: Set<string>;
  liveOutputs: Map<string, CellOutput[]>;
  settings: Settings;
  installStates: Map<string, { packages: string[]; logs: string[]; done: boolean; error?: string }>;
  mode: Mode;
  focusedCellId: string | null;
  onModeChange: (mode: Mode) => void;
  onRunCell: (cellId: string, code: string) => void;
  onRunAndAdvance: (cellId: string, code: string) => void;
  onSourceChange: (cellId: string, source: string) => void;
  onDeleteCell: (cellId: string) => void;
  onClearOutput: (cellId: string) => void;
  onUpdateMarkdown: (cellId: string, source: string) => void;
  isPresenting?: boolean;
  onAddCell: (type: "code" | "markdown") => void;
  onMoveCell: (cellId: string, direction: "up" | "down") => void;
  onRunAllAbove: (cellId: string) => void;
  onRunAllBelow: (cellId: string) => void;
  onInterrupt: () => void;
  onChangeCellType: (type: "code" | "markdown", cellId: string) => void;
  onChangeLanguage?: (cellId: string, language: string) => void;
  onInsertCellAt: (type: "code" | "markdown", position: "above" | "below", targetCellId: string) => void;
  onCutCell: (cellId: string) => void;
  onCopyCell: (cellId: string) => void;
  onPasteCellBelow: (afterCellId: string) => void;
  hasClipboard: boolean;
  onRunAll: () => void;
  onHistoryPush: (entry: any) => void;
  onReorderCell: (cellId: string, toIndex: number) => void;
  onSave: () => void;
  onOpenPalette: () => void;
  onEditorMount?: (cellId: string, editor: any, monaco: any) => void;
  onSelectAcrossCells?: (searchText: string) => void;
  onBlurSave?: (cellId: string) => void;
  execTiming?: Map<string, { startTime: number; endTime?: number; duration?: number }>;
}

function DraggableCell({ cellId, index, children, isPresenting }: {
  cellId: string;
  index: number;
  children: (dragHandleRef: React.RefObject<HTMLDivElement | null>) => React.ReactNode;
  isPresenting?: boolean;
}) {
  const cellRef = useRef<HTMLDivElement>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null);

  useEffect(() => {
    const el = cellRef.current;
    const handle = dragHandleRef.current;
    if (!el || !handle || isPresenting) return;

    const cleanupDrag = draggable({
      element: el,
      dragHandle: handle,
      getInitialData: () => ({ cellId, index }),
      onGenerateDragPreview: ({ nativeSetDragImage }) => {
        setCustomNativeDragPreview({
          nativeSetDragImage,
          render({ container }) {
            const preview = document.createElement("div");
            preview.style.cssText = "padding:8px 16px;background:var(--bg-surface,#fdfcfa);border:1px solid var(--border-subtle,#e8e2d9);border-radius:8px;font-size:13px;color:var(--text-secondary,#6b6560);box-shadow:0 4px 12px rgba(0,0,0,0.12);font-family:Inter,sans-serif;white-space:nowrap;";
            preview.textContent = "Moving cell...";
            container.appendChild(preview);
          },
        });
      },
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false),
    });

    const cleanupDrop = dropTargetForElements({
      element: el,
      getData: ({ input, element }) =>
        attachClosestEdge({ cellId, index }, { input, element, allowedEdges: ["top", "bottom"] }),
      onDragEnter: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
      onDrag: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
      onDragLeave: () => setClosestEdge(null),
      onDrop: () => setClosestEdge(null),
    });

    return () => { cleanupDrag(); cleanupDrop(); };
  }, [cellId, index, isPresenting]);

  return (
    <div
      ref={cellRef}
      className={`draggable-cell ${isDragging ? "dragging" : ""}`}
      style={{ position: "relative" }}
    >
      {closestEdge === "top" && <div className="drop-indicator drop-indicator-top" />}
      {children(dragHandleRef)}
      {closestEdge === "bottom" && <div className="drop-indicator drop-indicator-bottom" />}
    </div>
  );
}

export function NotebookView({
  cells, busyCells, liveOutputs, settings, installStates,
  mode, focusedCellId, isPresenting, onModeChange,
  onRunCell, onRunAndAdvance, onSourceChange, onDeleteCell, onClearOutput, onUpdateMarkdown, onAddCell, onMoveCell,
  onRunAllAbove, onRunAllBelow, onInterrupt, onChangeCellType, onChangeLanguage,
  onInsertCellAt, onCutCell, onCopyCell, onPasteCellBelow, hasClipboard, onRunAll, onHistoryPush, onReorderCell,
  onSave, onOpenPalette, onEditorMount, onSelectAcrossCells, onBlurSave, execTiming,
}: Props) {
  const notebookRef = useRef<HTMLDivElement>(null);
  const [foldedCells, setFoldedCells] = useState<Set<string>>(new Set());

  const toggleFold = useCallback((cellId: string) => {
    setFoldedCells((prev) => {
      const next = new Set(prev);
      if (next.has(cellId)) next.delete(cellId);
      else next.add(cellId);
      return next;
    });
  }, []);

  useEffect(() => {
    return monitorForElements({
      onDrop({ source, location }) {
        const target = location.current.dropTargets[0];
        if (!target) return;
        const sourceId = source.data.cellId as string;
        const targetId = target.data.cellId as string;
        if (sourceId === targetId) return;

        const edge = extractClosestEdge(target.data);
        const sourceIndex = cells.findIndex((c) => c.id === sourceId);
        const targetIndex = cells.findIndex((c) => c.id === targetId);
        if (sourceIndex === -1 || targetIndex === -1) return;

        let newIndex = edge === "top" ? targetIndex : targetIndex + 1;
        // Adjust if moving down (source removal shifts indices)
        if (sourceIndex < newIndex) newIndex--;
        if (sourceIndex !== newIndex) {
          onReorderCell(sourceId, newIndex);
        }
      },
    });
  }, [cells, onReorderCell]);

  // Auto-scroll when dragging near edges of the notebook container
  useEffect(() => {
    const el = notebookRef.current;
    if (!el || isPresenting) return;

    return autoScrollForElements({
      element: el,
      getConfiguration: () => ({
        maxScrollSpeed: "fast",
      }),
    });
  }, [isPresenting]);

  return (
    <div ref={notebookRef} className={`notebook ${isPresenting ? "presentation-mode" : ""}`}>
      {cells.map((cell, idx) => (
        <div key={cell.id} className={`cell-wrapper ${foldedCells.has(cell.id) ? "cell-folded" : ""}`} data-type={cell.cell_type}>
          {cell.cell_type === "code" && (
            <>
              <span className={`cell-exec-count ${busyCells.has(cell.id) ? "cell-exec-busy" : ""}`}>
                {busyCells.has(cell.id) ? "[*]" : cell.execution_count ? `[${cell.execution_count}]` : "[ ]"}
              </span>
              {(() => {
                const timing = execTiming?.get(cell.id);
                const isBusy = busyCells.has(cell.id);
                if (isBusy && timing?.startTime) {
                  return <LiveTimer startTime={timing.startTime} />;
                }
                if (!timing?.duration) return null;
                const ms = timing.duration;
                const label = ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}m`;
                return <span className="cell-exec-time" title={`Finished ${new Date(timing.endTime!).toLocaleTimeString()}`}>{label}</span>;
              })()}
            </>
          )}
          <DraggableCell cellId={cell.id} index={idx} isPresenting={isPresenting}>
          {(dragHandleRef) =>
            <div>
              {cell.cell_type === "code" ? (
                <CodeCell
                  cell={cell}
                  busy={busyCells.has(cell.id)}
                  liveOutputs={liveOutputs.get(cell.id) || []}
                  theme={settings.appearance.theme}
                  fontSize={settings.editor.fontSize}
                  tabSize={settings.editor.tabSize}
                  wordWrap={settings.editor.wordWrap}
                  installing={installStates.get(cell.id)}
                  isCommandFocused={mode === "command" && focusedCellId === cell.id}
                  isPresenting={isPresenting}
                  performanceMode={settings.execution?.performanceMode}
                  dragHandleRef={dragHandleRef}
                  onModeChange={isPresenting ? () => {} : onModeChange}
                  onRun={isPresenting ? () => {} : onRunCell}
                  onRunAndAdvance={isPresenting ? () => {} : onRunAndAdvance}
                  onSourceChange={isPresenting ? () => {} : onSourceChange}
                  onDelete={isPresenting ? () => {} : onDeleteCell}
                  onClear={isPresenting ? () => {} : onClearOutput}
                  onMoveUp={isPresenting ? undefined : idx > 0 ? () => onMoveCell(cell.id, "up") : undefined}
                  onMoveDown={isPresenting ? undefined : idx < cells.length - 1 ? () => onMoveCell(cell.id, "down") : undefined}
                  onRunAllAbove={isPresenting ? () => {} : () => onRunAllAbove(cell.id)}
                  onRunAllBelow={isPresenting ? () => {} : () => onRunAllBelow(cell.id)}
                  onInterrupt={isPresenting ? () => {} : onInterrupt}
                  onChangeType={isPresenting ? () => {} : () => onChangeCellType("markdown", cell.id)}
                  onChangeLanguage={isPresenting ? undefined : onChangeLanguage}
                  onHistoryPush={onHistoryPush}
                  onRunAll={isPresenting ? () => {} : onRunAll}
                  onSave={onSave}
                  onOpenPalette={onOpenPalette}
                  onCut={isPresenting ? () => {} : () => onCutCell(cell.id)}
                  onCopy={() => onCopyCell(cell.id)}
                  onPasteBelow={isPresenting ? () => {} : () => onPasteCellBelow(cell.id)}
                  hasClipboard={hasClipboard}
                  onInsertAbove={isPresenting ? () => {} : (type) => onInsertCellAt(type, "above", cell.id)}
                  onInsertBelow={isPresenting ? () => {} : (type) => onInsertCellAt(type, "below", cell.id)}
                  onEditorMount={onEditorMount}
                  onSelectAcrossCells={onSelectAcrossCells}
                  onBlurSave={onBlurSave}
                  isFolded={foldedCells.has(cell.id)}
                  onToggleFold={toggleFold}
                />
              ) : (
                <MarkdownCell
                  cell={cell}
                  isPresenting={isPresenting}
                  isCommandFocused={mode === "command" && focusedCellId === cell.id}
                  dragHandleRef={dragHandleRef}
                  onUpdate={isPresenting ? () => {} : onUpdateMarkdown}
                  onDelete={isPresenting ? () => {} : onDeleteCell}
                  onMoveUp={isPresenting ? undefined : idx > 0 ? () => onMoveCell(cell.id, "up") : undefined}
                  onMoveDown={isPresenting ? undefined : idx < cells.length - 1 ? () => onMoveCell(cell.id, "down") : undefined}
                  onChangeType={isPresenting ? () => {} : () => onChangeCellType("code", cell.id)}
                  onCopy={() => onCopyCell(cell.id)}
                  onInsertBelow={isPresenting ? () => {} : (type) => onInsertCellAt(type, "below", cell.id)}
                />
              )}
            </div>
          }
        </DraggableCell>
        </div>
      ))}
      {!isPresenting && (
        <>
          <div className="add-cell-bar">
            <button onClick={() => onAddCell("code")}><i className="bi bi-code-slash" /> Code</button>
            <button onClick={() => onAddCell("markdown")}><i className="bi bi-markdown" /> Markdown</button>
          </div>
          <div className="shortcut-hint">Shift+Enter to run &amp; advance / Ctrl+Enter to run</div>
        </>
      )}
    </div>
  );
}
