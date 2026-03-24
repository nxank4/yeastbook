import { useState, useCallback, useRef, useEffect } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  editorRefs: React.MutableRefObject<Map<string, { editor: any; monaco: any }>>;
  onSourceChange: (cellId: string, source: string) => void;
}

export function FindReplace({ open, onClose, editorRefs, onSourceChange }: Props) {
  const [search, setSearch] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const findMatches = useCallback(() => {
    if (!search) { setMatchCount(0); return []; }
    const allMatches: { cellId: string; editor: any; matches: any[] }[] = [];
    let total = 0;
    for (const [cellId, { editor }] of editorRefs.current) {
      const model = editor.getModel();
      if (!model) continue;
      const matches = model.findMatches(search, true, useRegex, caseSensitive, null, true);
      if (matches.length > 0) {
        allMatches.push({ cellId, editor, matches });
        total += matches.length;
      }
    }
    setMatchCount(total);
    return allMatches;
  }, [search, caseSensitive, useRegex, editorRefs]);

  // Highlight matches on search change
  useEffect(() => {
    findMatches();
  }, [findMatches]);

  const handleReplaceAll = useCallback(() => {
    const allMatches = findMatches();
    for (const { cellId, editor, matches } of allMatches) {
      const model = editor.getModel();
      if (!model) continue;
      const edits = matches.map((m: any) => ({
        range: m.range,
        text: replace,
      }));
      model.pushEditOperations([], edits, () => null);
      onSourceChange(cellId, model.getValue());
    }
    findMatches();
  }, [findMatches, replace, onSourceChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "Enter" && e.shiftKey) handleReplaceAll();
  }, [onClose, handleReplaceAll]);

  if (!open) return null;

  return (
    <div className="find-replace-bar" onKeyDown={handleKeyDown}>
      <div className="find-replace-inputs">
        <div className="find-replace-row">
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find"
            className="find-replace-input"
          />
          <span className="find-replace-count">{matchCount} {matchCount === 1 ? "match" : "matches"}</span>
        </div>
        <div className="find-replace-row">
          <input
            type="text"
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
            placeholder="Replace"
            className="find-replace-input"
          />
          <button className="find-replace-btn" onClick={handleReplaceAll} title="Replace all (Shift+Enter)">
            Replace All
          </button>
        </div>
      </div>
      <div className="find-replace-options">
        <label className="find-replace-option">
          <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
          Aa
        </label>
        <label className="find-replace-option">
          <input type="checkbox" checked={useRegex} onChange={(e) => setUseRegex(e.target.checked)} />
          .*
        </label>
        <button className="find-replace-close" onClick={onClose}><i className="bi bi-x-lg" /></button>
      </div>
    </div>
  );
}
