import { useState, useRef, useEffect, useCallback } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu.tsx";

import type { Cell } from "@yeastbook/core";

interface Props {
  cell: Cell;
  isPresenting?: boolean;
  onUpdate: (cellId: string, source: string) => void;
  onDelete: (cellId: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onChangeType?: () => void;
  onCopy?: () => void;
  onInsertBelow?: (type: "code" | "markdown") => void;
  dragHandleRef?: React.RefObject<HTMLDivElement | null>;
}

export function MarkdownCell({ cell, isPresenting, onUpdate, onDelete, onMoveUp, onMoveDown, onChangeType, onCopy, onInsertBelow, dragHandleRef }: Props) {
  const source = cell.source.join("\n");
  const [editing, setEditing] = useState(!source.trim());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    }
  }, []);

  useEffect(() => {
    if (editing) {
      autoResize();
      textareaRef.current?.focus();
    }
  }, [editing, autoResize]);

  const renderMarkdown = () => {
    const val = textareaRef.current?.value || "";
    onUpdate(cell.id, val);
    if (val.trim()) setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      renderMarkdown();
    }
  };

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (isPresenting) return;
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }, [isPresenting]);

  const showNativeMenu = useCallback(() => {
    if (!ctxMenu) return;
    const { x, y } = ctxMenu;
    setCtxMenu(null);
    requestAnimationFrame(() => {
      const el = document.elementFromPoint(x, y);
      if (el) {
        el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      }
    });
  }, [ctxMenu]);

  const buildCtxItems = useCallback((): ContextMenuItem[] => [
    { id: "render", label: editing ? "Render Markdown" : "Edit Markdown", icon: editing ? "bi bi-eye" : "bi bi-pencil", onClick: () => editing ? renderMarkdown() : setEditing(true) },
    { id: "sep1", label: "", separator: true },
    { id: "copy", label: "Copy Cell", icon: "bi bi-clipboard", onClick: onCopy },
    { id: "move-up", label: "Move Up", icon: "bi bi-arrow-up", onClick: onMoveUp, disabled: !onMoveUp },
    { id: "move-down", label: "Move Down", icon: "bi bi-arrow-down", onClick: onMoveDown, disabled: !onMoveDown },
    { id: "sep2", label: "", separator: true },
    { id: "add-code", label: "Add Code Cell Below", icon: "bi bi-plus-square", onClick: () => onInsertBelow?.("code") },
    { id: "add-md", label: "Add Markdown Below", icon: "bi bi-markdown", onClick: () => onInsertBelow?.("markdown") },
    { id: "sep3", label: "", separator: true },
    { id: "delete", label: "Delete Cell", icon: "bi bi-trash3", danger: true, onClick: () => onDelete(cell.id) },
    { id: "sep4", label: "", separator: true },
    { id: "native", label: "Show Native Menu", icon: "bi bi-window", onClick: showNativeMenu },
  ], [editing, onCopy, onMoveUp, onMoveDown, onInsertBelow, onDelete, cell.id, showNativeMenu]);

  // Content is sanitized via DOMPurify before being set as innerHTML
  const sanitizedHtml = source.trim()
    ? DOMPurify.sanitize(marked.parse(source) as string)
    : "";

  return (
    <div className="cell" id={`cell-${cell.id}`} onContextMenu={handleContextMenu}>
      <div className="cell-header">
        <div ref={dragHandleRef} className="cell-drag-handle" title="Drag to reorder"><i className="bi bi-grip-vertical" /></div>
        <button className="cell-type cell-type-toggle" onClick={(e) => { e.stopPropagation(); onChangeType?.(); }} title="Switch to code (Y)">markdown</button>
        <div className="cell-actions">
          {onMoveUp && <button onClick={() => onMoveUp()} title="Move up"><i className="bi bi-arrow-up" /></button>}
          {onMoveDown && <button onClick={() => onMoveDown()} title="Move down"><i className="bi bi-arrow-down" /></button>}
          {editing && (
            <button className="run-btn" onClick={renderMarkdown} title="Render markdown"><i className="bi bi-play-fill" /></button>
          )}
          <button onClick={() => onDelete(cell.id)} title="Delete cell"><i className="bi bi-trash3" /></button>
        </div>
      </div>
      {editing ? (
        <div className="code-area">
          <textarea
            ref={textareaRef}
            defaultValue={source}
            placeholder="Markdown..."
            onInput={autoResize}
            onKeyDown={handleKeyDown}
          />
        </div>
      ) : (
        <div
          className="markdown-rendered"
          onDoubleClick={() => !isPresenting && setEditing(true)}
          dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
        />
      )}
      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={buildCtxItems()} onClose={() => setCtxMenu(null)} />}
    </div>
  );
}
