import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Portal } from "./Portal.tsx";

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}

export function CommandPalette({ open, onClose, commands }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!query) return commands;
    const lower = query.toLowerCase();
    return commands.filter((c) => c.label.toLowerCase().includes(lower));
  }, [query, commands]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => { setSelectedIndex(0); }, [filtered.length]);

  const execute = useCallback((cmd: Command) => {
    cmd.action();
    onClose();
  }, [onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter" && filtered[selectedIndex]) {
      e.preventDefault();
      execute(filtered[selectedIndex]);
    }
  }, [filtered, selectedIndex, execute, onClose]);

  if (!open) return null;

  return (
    <Portal>
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type a command..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="palette-list">
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              className={`palette-item ${i === selectedIndex ? "selected" : ""}`}
              onClick={() => execute(cmd)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span>{cmd.label}</span>
              {cmd.shortcut && <span className="palette-shortcut">{cmd.shortcut}</span>}
            </button>
          ))}
          {filtered.length === 0 && <div className="palette-empty">No matching commands</div>}
        </div>
      </div>
    </div>
    </Portal>
  );
}
