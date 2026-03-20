import { useState, useRef, useEffect, useCallback } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

import type { Cell } from "../types.ts";

interface Props {
  cell: Cell;
  onUpdate: (cellId: string, source: string) => void;
  onDelete: (cellId: string) => void;
}

export function MarkdownCell({ cell, onUpdate, onDelete }: Props) {
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

  const handleBlur = () => {
    const val = textareaRef.current?.value || "";
    onUpdate(cell.id, val);
    if (val.trim()) setEditing(false);
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
          <button onClick={() => onDelete(cell.id)}>Delete</button>
        </div>
      </div>
      {editing ? (
        <div className="code-area">
          <textarea
            ref={textareaRef}
            defaultValue={source}
            placeholder="Markdown..."
            onInput={autoResize}
            onBlur={handleBlur}
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
