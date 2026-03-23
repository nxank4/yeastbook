import { useRef, useEffect, useCallback, useState } from "react";
import Editor, { type OnMount, type BeforeMount } from "@monaco-editor/react";
import { CellOutput } from "./CellOutput.tsx";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu.tsx";
import type { Cell, CellOutput as CellOutputType } from "@yeastbook/core";

interface Props {
  cell: Cell;
  busy: boolean;
  liveOutputs: CellOutputType[];
  theme: "light" | "dark";
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  installing?: { packages: string[]; logs: string[]; done: boolean; error?: string };
  isCommandFocused?: boolean;
  isPresenting?: boolean;
  onModeChange?: (mode: "command" | "edit") => void;
  onRun: (cellId: string, code: string) => void;
  onRunAndAdvance: (cellId: string, code: string) => void;
  onSourceChange: (cellId: string, source: string) => void;
  onDelete: (cellId: string) => void;
  onClear: (cellId: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRunAllAbove?: () => void;
  onRunAllBelow?: () => void;
  onInterrupt?: () => void;
  onChangeType?: () => void;
  onRunAll?: () => void;
  onCut?: () => void;
  onCopy?: () => void;
  onPasteBelow?: () => void;
  hasClipboard?: boolean;
  onInsertAbove?: (type: "code" | "markdown") => void;
  onInsertBelow?: (type: "code" | "markdown") => void;
  onHistoryPush?: (entry: any) => void;
  dragHandleRef?: React.RefObject<HTMLDivElement | null>;
  onSave?: () => void;
  onOpenPalette?: () => void;
}

export function CodeCell({
  cell, busy, liveOutputs, theme, fontSize, tabSize, wordWrap,
  installing, isCommandFocused, isPresenting, onModeChange, onRun, onRunAndAdvance, onSourceChange, onDelete, onClear, onMoveUp, onMoveDown,
  onRunAllAbove, onRunAllBelow, onInterrupt, onChangeType,
  onRunAll, onCut, onCopy, onPasteBelow, hasClipboard, onInsertAbove, onInsertBelow, onHistoryPush, dragHandleRef,
  onSave, onOpenPalette,
}: Props) {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const [editorHeight, setEditorHeight] = useState(60);
  const [aiPromptOpen, setAiPromptOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; zone: "cell" | "output" } | null>(null);
  const sourceRef = useRef(cell.source.join("\n"));
  const historyBeforeRef = useRef(cell.source.join("\n"));
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs for callbacks to avoid stale closures in Monaco commands
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
  const onRunAndAdvanceRef = useRef(onRunAndAdvance);
  onRunAndAdvanceRef.current = onRunAndAdvance;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onOpenPaletteRef = useRef(onOpenPalette);
  onOpenPaletteRef.current = onOpenPalette;

  const updateHeight = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);
    const lineCount = editor.getModel()?.getLineCount() ?? 1;
    const height = Math.max(lineHeight * lineCount + 20, 60);
    setEditorHeight(height);
  }, []);

  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    // Disable TS/JS semantic validation to prevent "Could not find source file: inmemory://model/N"
    // The TS worker tries to resolve all models cross-editor, which fails with multiple editors
    const diagOpts = {
      noSemanticValidation: true,
      noSyntaxValidation: false,
      noSuggestionDiagnostics: true,
    };
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(diagOpts);
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(diagOpts);

    const compilerOpts = {
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
    };
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions(compilerOpts);
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions(compilerOpts);

    // Disable eager model sync — prevents the worker from scanning all inmemory models
    monaco.languages.typescript.typescriptDefaults.setEagerModelSync(false);
    monaco.languages.typescript.javascriptDefaults.setEagerModelSync(false);
  }, []);

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Load Bun type definitions
    fetch("/api/types/bun")
      .then((r) => r.text())
      .then((dts) => {
        if (dts) {
          monaco.languages.typescript.typescriptDefaults.addExtraLib(
            dts, "file:///node_modules/@types/bun/index.d.ts"
          );
        }
      })
      .catch(() => {});

    // Register shortcuts via capturing DOM listener — fires BEFORE Monaco processes events.
    // This avoids conflicts with Monaco's built-in Shift+Enter, Ctrl+Enter, Escape etc.
    const domNode = editor.getDomNode();
    if (domNode) {
      domNode.addEventListener("keydown", (e: KeyboardEvent) => {
        // Shift+Enter → run and advance
        if (e.shiftKey && e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
          e.stopImmediatePropagation();
          e.preventDefault();
          onRunAndAdvanceRef.current(cell.id, sourceRef.current);
          return;
        }
        // Ctrl/Cmd+Enter → run and stay
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.stopImmediatePropagation();
          e.preventDefault();
          onRunRef.current(cell.id, sourceRef.current);
          return;
        }
        // Ctrl/Cmd+S → save
        if ((e.ctrlKey || e.metaKey) && e.key === "s") {
          e.stopImmediatePropagation();
          e.preventDefault();
          onSaveRef.current?.();
          return;
        }
        // Ctrl/Cmd+Shift+P → command palette
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "p" || e.key === "P")) {
          e.stopImmediatePropagation();
          e.preventDefault();
          onOpenPaletteRef.current?.();
          return;
        }
        // Escape → exit to command mode (only when no Monaco overlay is open)
        if (e.key === "Escape" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
          // Let Monaco close its own overlays (suggestions, etc.) first
          // If no overlay, blur and enter command mode
          const suggestVisible = domNode.querySelector(".suggest-widget.visible, .editor-widget.visible");
          if (!suggestVisible) {
            e.stopImmediatePropagation();
            e.preventDefault();
            (editor.getDomNode()?.ownerDocument?.activeElement as HTMLElement)?.blur();
            onModeChange?.("command");
          }
        }
      }, true); // true = capturing phase
    }

    // Mode change on focus/blur — toggle scroll passthrough
    editor.onDidFocusEditorText(() => {
      onModeChange?.("edit");
      editor.updateOptions({ scrollbar: { vertical: "auto", horizontal: "auto", handleMouseWheel: true } });
    });
    editor.onDidBlurEditorText(() => {
      onModeChange?.("command");
      editor.updateOptions({ scrollbar: { vertical: "hidden", horizontal: "auto", handleMouseWheel: false } });
      // Flush pending history on blur
      if (historyTimerRef.current) {
        clearTimeout(historyTimerRef.current);
        historyTimerRef.current = null;
        const before = historyBeforeRef.current;
        const after = sourceRef.current;
        if (before !== after) {
          onHistoryPush?.({ type: "source_change", cellId: cell.id, before, after });
          historyBeforeRef.current = after;
        }
      }
    });

    // Auto-resize + notify parent of source changes
    editor.onDidChangeModelContent(() => {
      sourceRef.current = editor.getValue();
      onSourceChange(cell.id, sourceRef.current);
      updateHeight();
      // Debounced history push for source changes
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
      historyTimerRef.current = setTimeout(() => {
        const before = historyBeforeRef.current;
        const after = sourceRef.current;
        if (before !== after) {
          onHistoryPush?.({ type: "source_change", cellId: cell.id, before, after });
          historyBeforeRef.current = after;
        }
      }, 500);
    });
    updateHeight();
  }, [cell.id, onSourceChange, updateHeight]);

  useEffect(() => { updateHeight(); }, [updateHeight]);


  const handleAiGenerate = useCallback(async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt, context: [], mode: "generate" }),
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let code = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            try {
              const parsed = JSON.parse(line.slice(6));
              if (parsed.text) {
                code += parsed.text;
                editorRef.current?.setValue(code);
              }
            } catch {}
          }
        }
      }
      sourceRef.current = code;
      onSourceChange(cell.id, code);
    } catch (e) {
      console.error("AI generation failed:", e);
    } finally {
      setAiLoading(false);
      setAiPromptOpen(false);
      setAiPrompt("");
    }
  }, [aiPrompt, cell.id, onSourceChange]);

  const displayOutputs = liveOutputs.length > 0 ? liveOutputs : cell.outputs;

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Auto-detect zone from click target
    const target = e.target as HTMLElement;
    const zone: "cell" | "output" = target.closest(".output-section") ? "output" : "cell";
    setCtxMenu({ x: e.clientX, y: e.clientY, zone });
  }, []);

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

  const copyInputAndOutput = useCallback(() => {
    const input = sourceRef.current;
    const output = displayOutputs.map((o: any) => o.text?.join?.("") || o.data?.["text/plain"] || o.evalue || "").filter(Boolean).join("\n");
    const combined = output ? `${input}\n\n--- Output ---\n${output}` : input;
    navigator.clipboard.writeText(combined);
  }, [displayOutputs]);

  const buildCtxItems = useCallback((): ContextMenuItem[] => {
    if (ctxMenu?.zone === "output") {
      return [
        { id: "copy-output", label: "Copy Output Text", icon: "bi bi-clipboard", onClick: () => {
          const text = displayOutputs.map((o: any) => o.text?.join?.("") || o.data?.["text/plain"] || "").join("\n");
          navigator.clipboard.writeText(text);
        }},
        { id: "copy-both", label: "Copy Input + Output", icon: "bi bi-clipboard2-plus", onClick: copyInputAndOutput },
        { id: "clear-output", label: "Clear Output", icon: "bi bi-eraser", onClick: () => onClear(cell.id) },
        { id: "sep1", label: "", separator: true },
        { id: "native", label: "Show Native Menu", icon: "bi bi-window", onClick: showNativeMenu },
      ];
    }
    return [
      { id: "run", label: "Run Cell", icon: "bi bi-play-fill", shortcut: "Shift+Enter", onClick: () => onRun(cell.id, sourceRef.current) },
      { id: "run-all", label: "Run All Cells", icon: "bi bi-fast-forward-fill", onClick: onRunAll },
      { id: "sep1", label: "", separator: true },
      { id: "cut", label: "Cut Cell", icon: "bi bi-scissors", onClick: onCut },
      { id: "copy", label: "Copy Cell", icon: "bi bi-clipboard", onClick: onCopy },
      { id: "copy-both", label: "Copy Input + Output", icon: "bi bi-clipboard2-plus", onClick: copyInputAndOutput },
      { id: "paste", label: "Paste Cell Below", icon: "bi bi-clipboard-check", onClick: onPasteBelow, disabled: !hasClipboard },
      { id: "sep2", label: "", separator: true },
      { id: "move-up", label: "Move Up", icon: "bi bi-arrow-up", onClick: onMoveUp, disabled: !onMoveUp },
      { id: "move-down", label: "Move Down", icon: "bi bi-arrow-down", onClick: onMoveDown, disabled: !onMoveDown },
      { id: "sep3", label: "", separator: true },
      { id: "add-code-above", label: "Add Code Cell Above", icon: "bi bi-plus-square", onClick: () => onInsertAbove?.("code") },
      { id: "add-code-below", label: "Add Code Cell Below", icon: "bi bi-plus-square", onClick: () => onInsertBelow?.("code") },
      { id: "add-md-below", label: "Add Markdown Below", icon: "bi bi-markdown", onClick: () => onInsertBelow?.("markdown") },
      { id: "sep4", label: "", separator: true },
      { id: "clear", label: "Clear Output", icon: "bi bi-eraser", onClick: () => onClear(cell.id) },
      { id: "delete", label: "Delete Cell", icon: "bi bi-trash3", danger: true, onClick: () => onDelete(cell.id) },
      { id: "sep5", label: "", separator: true },
      { id: "ai", label: "Ask AI", icon: "bi bi-stars", onClick: () => setAiPromptOpen(true) },
      { id: "sep6", label: "", separator: true },
      { id: "native", label: "Show Native Menu", icon: "bi bi-window", onClick: showNativeMenu },
    ];
  }, [ctxMenu, cell.id, displayOutputs, onRun, onRunAll, onCut, onCopy, onPasteBelow, hasClipboard, onMoveUp, onMoveDown, onInsertAbove, onInsertBelow, onClear, onDelete, showNativeMenu]);

  return (
    <div className={`cell code-cell ${isCommandFocused ? "command-focused" : ""}`} id={`cell-${cell.id}`} onContextMenu={handleContextMenu}>
      <div className="cell-header">
        <div ref={dragHandleRef} className="cell-drag-handle" title="Drag to reorder"><i className="bi bi-grip-vertical" /></div>
        <button className="cell-type cell-type-toggle" onClick={(e) => { e.stopPropagation(); onChangeType?.(); }} title="Switch to markdown (M)">code</button>
        <div className="cell-actions">
          {onMoveUp && <button onClick={(e) => { e.stopPropagation(); onMoveUp(); }} title="Move up"><i className="bi bi-arrow-up" /></button>}
          {onMoveDown && <button onClick={(e) => { e.stopPropagation(); onMoveDown(); }} title="Move down"><i className="bi bi-arrow-down" /></button>}
          <button className={`run-btn ${busy ? "stop" : ""}`} onClick={(e) => { e.stopPropagation(); busy ? onInterrupt?.() : onRun(cell.id, sourceRef.current); }} title={busy ? "Stop execution" : "Run cell"}>
            <i className={busy ? "bi bi-stop-fill" : "bi bi-play-fill"} />
          </button>
          <button className="run-btn" onClick={(e) => { e.stopPropagation(); onRunAllBelow?.(); }} title="Run all from here">
            <i className="bi bi-skip-end-fill" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); setAiPromptOpen(!aiPromptOpen); }} title="Ask AI"><i className="bi bi-stars" /></button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(cell.id); }} title="Delete cell"><i className="bi bi-trash3" /></button>
        </div>
      </div>
      {aiPromptOpen && (
        <div className="ai-prompt-bar">
          <input
            type="text"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder="What should this code do?"
            className="ai-prompt-input"
            onKeyDown={(e) => { if (e.key === "Enter") handleAiGenerate(); if (e.key === "Escape") setAiPromptOpen(false); }}
          />
          <button onClick={handleAiGenerate} disabled={aiLoading} className="ai-generate-btn">
            {aiLoading ? "Generating..." : "Generate"}
          </button>
          <button onClick={() => setAiPromptOpen(false)} className="ai-cancel-btn">Cancel</button>
        </div>
      )}
      {installing && !installing.done && (
        <div className="install-progress">
          <div className="install-header">
            <span className="busy-indicator" />
            Installing {installing.packages.join(", ")}...
          </div>
          {installing.logs.length > 0 && (
            <pre className="install-logs">{installing.logs.join("")}</pre>
          )}
        </div>
      )}
      {installing?.done && installing.error && (
        <div className="install-error-banner">
          <i className="bi bi-x-circle" /> Install failed: {installing.error}
        </div>
      )}
      {installing?.done && !installing.error && (
        <div className="install-success-banner">
          <i className="bi bi-check-circle" /> Installed {installing.packages.join(", ")}
        </div>
      )}
      <div className="code-area">
        <Editor
          height={editorHeight}
          defaultLanguage="typescript"
          defaultValue={cell.source.join("\n") || ""}
          theme="vs-dark"
          beforeMount={handleBeforeMount}
          onMount={handleEditorMount}
          options={{
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize,
            tabSize,
            wordWrap: wordWrap ? "on" : "off",
            lineNumbers: "on",
            lineNumbersMinChars: 3,
            lineDecorationsWidth: 10,
            glyphMargin: false,
            folding: false,
            renderLineHighlight: "none",
            scrollbar: { vertical: "hidden", horizontal: "auto", handleMouseWheel: false },
            overviewRulerLanes: 0,
            automaticLayout: true,
            padding: { top: 8, bottom: 8 },
            readOnly: isPresenting,
            domReadOnly: isPresenting,
            dragAndDrop: false,
          }}
        />
      </div>
      {displayOutputs.length > 0 && (
        <div className="output-section">
          <div className="output-actions">
            <button onClick={(e) => { e.stopPropagation(); onClear(cell.id); }} title="Clear output"><i className="bi bi-eraser" /></button>
          </div>
          <CellOutput outputs={displayOutputs} />
        </div>
      )}
      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={buildCtxItems()} onClose={() => setCtxMenu(null)} />}
    </div>
  );
}
