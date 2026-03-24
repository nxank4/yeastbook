import { useState, useMemo, useCallback } from "react";

interface Props {
  rows: Record<string, unknown>[];
  performanceMode?: boolean;
}

const PAGE_SIZE = 100;
const PERF_PAGE_SIZE = 25;

export function DataTable({ rows, performanceMode }: Props) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const columns = useMemo(() => {
    if (rows.length === 0) return [];
    return Object.keys(rows[0]!);
  }, [rows]);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (va === vb) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = va < vb ? -1 : 1;
      return sortAsc ? cmp : -cmp;
    });
  }, [rows, sortKey, sortAsc]);

  const pageSize = performanceMode ? PERF_PAGE_SIZE : PAGE_SIZE;
  const displayed = showAll ? sorted : sorted.slice(0, pageSize);

  const handleSort = useCallback((key: string) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortAsc((a) => !a);
        return key;
      }
      setSortAsc(true);
      return key;
    });
  }, []);

  if (rows.length === 0) return <div className="output-result">Empty array</div>;

  return (
    <div className="data-table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col} onClick={() => handleSort(col)}>
                {col}
                {sortKey === col && (
                  <span className="sort-indicator">{sortAsc ? " \u25B4" : " \u25BE"}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayed.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td key={col}>{formatCell(row[col])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!showAll && rows.length > pageSize && !performanceMode && (
        <button className="show-more-btn" onClick={() => setShowAll(true)}>
          Show all {rows.length} rows
        </button>
      )}
      {!showAll && rows.length > pageSize && performanceMode && (
        <div className="show-more-btn" style={{ opacity: 0.5 }}>
          Showing {pageSize} of {rows.length} rows (Performance Mode)
        </div>
      )}
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
