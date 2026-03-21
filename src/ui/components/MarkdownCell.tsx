import { useState, useRef, useEffect, useCallback } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

import type { Cell } from "../types.ts";

interface Props {
  cell: Cell;
  onUpdate: (cellId: string, source: string) => void;
  onDelete: (cellId: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export function MarkdownCell({ cell, onUpdate, onDelete, onMoveUp, onMoveDown }: Props) {
  const source = cell.source.join("\n");
  const [editing, setEditing] = useState(!source.trim());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  // Content is sanitized via DOMPurify before being set as HTML
  const sanitizedHtml = source.trim()
    ? DOMPurify.sanitize(marked.parse(source) as string)
    : "";

  return (
    <div className="cell" id={`cell-${cell.id}`}>
      <div className="cell-header">
        <span className="exec-count" />
        <span className="cell-type">markdown</span>
        <div className="cell-actions">
          {onMoveUp && <button onClick={() => onMoveUp()} title="Move up"><i className="bi bi-chevron-up" /></button>}
          {onMoveDown && <button onClick={() => onMoveDown()} title="Move down"><i className="bi bi-chevron-down" /></button>}
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
          onClick={() => setEditing(true)}
          dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
        />
      )}
    </div>
  );
}
