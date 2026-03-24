import type { Cell } from "@codepawl/yeastbook-core";

interface Props {
  focusedCellId: string | null;
  cells: Cell[];
  execTiming?: Map<string, { startTime: number; endTime?: number; duration?: number }>;
}

export function CellInspector({ focusedCellId, cells, execTiming }: Props) {
  const cell = focusedCellId ? cells.find((c) => c.id === focusedCellId) : null;

  if (!cell) {
    return (
      <div className="inspector-empty">
        <i className="bi bi-cursor" />
        <p>Select a cell to inspect</p>
      </div>
    );
  }

  const source = cell.source.join("\n");
  const lineCount = cell.source.length;
  const charCount = source.length;
  const language = cell.metadata?.language === "python" ? "Python" : "TypeScript";
  const timing = execTiming?.get(cell.id);
  const outputCount = cell.outputs?.length ?? 0;

  return (
    <div className="inspector-panel">
      <div className="inspector-section">
        <div className="inspector-title">Cell</div>
        <div className="inspector-row">
          <span className="inspector-key">ID</span>
          <span className="inspector-val">{cell.id.slice(0, 8)}</span>
        </div>
        <div className="inspector-row">
          <span className="inspector-key">Type</span>
          <span className="inspector-val">{cell.cell_type}</span>
        </div>
        {cell.cell_type === "code" && (
          <div className="inspector-row">
            <span className="inspector-key">Language</span>
            <span className="inspector-val">{language}</span>
          </div>
        )}
      </div>

      <div className="inspector-section">
        <div className="inspector-title">Source</div>
        <div className="inspector-row">
          <span className="inspector-key">Lines</span>
          <span className="inspector-val">{lineCount}</span>
        </div>
        <div className="inspector-row">
          <span className="inspector-key">Characters</span>
          <span className="inspector-val">{charCount.toLocaleString()}</span>
        </div>
      </div>

      {cell.cell_type === "code" && (
        <div className="inspector-section">
          <div className="inspector-title">Execution</div>
          <div className="inspector-row">
            <span className="inspector-key">Count</span>
            <span className="inspector-val">{cell.execution_count ?? "—"}</span>
          </div>
          {timing?.duration != null && (
            <div className="inspector-row">
              <span className="inspector-key">Duration</span>
              <span className="inspector-val">
                {timing.duration < 1000
                  ? `${timing.duration}ms`
                  : timing.duration < 60000
                  ? `${(timing.duration / 1000).toFixed(2)}s`
                  : `${(timing.duration / 60000).toFixed(1)}m`}
              </span>
            </div>
          )}
          {timing?.endTime && (
            <div className="inspector-row">
              <span className="inspector-key">Finished</span>
              <span className="inspector-val">{new Date(timing.endTime).toLocaleTimeString()}</span>
            </div>
          )}
          <div className="inspector-row">
            <span className="inspector-key">Outputs</span>
            <span className="inspector-val">{outputCount}</span>
          </div>
        </div>
      )}
    </div>
  );
}
