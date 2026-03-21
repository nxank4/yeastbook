import { useState, useEffect } from "react";

interface NotebookEntry {
  name: string;
  path: string;
  size: number;
  modified: string;
}

interface RecentEntry {
  path: string;
  lastOpened: string;
}

interface Props {
  onOpen: (path: string) => void;
  onNew: () => void;
}

export function Dashboard({ onOpen, onNew }: Props) {
  const [files, setFiles] = useState<NotebookEntry[]>([]);
  const [recents, setRecents] = useState<RecentEntry[]>([]);

  useEffect(() => {
    fetch("/api/dashboard/files").then((r) => r.json()).then((d) => setFiles(d.files || []));
    fetch("/api/dashboard/recents").then((r) => r.json()).then((d) => setRecents(d.recents || []));
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1 className="dashboard-title">Yeastbook</h1>
        <button className="toolbar-btn" onClick={onNew}>
          <i className="bi bi-plus-lg" /> New Notebook
        </button>
      </div>

      {recents.length > 0 && (
        <section>
          <h2 className="dashboard-section-title">Recent Notebooks</h2>
          <div className="notebook-grid">
            {recents.map((r) => (
              <button key={r.path} className="notebook-card" onClick={() => onOpen(r.path)}>
                <div className="notebook-card-name">{r.path.split("/").pop()}</div>
                <div className="notebook-card-meta">Opened {formatDate(r.lastOpened)}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="dashboard-section-title">Current Directory</h2>
        {files.length === 0 ? (
          <div className="dashboard-empty">No notebooks found. Create one to get started.</div>
        ) : (
          <div className="notebook-grid">
            {files.map((f) => (
              <button key={f.path} className="notebook-card" onClick={() => onOpen(f.path)}>
                <div className="notebook-card-name">{f.name}</div>
                <div className="notebook-card-meta">{formatSize(f.size)} &middot; {formatDate(f.modified)}</div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
