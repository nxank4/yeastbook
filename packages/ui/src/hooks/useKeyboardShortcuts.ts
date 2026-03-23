import { useEffect, useRef } from "react";

export type Mode = "command" | "edit";

interface ShortcutHandlers {
  cells: { id: string; cell_type: string }[];
  focusedCellId: string | null;
  busyCells: Set<string>;
  mode: Mode;
  isPresenting?: boolean;
  onSetMode: (mode: Mode) => void;
  onAddCellAbove: () => void;
  onAddCellBelow: () => void;
  onDeleteCell: () => void;
  onChangeCellType: (type: "code" | "markdown") => void;
  onFocusPrev: () => void;
  onFocusNext: () => void;
  onEnterEdit: () => void;
  onRunCell: () => void;
  onSave: () => void;
  onOpenPalette: () => void;
  onTogglePresentation: () => void;
  onInterrupt: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleFileExplorer: () => void;
  onFocusCell: (cellId: string) => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const lastDPress = useRef(0);
  const lastIPress = useRef(0);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const h = handlersRef.current;

      // Global shortcuts (both modes)
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        h.onSave();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        h.onOpenPalette();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "e" || e.key === "E")) {
        e.preventDefault();
        h.onTogglePresentation();
        return;
      }

      // Presentation mode: block all other shortcuts
      if (h.isPresenting) return;

      if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B") && !e.shiftKey) {
        e.preventDefault();
        h.onToggleFileExplorer();
        return;
      }

      // Undo/redo — only in command mode (edit mode: Monaco handles its own undo)
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey && h.mode === "command") {
        e.preventDefault();
        h.onUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && e.key === "z")) && h.mode === "command") {
        e.preventDefault();
        h.onRedo();
        return;
      }

      // Only command mode shortcuts below
      if (h.mode !== "command") return;

      // Ignore if in input/textarea/select
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      switch (e.key) {
        case "a": e.preventDefault(); h.onAddCellAbove(); break;
        case "b": e.preventDefault(); h.onAddCellBelow(); break;
        case "d": {
          const now = Date.now();
          if (now - lastDPress.current < 500) {
            e.preventDefault(); h.onDeleteCell(); lastDPress.current = 0;
          } else {
            lastDPress.current = now;
          }
          break;
        }
        case "i": {
          const now = Date.now();
          if (now - lastIPress.current < 500) {
            e.preventDefault(); h.onInterrupt(); lastIPress.current = 0;
          } else {
            lastIPress.current = now;
          }
          break;
        }
        case "m": e.preventDefault(); h.onChangeCellType("markdown"); break;
        case "y": e.preventDefault(); h.onChangeCellType("code"); break;
        case "ArrowUp": case "k": e.preventDefault(); h.onFocusPrev(); break;
        case "ArrowDown": case "j": e.preventDefault(); h.onFocusNext(); break;
        case "Enter":
          if (e.ctrlKey || e.metaKey || e.shiftKey) { e.preventDefault(); h.onRunCell(); }
          else { e.preventDefault(); h.onEnterEdit(); }
          break;
      }
    };

    // Shift+Tab in capturing phase — must fire before Monaco intercepts it
    const handleShiftTab = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.key !== "Tab" || e.ctrlKey || e.metaKey) return;
      const h = handlersRef.current;
      const busyId = h.cells.find((c) => h.busyCells.has(c.id))?.id;
      if (busyId) {
        e.preventDefault();
        e.stopPropagation();
        const el = document.getElementById(`cell-${busyId}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          h.onFocusCell(busyId);
        }
      }
    };

    document.addEventListener("keydown", handleShiftTab, true); // capturing
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleShiftTab, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
}
