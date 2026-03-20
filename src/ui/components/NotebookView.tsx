import { CodeCell } from "./CodeCell.tsx";
import { MarkdownCell } from "./MarkdownCell.tsx";
import type { Cell, CellOutput } from "../types.ts";

interface Props {
  cells: Cell[];
  busyCells: Set<string>;
  liveOutputs: Map<string, CellOutput[]>;
  onRunCell: (cellId: string, code: string) => void;
  onDeleteCell: (cellId: string) => void;
  onClearOutput: (cellId: string) => void;
  onUpdateMarkdown: (cellId: string, source: string) => void;
  onAddCell: (type: "code" | "markdown") => void;
}

export function NotebookView({
  cells, busyCells, liveOutputs,
  onRunCell, onDeleteCell, onClearOutput, onUpdateMarkdown, onAddCell,
}: Props) {
  return (
    <div className="notebook">
      {cells.map((cell) =>
        cell.cell_type === "code" ? (
          <CodeCell
            key={cell.id}
            cell={cell}
            busy={busyCells.has(cell.id)}
            liveOutputs={liveOutputs.get(cell.id) || []}
            onRun={onRunCell}
            onDelete={onDeleteCell}
            onClear={onClearOutput}
          />
        ) : (
          <MarkdownCell
            key={cell.id}
            cell={cell}
            onUpdate={onUpdateMarkdown}
            onDelete={onDeleteCell}
          />
        )
      )}
      <div className="add-cell-bar">
        <button onClick={() => onAddCell("code")}>+ Code</button>
        <button onClick={() => onAddCell("markdown")}>+ Markdown</button>
      </div>
    </div>
  );
}
