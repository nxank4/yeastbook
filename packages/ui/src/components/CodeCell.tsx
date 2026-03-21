import { useRef, useEffect, useCallback, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { CellOutput } from "./CellOutput.tsx";
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
  onModeChange?: (mode: "command" | "edit") => void;
  onRun: (cellId: string, code: string) => void;
  onRunAndAdvance: (cellId: string, code: string) => void;
  onSourceChange: (cellId: string, source: string) => void;
  onDelete: (cellId: string) => void;
  onClear: (cellId: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export function CodeCell({
  cell, busy, liveOutputs, theme, fontSize, tabSize, wordWrap,
  installing, isCommandFocused, onModeChange, onRun, onRunAndAdvance, onSourceChange, onDelete, onClear, onMoveUp, onMoveDown,
}: Props) {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const [editorHeight, setEditorHeight] = useState(60);
  const [aiPromptOpen, setAiPromptOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const sourceRef = useRef(cell.source.join("\n"));
  // Refs for callbacks to avoid stale closures in Monaco commands
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
  const onRunAndAdvanceRef = useRef(onRunAndAdvance);
  onRunAndAdvanceRef.current = onRunAndAdvance;

  const updateHeight = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);
    const lineCount = editor.getModel()?.getLineCount() ?? 1;
    const height = Math.max(lineHeight * lineCount + 20, 60);
    setEditorHeight(height);
  }, []);

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // TypeScript compiler options
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
    });

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

    // Shift+Enter: run and advance (use refs to avoid stale closures)
    editor.addCommand(
      monaco.KeyMod.Shift | monaco.KeyCode.Enter,
      () => onRunAndAdvanceRef.current(cell.id, sourceRef.current),
    );

    // Ctrl/Cmd+Enter: run and stay
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      () => onRunRef.current(cell.id, sourceRef.current),
    );

    // Escape: exit to command mode
    editor.addCommand(
      monaco.KeyCode.Escape,
      () => {
        (editor.getDomNode()?.ownerDocument?.activeElement as HTMLElement)?.blur();
        onModeChange?.("command");
      },
    );

    // Mode change on focus/blur
    editor.onDidFocusEditorText(() => onModeChange?.("edit"));
    editor.onDidBlurEditorText(() => onModeChange?.("command"));

    // Auto-resize + notify parent of source changes
    editor.onDidChangeModelContent(() => {
      sourceRef.current = editor.getValue();
      onSourceChange(cell.id, sourceRef.current);
      updateHeight();
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

  return (
    <div className={`cell code-cell ${isCommandFocused ? "command-focused" : ""}`} id={`cell-${cell.id}`}>
      <div className="cell-header">
        <span className="exec-count">
          {busy && <span className="busy-indicator" />}
          {cell.execution_count ? `[${cell.execution_count}]` : "[ ]"}
        </span>
        <span className="cell-type">code</span>
        <div className="cell-actions">
          {onMoveUp && <button onClick={(e) => { e.stopPropagation(); onMoveUp(); }} title="Move up"><i className="bi bi-chevron-up" /></button>}
          {onMoveDown && <button onClick={(e) => { e.stopPropagation(); onMoveDown(); }} title="Move down"><i className="bi bi-chevron-down" /></button>}
          <button className="run-btn" onClick={(e) => { e.stopPropagation(); onRun(cell.id, sourceRef.current); }} title="Run cell">
            <i className="bi bi-play-fill" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); setAiPromptOpen(!aiPromptOpen); }} title="Ask AI"><i className="bi bi-stars" /></button>
          <button onClick={(e) => { e.stopPropagation(); onClear(cell.id); }} title="Clear output"><i className="bi bi-eraser" /></button>
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
            scrollbar: { vertical: "hidden", horizontal: "auto" },
            overviewRulerLanes: 0,
            automaticLayout: true,
            padding: { top: 8, bottom: 8 },
          }}
        />
      </div>
      <CellOutput outputs={displayOutputs} />
    </div>
  );
}
