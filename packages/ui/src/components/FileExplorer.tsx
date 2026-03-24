import { useState, useEffect, useCallback, useRef } from "react";
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

function InputDialog({ title, placeholder, onSubmit, onClose }: { title: string; placeholder?: string; onSubmit: (value: string) => void; onClose: () => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 360 }}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="settings-close" onClick={onClose}><i className="bi bi-x-lg" /></button>
        </div>
        <div style={{ padding: "16px 20px" }}>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && value.trim()) onSubmit(value.trim()); if (e.key === "Escape") onClose(); }}
            placeholder={placeholder}
            className="widget-text-input"
            style={{ width: "100%", fontSize: 14, padding: "6px 10px" }}
            autoFocus
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button className="ai-cancel-btn" onClick={onClose}>Cancel</button>
            <button className="ai-generate-btn" onClick={() => value.trim() && onSubmit(value.trim())} disabled={!value.trim()}>Create</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({ message, onConfirm, onClose }: { message: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 360 }}>
        <div className="modal-header">
          <h2>Confirm</h2>
          <button className="settings-close" onClick={onClose}><i className="bi bi-x-lg" /></button>
        </div>
        <div style={{ padding: "16px 20px" }}>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>{message}</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button className="ai-cancel-btn" onClick={onClose}>Cancel</button>
            <button className="dialog-danger-btn" onClick={onConfirm} autoFocus>Delete</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const FILE_ICONS: Record<string, string> = {
  ".ybk": "\u{1F4D3}", ".ipynb": "\u{1F4D3}",
  ".ts": "\u{1F4D8}", ".tsx": "\u{1F4D8}",
  ".js": "\u{1F4D2}", ".jsx": "\u{1F4D2}",
  ".json": "\u{1F4CB}", ".md": "\u{1F4DD}", ".csv": "\u{1F4CA}",
  ".png": "\u{1F5BC}", ".jpg": "\u{1F5BC}", ".jpeg": "\u{1F5BC}", ".svg": "\u{1F5BC}", ".gif": "\u{1F5BC}",
  ".env": "\u{1F512}",
};

function getIcon(node: FileNode): string {
  if (node.type === "directory") return "";
  const ext = node.name.includes(".") ? "." + node.name.split(".").pop()!.toLowerCase() : "";
  return FILE_ICONS[ext] || "\u{1F4C4}";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function FileTreeNode({
  node, depth, selectedPath, expandedDirs, renaming,
  onSelect, onToggle, onContextMenu, onRenameSubmit, onRenameCancel,
}: {
  node: FileNode;
  depth: number;
  selectedPath: string | null;
  expandedDirs: Set<string>;
  renaming: string | null;
  onSelect: (node: FileNode) => void;
  onToggle: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  onRenameSubmit: (oldPath: string, newName: string) => void;
  onRenameCancel: () => void;
}) {
  const isDir = node.type === "directory";
  const isExpanded = expandedDirs.has(node.path);
  const isSelected = selectedPath === node.path;
  const isRenaming = renaming === node.path;
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming && renameRef.current) {
      renameRef.current.focus();
      const dotIdx = node.name.lastIndexOf(".");
      renameRef.current.setSelectionRange(0, dotIdx > 0 ? dotIdx : node.name.length);
    }
  }, [isRenaming, node.name]);

  return (
    <>
      <div
        className={`file-tree-item ${isSelected ? "selected" : ""} ${node.isNotebook ? "notebook-file" : ""}`}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => {
          if (isDir) onToggle(node.path);
          onSelect(node);
        }}
        onContextMenu={(e) => onContextMenu(e, node)}
      >
        <span className="tree-arrow">
          {isDir ? (isExpanded ? "\u25BE" : "\u25B8") : "\u2003"}
        </span>
        <span className="tree-icon">{isDir ? (isExpanded ? "\u{1F4C2}" : "\u{1F4C1}") : getIcon(node)}</span>
        {isRenaming ? (
          <input
            ref={renameRef}
            className="tree-rename-input"
            defaultValue={node.name}
            onBlur={(e) => onRenameSubmit(node.path, e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRenameSubmit(node.path, e.currentTarget.value);
              if (e.key === "Escape") onRenameCancel();
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="tree-name">{node.name}</span>
        )}
        {!isDir && node.size != null && <span className="tree-size">{formatSize(node.size)}</span>}
      </div>
      {isDir && isExpanded && node.children?.map((child) => (
        <FileTreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          expandedDirs={expandedDirs}
          renaming={renaming}
          onSelect={onSelect}
          onToggle={onToggle}
          onContextMenu={onContextMenu}
          onRenameSubmit={onRenameSubmit}
          onRenameCancel={onRenameCancel}
        />
      ))}
    </>
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

  // CSV: render as table
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

  // JSON: formatted
  if (ext === ".json") {
    try {
      const parsed = JSON.parse(content);
      return <pre className="file-preview-code">{JSON.stringify(parsed, null, 2).slice(0, 3000)}</pre>;
    } catch {
      return <pre className="file-preview-code">{content.slice(0, 2000)}</pre>;
    }
  }

  // Default text
  return <pre className="file-preview-code">{content.slice(0, 2000)}</pre>;
}

export function FileExplorer({ onOpenNotebook, onClose, refreshTrigger }: Props) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set([""]));
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const fetchTree = useCallback(() => {
    fetch("/api/files/tree")
      .then((r) => r.json())
      .then((data) => setTree(data.tree || []))
      .catch(() => {});
  }, []);

  useEffect(() => { fetchTree(); }, [fetchTree, refreshTrigger]);

  const handleSelect = useCallback((node: FileNode) => {
    setSelectedPath(node.path);
    if (node.type === "file") {
      if (node.isNotebook) {
        onOpenNotebook(node.path);
      } else {
        setPreviewPath(node.path);
      }
    }
  }, [onOpenNotebook]);

  const handleToggle = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, node: FileNode) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  const apiCall = useCallback(async (url: string, body: object) => {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    fetchTree();
  }, [fetchTree]);

  const handleRenameSubmit = useCallback(async (oldPath: string, newName: string) => {
    setRenaming(null);
    if (!newName.trim()) return;
    const dir = oldPath.includes("/") ? oldPath.substring(0, oldPath.lastIndexOf("/") + 1) : "";
    const newPath = dir + newName.trim();
    if (newPath !== oldPath) {
      await apiCall("/api/files/rename", { oldPath, newPath });
    }
  }, [apiCall]);

  const [deleteDialog, setDeleteDialog] = useState<{ path: string; name: string } | null>(null);
  const [createDialog, setCreateDialog] = useState<{ parentPath: string; type: "file" | "directory" } | null>(null);

  const handleDelete = useCallback((path: string, name: string) => {
    setDeleteDialog({ path, name });
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteDialog) return;
    await apiCall("/api/files/delete", { path: deleteDialog.path });
    if (selectedPath === deleteDialog.path) { setSelectedPath(null); setPreviewPath(null); }
    setDeleteDialog(null);
  }, [apiCall, selectedPath, deleteDialog]);

  const handleCreate = useCallback((parentPath: string, type: "file" | "directory") => {
    setCreateDialog({ parentPath, type });
  }, []);

  const handleCreateSubmit = useCallback(async (name: string) => {
    if (!createDialog) return;
    const path = createDialog.parentPath ? `${createDialog.parentPath}/${name}` : name;
    await apiCall("/api/files/create", { path, type: createDialog.type });
    if (createDialog.type === "directory") {
      setExpandedDirs((prev) => new Set(prev).add(createDialog.parentPath));
    }
    setCreateDialog(null);
  }, [apiCall, createDialog]);

  const handleDuplicate = useCallback(async (path: string) => {
    await apiCall("/api/files/duplicate", { path });
  }, [apiCall]);

  const getContextMenuItems = useCallback((node: FileNode): ContextMenuItem[] => {
    if (node.type === "directory") {
      return [
        { id: "new-file", label: "New File", icon: "bi bi-file-earmark-plus", onClick: () => handleCreate(node.path, "file") },
        { id: "new-folder", label: "New Folder", icon: "bi bi-folder-plus", onClick: () => handleCreate(node.path, "directory") },
        { id: "sep1", label: "", separator: true },
        { id: "rename", label: "Rename", icon: "bi bi-pencil", shortcut: "F2", onClick: () => setRenaming(node.path) },
        { id: "delete", label: "Delete", icon: "bi bi-trash3", shortcut: "Del", danger: true, onClick: () => handleDelete(node.path, node.name) },
        { id: "sep2", label: "", separator: true },
        { id: "refresh", label: "Refresh", icon: "bi bi-arrow-clockwise", onClick: fetchTree },
      ];
    }
    const items: ContextMenuItem[] = [];
    if (node.isNotebook) {
      items.push({ id: "open", label: "Open Notebook", icon: "bi bi-journal-code", onClick: () => onOpenNotebook(node.path) });
      items.push({ id: "sep0", label: "", separator: true });
    }
    items.push(
      { id: "copy-path", label: "Copy Path", icon: "bi bi-clipboard", onClick: () => navigator.clipboard.writeText(node.path) },
      { id: "sep1", label: "", separator: true },
      { id: "rename", label: "Rename", icon: "bi bi-pencil", shortcut: "F2", onClick: () => setRenaming(node.path) },
      { id: "duplicate", label: "Duplicate", icon: "bi bi-copy", onClick: () => handleDuplicate(node.path) },
      { id: "delete", label: "Delete", icon: "bi bi-trash3", shortcut: "Del", danger: true, onClick: () => handleDelete(node.path, node.name) },
      { id: "sep2", label: "", separator: true },
      { id: "new-file", label: "New File Here", icon: "bi bi-file-earmark-plus", onClick: () => {
        const dir = node.path.includes("/") ? node.path.substring(0, node.path.lastIndexOf("/")) : "";
        handleCreate(dir, "file");
      }},
      { id: "new-folder", label: "New Folder Here", icon: "bi bi-folder-plus", onClick: () => {
        const dir = node.path.includes("/") ? node.path.substring(0, node.path.lastIndexOf("/")) : "";
        handleCreate(dir, "directory");
      }},
    );
    return items;
  }, [handleCreate, handleDelete, handleDuplicate, fetchTree, onOpenNotebook]);

  // Keyboard: F2 rename, Del delete
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!selectedPath) return;
      if (renaming) return;
      if (e.key === "F2") {
        e.preventDefault();
        setRenaming(selectedPath);
      }
      if (e.key === "Delete") {
        e.preventDefault();
        const name = selectedPath.includes("/") ? selectedPath.split("/").pop()! : selectedPath;
        handleDelete(selectedPath, name);
      }
    };
    const el = treeRef.current;
    if (el) {
      el.addEventListener("keydown", handler);
      return () => el.removeEventListener("keydown", handler);
    }
  }, [selectedPath, renaming, handleDelete]);

  return (
    <>
      <div className="sidebar-left-header">
        <span className="sidebar-left-title">EXPLORER</span>
        <div style={{ flex: 1 }} />
        <button className="sidebar-left-action" title="New File" onClick={() => handleCreate("", "file")}>
          <i className="bi bi-file-earmark-plus" />
        </button>
        <button className="sidebar-left-action" title="New Folder" onClick={() => handleCreate("", "directory")}>
          <i className="bi bi-folder-plus" />
        </button>
        <button className="sidebar-left-action" title="Refresh" onClick={fetchTree}>
          <i className="bi bi-arrow-clockwise" />
        </button>
        <button className="sidebar-left-action" title="Close (Ctrl+B)" onClick={onClose}>
          <i className="bi bi-x-lg" />
        </button>
      </div>
      <div className="sidebar-left-tree" ref={treeRef} tabIndex={0}>
        {tree.map((node) => (
          <FileTreeNode
            key={node.path}
            node={node}
            depth={0}
            selectedPath={selectedPath}
            expandedDirs={expandedDirs}
            renaming={renaming}
            onSelect={handleSelect}
            onToggle={handleToggle}
            onContextMenu={handleContextMenu}
            onRenameSubmit={handleRenameSubmit}
            onRenameCancel={() => setRenaming(null)}
          />
        ))}
        {tree.length === 0 && <div className="file-tree-empty">No files found</div>}
      </div>
      {showPreview && previewPath && (
        <div className="file-preview">
          <div className="file-preview-header">
            <span>{previewPath.includes("/") ? previewPath.split("/").pop() : previewPath}</span>
            <button className="sidebar-left-action" onClick={() => setShowPreview(false)}>
              <i className="bi bi-x" />
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
