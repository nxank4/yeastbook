import { useState, useMemo, useCallback } from "react";

interface Props {
  columns: string[];
  data: Record<string, unknown>[];
  shape?: [number, number];
}

const PAGE_SIZE = 25;

export function DataFrameViewer({ columns, data, shape }: Props) {
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    if (!filter) return data;
    const lower = filter.toLowerCase();
    return data.filter((row) =>
      columns.some((col) => String(row[col] ?? "").toLowerCase().includes(lower))
    );
  }, [data, columns, filter]);

  const sorted = useMemo(() => {
    if (!sortCol) return filtered;
    return [...filtered].sort((a, b) => {
      const va = a[sortCol] ?? "";
      const vb = b[sortCol] ?? "";
      if (typeof va === "number" && typeof vb === "number") return sortAsc ? va - vb : vb - va;
      return sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
  }, [filtered, sortCol, sortAsc]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageData = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleSort = useCallback((col: string) => {
    if (sortCol === col) setSortAsc((p) => !p);
    else { setSortCol(col); setSortAsc(true); }
  }, [sortCol]);

  const colType = useCallback((col: string) => {
    const sample = data.find((r) => r[col] != null)?.[col];
    if (typeof sample === "number") return "num";
    if (typeof sample === "boolean") return "bool";
    return "str";
  }, [data]);

  return (
    <div className="dataframe-viewer">
      <div className="dataframe-toolbar">
        <input
          type="text"
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setPage(0); }}
          placeholder="Filter rows..."
          className="dataframe-filter"
        />
        <span className="dataframe-info">
          {shape ? `${shape[0]} rows x ${shape[1]} cols` : `${data.length} rows`}
          {filter && ` (${filtered.length} shown)`}
        </span>
      </div>
      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th className="dataframe-index">#</th>
              {columns.map((col) => (
                <th key={col} onClick={() => handleSort(col)}>
                  <span className="dataframe-col-name">{col}</span>
                  <span className={`dataframe-col-type type-${colType(col)}`}>{colType(col)}</span>
                  {sortCol === col && <span className="sort-indicator">{sortAsc ? " ▲" : " ▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageData.map((row, i) => (
              <tr key={page * PAGE_SIZE + i}>
                <td className="dataframe-index">{page * PAGE_SIZE + i}</td>
                {columns.map((col) => (
                  <td key={col}>{row[col] === null || row[col] === undefined ? <span className="dataframe-null">null</span> : String(row[col])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="dataframe-pagination">
          <button disabled={page === 0} onClick={() => setPage(0)}>&#171;</button>
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>&#8249;</button>
          <span>{page + 1} / {totalPages}</span>
          <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>&#8250;</button>
          <button disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>&#187;</button>
        </div>
      )}
    </div>
  );
}
