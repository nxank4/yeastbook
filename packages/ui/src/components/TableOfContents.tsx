import type { TocEntry } from "../hooks/useTableOfContents.ts";

interface Props {
  entries: TocEntry[];
  activeCellId: string | null;
  onNavigate: (cellId: string) => void;
}

function TocItem({ entry, activeCellId, onNavigate }: { entry: TocEntry; activeCellId: string | null; onNavigate: (cellId: string) => void }) {
  const isActive = entry.cellId === activeCellId;
  return (
    <>
      <button
        className={`toc-entry ${isActive ? "toc-active" : ""}`}
        style={{ paddingLeft: 12 + (entry.level - 1) * 16 }}
        onClick={() => onNavigate(entry.cellId)}
        title={entry.text}
      >
        <span className="toc-text">{entry.text}</span>
      </button>
      {entry.children.map((child, i) => (
        <TocItem key={`${child.cellId}-${i}`} entry={child} activeCellId={activeCellId} onNavigate={onNavigate} />
      ))}
    </>
  );
}

export function TableOfContents({ entries, activeCellId, onNavigate }: Props) {
  if (entries.length === 0) {
    return (
      <div className="toc-empty">
        <i className="bi bi-list-nested" style={{ fontSize: 24, opacity: 0.3, display: "block", marginBottom: 8 }} />
        No headings found.<br />
        Add <code># Heading</code> to a markdown cell.
      </div>
    );
  }

  return (
    <div className="toc-list">
      {entries.map((entry, i) => (
        <TocItem key={`${entry.cellId}-${i}`} entry={entry} activeCellId={activeCellId} onNavigate={onNavigate} />
      ))}
    </div>
  );
}
