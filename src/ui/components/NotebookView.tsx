import { CodeCell } from "./CodeCell.tsx";
import { MarkdownCell } from "./MarkdownCell.tsx";
import type { Cell, CellOutput } from "../types.ts";

interface Props {
  cells: Cell[];
  busyCells: Set<string>;
  liveOutputs: Map<string, CellOutput[]>;
  onRunCell: (cellId: string, code: string) => void;
  onRunAndAdvance: (cellId: string, code: string) => void;
  onDeleteCell: (cellId: string) => void;
  onClearOutput: (cellId: string) => void;
  onUpdateMarkdown: (cellId: string, source: string) => void;
  onAddCell: (type: "code" | "markdown") => void;
  onMoveCell: (cellId: string, direction: "up" | "down") => void;
}

export function NotebookView({
  cells, busyCells, liveOutputs,
  onRunCell, onRunAndAdvance, onDeleteCell, onClearOutput, onUpdateMarkdown, onAddCell, onMoveCell,
}: Props) {
  return (
    <div className="notebook">
      {cells.map((cell, idx) =>
        cell.cell_type === "code" ? (
          <CodeCell
            key={cell.id}
            cell={cell}
            busy={busyCells.has(cell.id)}
            liveOutputs={liveOutputs.get(cell.id) || []}
            onRun={onRunCell}
            onRunAndAdvance={onRunAndAdvance}
            onDelete={onDeleteCell}
            onClear={onClearOutput}
            onMoveUp={idx > 0 ? () => onMoveCell(cell.id, "up") : undefined}
            onMoveDown={idx < cells.length - 1 ? () => onMoveCell(cell.id, "down") : undefined}
          />
        ) : (
          <MarkdownCell
            key={cell.id}
            cell={cell}
            onUpdate={onUpdateMarkdown}
            onDelete={onDeleteCell}
            onMoveUp={idx > 0 ? () => onMoveCell(cell.id, "up") : undefined}
            onMoveDown={idx < cells.length - 1 ? () => onMoveCell(cell.id, "down") : undefined}
          />
        )
      )}
      <div className="add-cell-bar">
        <button onClick={() => onAddCell("code")}><i className="bi bi-code-slash" /> Code</button>
        <button onClick={() => onAddCell("markdown")}><i className="bi bi-markdown" /> Markdown</button>
      </div>
      <div className="shortcut-hint">Shift+Enter to run &amp; advance / Ctrl+Enter to run</div>
    </div>
  );
}
