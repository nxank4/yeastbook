import { useState, useEffect, useCallback, useRef } from "react";
import {
  Folder, FolderOpen, File, FileCode2, FileJson, FileText, FileCode,
  BookOpen, Lock, Image, ArrowUp, Plus, FolderPlus, RefreshCw, X,
} from "lucide-react";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu.tsx";

interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
  size?: number;
  isNotebook?: boolean;
}

interface Props {
  onOpenNotebook: (path: string) => void;
  onClose: () => void;
  refreshTrigger: number;
}

// --- Icon helpers ---

function getFileIcon(name: string, isNotebook?: boolean) {
  if (isNotebook) return <BookOpen size={14} className="fe-icon fe-icon-notebook" />;
  const ext = name.includes(".") ? "." + name.split(".").pop()!.toLowerCase() : "";
  switch (ext) {
    case ".ts": case ".tsx": return <FileCode2 size={14} className="fe-icon fe-icon-ts" />;
    case ".js": case ".jsx": return <FileCode2 size={14} className="fe-icon fe-icon-js" />;
    case ".json": return <FileJson size={14} className="fe-icon fe-icon-json" />;
    case ".md": return <FileText size={14} className="fe-icon fe-icon-md" />;
    case ".css": case ".scss": return <FileCode size={14} className="fe-icon fe-icon-css" />;
    case ".env": return <Lock size={14} className="fe-icon fe-icon-env" />;
    case ".png": case ".jpg": case ".jpeg": case ".svg": case ".gif": case ".webp":
      return <Image size={14} className="fe-icon fe-icon-img" />;
    default: return <File size={14} className="fe-icon" />;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// --- Sub-components (dialogs, preview) ---

function InputDialog({ title, placeholder, onSubmit, onClose }: { title: string; placeholder?: string; onSubmit: (value: string) => void; onClose: () => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="settings-close" onClick={onClose}><i className="bi bi-x-lg" /></button>
        </div>
        <div className="dialog-body">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && value.trim()) onSubmit(value.trim()); if (e.key === "Escape") onClose(); }}
            placeholder={placeholder}
            className="dialog-input"
            autoFocus
          />
        </div>
        <div className="dialog-actions">
          <button className="dialog-btn dialog-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="dialog-btn dialog-btn-primary" onClick={() => value.trim() && onSubmit(value.trim())} disabled={!value.trim()}>Create</button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({ message, onConfirm, onClose }: { message: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <div className="modal-header">
          <h2>Confirm</h2>
          <button className="settings-close" onClick={onClose}><i className="bi bi-x-lg" /></button>
        </div>
        <div className="dialog-body">
          <div className="dialog-icon dialog-icon-danger">
            <i className="bi bi-exclamation-triangle-fill" />
            <p>{message}</p>
          </div>
        </div>
        <div className="dialog-actions">
          <button className="dialog-btn dialog-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="dialog-btn dialog-btn-danger" onClick={onConfirm} autoFocus>Delete</button>
        </div>
      </div>
    </div>
  );
}

function FilePreview({ path }: { path: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [tooLarge, setTooLarge] = useState(false);

  useEffect(() => {
    setContent(null);
    setTooLarge(false);
    fetch(`/api/files/read?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.tooLarge) { setTooLarge(true); return; }
        setContent(data.content);
      })
      .catch(() => setContent(null));
  }, [path]);

  if (tooLarge) return <div className="file-preview-content"><em>File too large to preview</em></div>;
  if (content === null) return <div className="file-preview-content"><em>Loading...</em></div>;

  const ext = path.includes(".") ? "." + path.split(".").pop()!.toLowerCase() : "";

  if (ext === ".csv") {
    const lines = content.split("\n").filter(Boolean).slice(0, 21);
    const rows = lines.map((l) => l.split(","));
    return (
      <div className="file-preview-content" style={{ overflow: "auto" }}>
        <table className="file-preview-table">
          <thead><tr>{rows[0]?.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>{rows.slice(1).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }

  if (ext === ".json") {
    try {
      const parsed = JSON.parse(content);
      return <pre className="file-preview-code">{JSON.stringify(parsed, null, 2).slice(0, 3000)}</pre>;
    } catch {
      return <pre className="file-preview-code">{content.slice(0, 2000)}</pre>;
    }
  }

  return <pre className="file-preview-code">{content.slice(0, 2000)}</pre>;
}

// --- Breadcrumbs ---

function Breadcrumbs({ currentPath, onNavigate }: { currentPath: string; onNavigate: (path: string) => void }) {
  const segments = currentPath ? currentPath.split("/") : [];
  const isRoot = segments.length === 0;

  // Build breadcrumb items with ellipsis for deep paths
  let displaySegments: { label: string; path: string; isEllipsis?: boolean }[] = [];
  if (segments.length <= 4) {
    let acc = "";
    displaySegments = segments.map((seg, i) => {
      acc = i === 0 ? seg : acc + "/" + seg;
      return { label: seg, path: acc };
    });
  } else {
    // Show first + ... + last 2
    displaySegments = [
      { label: segments[0], path: segments[0] },
      { label: "...", path: "", isEllipsis: true },
      { label: segments[segments.length - 2], path: segments.slice(0, -1).join("/") },
      { label: segments[segments.length - 1], path: segments.join("/") },
    ];
  }

  const parentPath = segments.length > 1 ? segments.slice(0, -1).join("/") : "";

  return (
    <div className="fe-breadcrumbs">
      <button
        className="fe-breadcrumb-up"
        onClick={() => onNavigate(parentPath)}
        disabled={isRoot}
        title="Go up"
      >
        <ArrowUp size={13} />
      </button>
      <button className="fe-breadcrumb-seg fe-breadcrumb-root" onClick={() => onNavigate("")}>
        root
      </button>
      {displaySegments.map((seg, i) => (
        <span key={i}>
          <span className="fe-breadcrumb-sep">/</span>
          {seg.isEllipsis ? (
            <span className="fe-breadcrumb-ellipsis">...</span>
          ) : (
            <button
              className={`fe-breadcrumb-seg ${i === displaySegments.length - 1 ? "fe-breadcrumb-current" : ""}`}
              onClick={() => onNavigate(seg.path)}
            >
              {seg.label}
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

// --- Main component ---

export function FileExplorer({ onOpenNotebook, onClose, refreshTrigger }: Props) {
  const [items, setItems] = useState<FileNode[]>([]);
  const [currentPath, setCurrentPath] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{ path: string; name: string } | null>(null);
  const [createDialog, setCreateDialog] = useState<{ parentPath: string; type: "file" | "directory" } | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const notifyTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const notify = useCallback((msg: string) => {
    setNotification(msg);
    if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current);
    notifyTimerRef.current = setTimeout(() => setNotification(null), 2000);
  }, []);

  const fetchItems = useCallback((path: string) => {
    fetch(`/api/files/list?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((data) => setItems(data.items || []))
      .catch(() => setItems([]));
  }, []);

  useEffect(() => { fetchItems(currentPath); }, [fetchItems, currentPath, refreshTrigger]);

  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path);
    setSelectedPath(null);
    setPreviewPath(null);
  }, []);

  const handleSelect = useCallback((node: FileNode) => {
    setSelectedPath(node.path);
    if (node.type === "file" && !node.isNotebook) {
      setPreviewPath(node.path);
    }
  }, []);

  const handleOpen = useCallback((node: FileNode) => {
    if (node.type === "directory") {
      navigateTo(node.path);
    } else if (node.isNotebook) {
      onOpenNotebook(node.path);
    }
  }, [navigateTo, onOpenNotebook]);

  const handleContextMenu = useCallback((e: React.MouseEvent, node: FileNode) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  const apiCall = useCallback(async (url: string, body: object) => {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    fetchItems(currentPath);
  }, [fetchItems, currentPath]);

  const handleRenameSubmit = useCallback(async (oldPath: string, newName: string) => {
    setRenaming(null);
    if (!newName.trim()) return;
    const dir = oldPath.includes("/") ? oldPath.substring(0, oldPath.lastIndexOf("/") + 1) : "";
    const newPath = dir + newName.trim();
    if (newPath !== oldPath) {
      await apiCall("/api/files/rename", { oldPath, newPath });
      notify(`Renamed to ${newName.trim()}`);
    }
  }, [apiCall, notify]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteDialog) return;
    await apiCall("/api/files/delete", { path: deleteDialog.path });
    if (selectedPath === deleteDialog.path) { setSelectedPath(null); setPreviewPath(null); }
    notify(`Deleted ${deleteDialog.name}`);
    setDeleteDialog(null);
  }, [apiCall, selectedPath, deleteDialog, notify]);

  const handleCreateSubmit = useCallback(async (name: string) => {
    if (!createDialog) return;
    const path = createDialog.parentPath ? `${createDialog.parentPath}/${name}` : name;
    await apiCall("/api/files/create", { path, type: createDialog.type });
    notify(`Created ${name}`);
    setCreateDialog(null);
  }, [apiCall, createDialog, notify]);

  const handleDuplicate = useCallback(async (path: string) => {
    await apiCall("/api/files/duplicate", { path });
    const name = path.includes("/") ? path.split("/").pop()! : path;
    notify(`Duplicated ${name}`);
  }, [apiCall, notify]);

  const getContextMenuItems = useCallback((node: FileNode): ContextMenuItem[] => {
    if (node.type === "directory") {
      return [
        { id: "open", label: "Open Folder", icon: "bi bi-folder2-open", onClick: () => navigateTo(node.path) },
        { id: "sep0", label: "", separator: true },
        { id: "new-file", label: "New File", icon: "bi bi-file-earmark-plus", onClick: () => setCreateDialog({ parentPath: node.path, type: "file" }) },
        { id: "new-folder", label: "New Folder", icon: "bi bi-folder-plus", onClick: () => setCreateDialog({ parentPath: node.path, type: "directory" }) },
        { id: "sep1", label: "", separator: true },
        { id: "rename", label: "Rename", icon: "bi bi-pencil", shortcut: "F2", onClick: () => setRenaming(node.path) },
        { id: "delete", label: "Delete", icon: "bi bi-trash3", shortcut: "Del", danger: true, onClick: () => setDeleteDialog({ path: node.path, name: node.name }) },
      ];
    }
    const ctxItems: ContextMenuItem[] = [];
    if (node.isNotebook) {
      ctxItems.push({ id: "open", label: "Open Notebook", icon: "bi bi-journal-code", onClick: () => onOpenNotebook(node.path) });
      ctxItems.push({ id: "sep0", label: "", separator: true });
    }
    ctxItems.push(
      { id: "copy-path", label: "Copy Path", icon: "bi bi-clipboard", onClick: () => navigator.clipboard.writeText(node.path) },
      { id: "sep1", label: "", separator: true },
      { id: "rename", label: "Rename", icon: "bi bi-pencil", shortcut: "F2", onClick: () => setRenaming(node.path) },
      { id: "duplicate", label: "Duplicate", icon: "bi bi-copy", onClick: () => handleDuplicate(node.path) },
      { id: "delete", label: "Delete", icon: "bi bi-trash3", shortcut: "Del", danger: true, onClick: () => setDeleteDialog({ path: node.path, name: node.name }) },
    );
    return ctxItems;
  }, [navigateTo, onOpenNotebook, handleDuplicate]);

  // Keyboard: F2 rename, Del delete
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!selectedPath || renaming) return;
      if (e.key === "F2") {
        e.preventDefault();
        setRenaming(selectedPath);
      }
      if (e.key === "Delete") {
        e.preventDefault();
        const name = selectedPath.includes("/") ? selectedPath.split("/").pop()! : selectedPath;
        setDeleteDialog({ path: selectedPath, name });
      }
    };
    const el = containerRef.current;
    if (el) {
      el.addEventListener("keydown", handler);
      return () => el.removeEventListener("keydown", handler);
    }
  }, [selectedPath, renaming]);

  // Focus rename input
  useEffect(() => {
    if (renaming && renameRef.current) {
      renameRef.current.focus();
      const name = renaming.includes("/") ? renaming.split("/").pop()! : renaming;
      const dotIdx = name.lastIndexOf(".");
      renameRef.current.setSelectionRange(0, dotIdx > 0 ? dotIdx : name.length);
    }
  }, [renaming]);

  return (
    <>
      <div className="sidebar-left-header">
        <span className="sidebar-left-title">EXPLORER</span>
        <div style={{ flex: 1 }} />
        <button className="sidebar-left-action" title="New File" onClick={() => setCreateDialog({ parentPath: currentPath, type: "file" })}>
          <Plus size={13} />
        </button>
        <button className="sidebar-left-action" title="New Folder" onClick={() => setCreateDialog({ parentPath: currentPath, type: "directory" })}>
          <FolderPlus size={13} />
        </button>
        <button className="sidebar-left-action" title="Refresh" onClick={() => fetchItems(currentPath)}>
          <RefreshCw size={13} />
        </button>
        <button className="sidebar-left-action" title="Close (Ctrl+B)" onClick={onClose}>
          <X size={13} />
        </button>
      </div>

      <Breadcrumbs currentPath={currentPath} onNavigate={navigateTo} />

      {notification && (
        <div className="fe-notification">
          <i className="bi bi-check-circle-fill" /> {notification}
        </div>
      )}

      <div className="fe-list-container" ref={containerRef} tabIndex={0}>
        {items.length > 0 ? items.map((node) => {
          const isDir = node.type === "directory";
          const isSelected = selectedPath === node.path;
          const isRenaming = renaming === node.path;
          return (
            <div
              key={node.path}
              className={`fe-row ${isSelected ? "fe-row-selected" : ""} ${node.isNotebook ? "fe-row-notebook" : ""}`}
              onClick={() => !isRenaming && handleSelect(node)}
              onDoubleClick={() => !isRenaming && handleOpen(node)}
              onContextMenu={(e) => handleContextMenu(e, node)}
            >
              <span className="fe-row-icon">
                {isDir ? <Folder size={14} className="fe-icon fe-icon-folder" /> : getFileIcon(node.name, node.isNotebook)}
              </span>
              {isRenaming ? (
                <input
                  ref={renameRef}
                  className="fe-rename-input"
                  defaultValue={node.name}
                  onBlur={(e) => handleRenameSubmit(node.path, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameSubmit(node.path, e.currentTarget.value);
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="fe-row-name">{node.name}</span>
              )}
              {!isDir && node.size != null && <span className="fe-row-size">{formatSize(node.size)}</span>}
            </div>
          );
        }) : (
          <div className="fe-empty">No files found</div>
        )}
      </div>

      {showPreview && previewPath && (
        <div className="file-preview">
          <div className="file-preview-header">
            <span>{previewPath.includes("/") ? previewPath.split("/").pop() : previewPath}</span>
            <button className="sidebar-left-action" onClick={() => setShowPreview(false)}>
              <X size={13} />
            </button>
          </div>
          <FilePreview path={previewPath} />
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextMenuItems(contextMenu.node)}
          onClose={() => setContextMenu(null)}
        />
      )}
      {createDialog && (
        <InputDialog
          title={`New ${createDialog.type === "directory" ? "Folder" : "File"}`}
          placeholder={createDialog.type === "directory" ? "folder-name" : "filename.ts"}
          onSubmit={handleCreateSubmit}
          onClose={() => setCreateDialog(null)}
        />
      )}
      {deleteDialog && (
        <ConfirmDialog
          message={`Are you sure you want to delete "${deleteDialog.name}"? This cannot be undone.`}
          onConfirm={handleDeleteConfirm}
          onClose={() => setDeleteDialog(null)}
        />
      )}
    </>
  );
}
