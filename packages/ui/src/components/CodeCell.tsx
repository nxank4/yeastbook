import { useRef, useEffect, useCallback, useState } from "react";
import Editor, { type OnMount, type BeforeMount } from "@monaco-editor/react";
import { CellOutput } from "./CellOutput.tsx";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu.tsx";
import type { Cell, CellOutput as CellOutputType } from "@codepawl/yeastbook-core";

let bunTypesLoaded = false;

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
  onEditorMount?: (cellId: string, editor: any, monaco: any) => void;
  onSelectAcrossCells?: (searchText: string) => void;
  onBlurSave?: (cellId: string) => void;
  isFolded?: boolean;
  onToggleFold?: (cellId: string) => void;
  onChangeLanguage?: (cellId: string, language: string) => void;
}

export function CodeCell({
  cell, busy, liveOutputs, theme, fontSize, tabSize, wordWrap,
  installing, isCommandFocused, isPresenting, onModeChange, onRun, onRunAndAdvance, onSourceChange, onDelete, onClear, onMoveUp, onMoveDown,
  onRunAllAbove, onRunAllBelow, onInterrupt, onChangeType,
  onRunAll, onCut, onCopy, onPasteBelow, hasClipboard, onInsertAbove, onInsertBelow, onHistoryPush, dragHandleRef,
  onSave, onOpenPalette, onEditorMount, onSelectAcrossCells, onBlurSave, isFolded, onToggleFold, onChangeLanguage,
}: Props) {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const [editorHeight, setEditorHeight] = useState(60);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; zone: "cell" | "output" } | null>(null);
  const sourceRef = useRef(cell.source.join("\n"));
  const historyBeforeRef = useRef(cell.source.join("\n"));

  // Detect Python cell from metadata
  const isPythonCell = cell.metadata?.language === "python";
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs for callbacks and cell ID to avoid stale closures in Monaco commands
  const cellIdRef = useRef(cell.id);
  cellIdRef.current = cell.id;
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
  const onRunAndAdvanceRef = useRef(onRunAndAdvance);
  onRunAndAdvanceRef.current = onRunAndAdvance;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onOpenPaletteRef = useRef(onOpenPalette);
  onOpenPaletteRef.current = onOpenPalette;
  const isPresentingRef = useRef(isPresenting);
  isPresentingRef.current = isPresenting;
  const onBlurSaveRef = useRef(onBlurSave);
  onBlurSaveRef.current = onBlurSave;
  const onSelectAcrossCellsRef = useRef(onSelectAcrossCells);
  onSelectAcrossCellsRef.current = onSelectAcrossCells;
  const markerDisposableRef = useRef<any>(null);

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
    const diagOpts = {
      noSemanticValidation: false,
      noSyntaxValidation: false,
      noSuggestionDiagnostics: true,
      diagnosticCodesToIgnore: [1375, 1378, 2300, 2302, 2304, 2307, 2451, 2580, 7044, 2686],
    };
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(diagOpts);
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(diagOpts);

    const compilerOpts = {
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      allowNonTsExtensions: true,
      isolatedModules: true,
      noEmit: true,
    };
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions(compilerOpts);
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions(compilerOpts);

    monaco.languages.typescript.typescriptDefaults.setEagerModelSync(false);
    monaco.languages.typescript.javascriptDefaults.setEagerModelSync(false);

    monaco.editor.defineTheme("yeastbook-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        // Comments — muted warm gray, italic
        { token: "comment", foreground: "5C5A57", fontStyle: "italic" },
        { token: "comment.doc", foreground: "6B6560", fontStyle: "italic" },

        // Keywords & storage — amber accent
        { token: "keyword", foreground: "F59E0B" },
        { token: "keyword.control", foreground: "F59E0B" },
        { token: "keyword.operator", foreground: "F59E0B" },
        { token: "storage", foreground: "F59E0B" },
        { token: "storage.type", foreground: "F59E0B" },

        // Strings — warm sage green
        { token: "string", foreground: "A8C67F" },
        { token: "string.escape", foreground: "C4D9A0" },
        { token: "string.regexp", foreground: "C48A6A" },

        // Numbers & constants — warm peach
        { token: "number", foreground: "E8A86D" },
        { token: "number.hex", foreground: "E8A86D" },
        { token: "constant", foreground: "E8A86D" },
        { token: "constant.language", foreground: "E8A86D" },

        // Types — warm sky blue
        { token: "type", foreground: "7EB8DA" },
        { token: "type.identifier", foreground: "7EB8DA" },
        { token: "support.type", foreground: "7EB8DA" },

        // Functions — golden
        { token: "entity.name.function", foreground: "D4A857" },
        { token: "support.function", foreground: "D4A857" },

        // Variables — warm beige (default)
        { token: "variable", foreground: "E8E4DC" },
        { token: "variable.parameter", foreground: "D4C8B0" },
        { token: "identifier", foreground: "E8E4DC" },

        // Operators & punctuation — secondary gray
        { token: "operator", foreground: "8C8880" },
        { token: "delimiter", foreground: "8C8880" },
        { token: "delimiter.bracket", foreground: "8C8880" },

        // JSX/HTML tags & attributes
        { token: "tag", foreground: "D4A857" },
        { token: "attribute.name", foreground: "7EB8DA" },
        { token: "attribute.value", foreground: "A8C67F" },

        // Misc
        { token: "invalid", foreground: "DC2626" },
      ],
      colors: {
        "editor.background": "#0D0D0C",
        "editor.foreground": "#E8E4DC",
        "editorCursor.foreground": "#F59E0B",

        // Selection — amber tint
        "editor.selectionBackground": "#F59E0B33",
        "editor.inactiveSelectionBackground": "#F59E0B1A",
        "editor.selectionHighlightBackground": "#F59E0B1A",

        // Line highlight
        "editor.lineHighlightBackground": "#1C1C1A",
        "editor.lineHighlightBorder": "#00000000",

        // Line numbers
        "editorLineNumber.foreground": "#5C5A57",
        "editorLineNumber.activeForeground": "#8C8880",

        // Indent guides
        "editorIndentGuide.background": "#2C2A27",
        "editorIndentGuide.activeBackground": "#3A3836",

        // Widgets (autocomplete, hover)
        "editorWidget.background": "#1C1C1A",
        "editorWidget.border": "#2C2A27",
        "editorSuggestWidget.background": "#1C1C1A",
        "editorSuggestWidget.border": "#2C2A27",
        "editorSuggestWidget.selectedBackground": "#F59E0B26",
        "editorSuggestWidget.highlightForeground": "#F59E0B",
        "editorHoverWidget.background": "#1C1C1A",
        "editorHoverWidget.border": "#2C2A27",

        // Find/replace
        "editor.findMatchBackground": "#F59E0B40",
        "editor.findMatchHighlightBackground": "#F59E0B20",

        // Bracket matching — amber
        "editorBracketMatch.background": "#F59E0B26",
        "editorBracketMatch.border": "#F59E0B66",

        // Scrollbar
        "scrollbarSlider.background": "#5C5A5733",
        "scrollbarSlider.hoverBackground": "#5C5A5766",

        // Gutter & ruler
        "editorGutter.background": "#0D0D0C",
        "editorOverviewRuler.border": "#00000000",

        // Errors/warnings
        "editorError.foreground": "#DC2626",
        "editorWarning.foreground": "#F59E0B",
        "editorInfo.foreground": "#7EB8DA",

        // Whitespace
        "editorWhitespace.foreground": "#2C2A27",

        // Input (find bar)
        "input.background": "#141412",
        "input.border": "#2C2A27",
        "focusBorder": "#D97706",

        // List (autocomplete rows)
        "list.hoverBackground": "#F59E0B1A",
        "list.activeSelectionBackground": "#F59E0B26",
        "list.highlightForeground": "#F59E0B",
      },
    });

    monaco.editor.defineTheme("yeastbook-light", {
      base: "vs",
      inherit: true,
      rules: [
        // Comments — muted warm gray, italic
        { token: "comment", foreground: "8C8880", fontStyle: "italic" },
        { token: "comment.doc", foreground: "6B6560", fontStyle: "italic" },

        // Keywords & storage — amber accent (darker for light bg)
        { token: "keyword", foreground: "B45309" },
        { token: "keyword.control", foreground: "B45309" },
        { token: "keyword.operator", foreground: "B45309" },
        { token: "storage", foreground: "B45309" },
        { token: "storage.type", foreground: "B45309" },

        // Strings — dark sage green
        { token: "string", foreground: "4D7C0F" },
        { token: "string.escape", foreground: "65A30D" },
        { token: "string.regexp", foreground: "9A3412" },

        // Numbers & constants — warm brown-orange
        { token: "number", foreground: "C2410C" },
        { token: "number.hex", foreground: "C2410C" },
        { token: "constant", foreground: "C2410C" },
        { token: "constant.language", foreground: "C2410C" },

        // Types — deep blue
        { token: "type", foreground: "1D4ED8" },
        { token: "type.identifier", foreground: "1D4ED8" },
        { token: "support.type", foreground: "1D4ED8" },

        // Functions — dark golden
        { token: "entity.name.function", foreground: "92400E" },
        { token: "support.function", foreground: "92400E" },

        // Variables — dark warm (default text)
        { token: "variable", foreground: "1A1714" },
        { token: "variable.parameter", foreground: "44403C" },
        { token: "identifier", foreground: "1A1714" },

        // Operators & punctuation
        { token: "operator", foreground: "6B6560" },
        { token: "delimiter", foreground: "6B6560" },
        { token: "delimiter.bracket", foreground: "6B6560" },

        // JSX/HTML
        { token: "tag", foreground: "92400E" },
        { token: "attribute.name", foreground: "1D4ED8" },
        { token: "attribute.value", foreground: "4D7C0F" },

        // Misc
        { token: "invalid", foreground: "DC2626" },
      ],
      colors: {
        "editor.background": "#FDFCFA",
        "editor.foreground": "#1A1714",
        "editorCursor.foreground": "#D97706",

        // Selection — amber tint
        "editor.selectionBackground": "#F59E0B33",
        "editor.inactiveSelectionBackground": "#F59E0B1A",
        "editor.selectionHighlightBackground": "#F59E0B1A",

        // Line highlight
        "editor.lineHighlightBackground": "#F7F4EF",
        "editor.lineHighlightBorder": "#00000000",

        // Line numbers
        "editorLineNumber.foreground": "#9C9590",
        "editorLineNumber.activeForeground": "#6B6560",

        // Indent guides
        "editorIndentGuide.background": "#E8E2D9",
        "editorIndentGuide.activeBackground": "#D6CFC5",

        // Widgets (autocomplete, hover)
        "editorWidget.background": "#FDFCFA",
        "editorWidget.border": "#E8E2D9",
        "editorSuggestWidget.background": "#FDFCFA",
        "editorSuggestWidget.border": "#E8E2D9",
        "editorSuggestWidget.selectedBackground": "#F59E0B1A",
        "editorSuggestWidget.highlightForeground": "#B45309",
        "editorHoverWidget.background": "#FDFCFA",
        "editorHoverWidget.border": "#E8E2D9",

        // Find/replace
        "editor.findMatchBackground": "#F59E0B40",
        "editor.findMatchHighlightBackground": "#F59E0B20",

        // Bracket matching — amber
        "editorBracketMatch.background": "#F59E0B26",
        "editorBracketMatch.border": "#D9770666",

        // Scrollbar
        "scrollbarSlider.background": "#9C959033",
        "scrollbarSlider.hoverBackground": "#9C959066",

        // Gutter & ruler
        "editorGutter.background": "#FDFCFA",
        "editorOverviewRuler.border": "#00000000",

        // Errors/warnings
        "editorError.foreground": "#DC2626",
        "editorWarning.foreground": "#D97706",
        "editorInfo.foreground": "#1D4ED8",

        // Whitespace
        "editorWhitespace.foreground": "#E8E2D9",

        // Input (find bar)
        "input.background": "#F7F4EF",
        "input.border": "#E8E2D9",
        "focusBorder": "#D97706",

        // List (autocomplete rows)
        "list.hoverBackground": "#F59E0B1A",
        "list.activeSelectionBackground": "#F59E0B26",
        "list.highlightForeground": "#B45309",
      },
    });
  }, []);

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    onEditorMount?.(cell.id, editor, monaco);

    // Load Bun type definitions with fallback
    const addBunTypes = (dts: string, uri: string) => {
      monaco.languages.typescript.typescriptDefaults.addExtraLib(dts, uri);
      monaco.languages.typescript.javascriptDefaults.addExtraLib(dts, uri);
    };

    if (!bunTypesLoaded) {
      bunTypesLoaded = true;
      fetch("/api/types/bun")
        .then((r) => { if (!r.ok) throw new Error("not found"); return r.text(); })
        .then((dts) => {
          if (dts && dts.length > 100) {
            monaco.languages.typescript.typescriptDefaults.addExtraLib(dts, "file:///node_modules/@types/bun/index.d.ts");
            monaco.languages.typescript.javascriptDefaults.addExtraLib(dts, "file:///node_modules/@types/bun/index.d.ts");
          }
        })
        .catch(() => {});
    }

    // Register shortcuts via capturing DOM listener — fires BEFORE Monaco processes events.
    // This avoids conflicts with Monaco's built-in Shift+Enter, Ctrl+Enter, Escape etc.
    const domNode = editor.getDomNode();
    if (domNode) {
      domNode.addEventListener("keydown", (e: KeyboardEvent) => {
        // Shift+Enter → run and advance
        if (e.shiftKey && e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
          e.stopImmediatePropagation();
          e.preventDefault();
          onRunAndAdvanceRef.current?.(cellIdRef.current, sourceRef.current);
          return;
        }
        // Ctrl/Cmd+Enter → run and stay
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.stopImmediatePropagation();
          e.preventDefault();
          onRunRef.current?.(cellIdRef.current, sourceRef.current);
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
        // Ctrl/Cmd+Shift+D → select across all cells
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "d" || e.key === "D")) {
          e.stopImmediatePropagation();
          e.preventDefault();
          const selection = editor.getSelection();
          const selectedText = selection ? editor.getModel()?.getValueInRange(selection) : "";
          if (selectedText) {
            onSelectAcrossCellsRef.current?.(selectedText);
          }
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

      // Intercept right-click inside Monaco → show yeastbook context menu
      // Hold Shift+Right-Click to bypass and show native browser menu
      domNode.addEventListener("contextmenu", (e: MouseEvent) => {
        if (isPresentingRef.current) return;
        if (e.shiftKey) return; // Let native browser menu show
        e.preventDefault();
        e.stopPropagation();
        setCtxMenu({ x: e.clientX, y: e.clientY, zone: "cell" });
      }, true);
    }

    // Mode change on focus/blur — toggle scroll passthrough
    editor.onDidFocusEditorText(() => {
      onModeChange?.("edit");
      editor.updateOptions({ scrollbar: { vertical: "auto", horizontal: "auto", handleMouseWheel: true } });
    });
    editor.onDidBlurEditorText(() => {
      onModeChange?.("command");
      editor.updateOptions({ scrollbar: { vertical: "hidden", horizontal: "auto", handleMouseWheel: false } });
      // Flush pending save on blur
      onBlurSaveRef.current?.(cell.id);
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
    // Suppress diagnostics on magic command lines (%install, %timeit, etc.)
    markerDisposableRef.current?.dispose();
    markerDisposableRef.current = monaco.editor.onDidChangeMarkers(([uri]: any[]) => {
      const model = editor.getModel();
      if (!model || uri.toString() !== model.uri.toString()) return;
      const markers = monaco.editor.getModelMarkers({ resource: uri });
      const filtered = markers.filter((m: any) => {
        const line = model.getLineContent(m.startLineNumber);
        return !line.trimStart().startsWith("%");
      });
      if (filtered.length !== markers.length) {
        monaco.editor.setModelMarkers(model, "typescript", filtered);
      }
    });

    updateHeight();
  }, [cell.id, onSourceChange, updateHeight]);

  useEffect(() => { updateHeight(); }, [updateHeight]);

  // Dispose Monaco model and marker listener when cell unmounts
  useEffect(() => {
    return () => {
      markerDisposableRef.current?.dispose();
      const monaco = monacoRef.current;
      if (monaco) {
        const modelUri = monaco.Uri.parse(`file:///cell-${cell.id}.ts`);
        const model = monaco.editor.getModel(modelUri);
        model?.dispose();
      }
    };
  }, [cell.id]);


  const displayOutputs = liveOutputs.length > 0 ? liveOutputs : cell.outputs;

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (isPresenting) return;
    if (e.shiftKey) return; // Shift+Right-Click → native browser menu
    e.preventDefault();
    e.stopPropagation();
    const target = e.target as HTMLElement;
    const zone: "cell" | "output" = target.closest(".output-section") ? "output" : "cell";
    setCtxMenu({ x: e.clientX, y: e.clientY, zone });
  }, [isPresenting]);

  const getOutputText = useCallback((outputs: any[]) => {
    return outputs.map((o: any) => {
      if (o.text) return o.text.join("");
      if (o.data?.["text/plain"]) return o.data["text/plain"];
      if (o.output_type === "error") {
        const parts = [o.ename && o.evalue ? `${o.ename}: ${o.evalue}` : o.evalue || ""];
        if (o.traceback?.length) parts.push(o.traceback.join("\n"));
        return parts.filter(Boolean).join("\n");
      }
      return "";
    }).filter(Boolean).join("\n");
  }, []);

  const copyInputAndOutput = useCallback(() => {
    const input = sourceRef.current;
    const output = getOutputText(displayOutputs);
    const combined = output ? `${input}\n\n--- Output ---\n${output}` : input;
    navigator.clipboard.writeText(combined);
  }, [displayOutputs, getOutputText]);

  const buildCtxItems = useCallback((): ContextMenuItem[] => {
    if (ctxMenu?.zone === "output") {
      return [
        { id: "copy-output", label: "Copy Output Text", icon: "bi bi-clipboard", onClick: () => {
          navigator.clipboard.writeText(getOutputText(displayOutputs));
        }},
        { id: "copy-both", label: "Copy Input + Output", icon: "bi bi-clipboard2-plus", onClick: copyInputAndOutput },
        { id: "clear-output", label: "Clear Output", icon: "bi bi-eraser", onClick: () => onClear(cell.id) },
        { id: "sep-hint", label: "", separator: true },
        { id: "hint", label: "Shift+Right-Click for browser menu", hint: true },
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
      { id: "to-markdown", label: "Change to Markdown", icon: "bi bi-markdown", shortcut: "M", onClick: onChangeType },
      { id: "lang-toggle", label: isPythonCell ? "Change to TypeScript" : "Change to Python", icon: isPythonCell ? "bi bi-filetype-tsx" : "bi bi-filetype-py", shortcut: "L", onClick: () => onChangeLanguage?.(cell.id, isPythonCell ? "typescript" : "python") },
      { id: "sep5", label: "", separator: true },
      { id: "clear", label: "Clear Output", icon: "bi bi-eraser", onClick: () => onClear(cell.id) },
      { id: "delete", label: "Delete Cell", icon: "bi bi-trash3", danger: true, onClick: () => onDelete(cell.id) },
      { id: "sep-hint", label: "", separator: true },
      { id: "hint", label: "Shift+Right-Click for browser menu", hint: true },
    ];
  }, [ctxMenu, cell.id, displayOutputs, onRun, onRunAll, onCut, onCopy, onPasteBelow, hasClipboard, onMoveUp, onMoveDown, onInsertAbove, onInsertBelow, onClear, onDelete, onChangeType, onChangeLanguage, isPythonCell]);

  return (
    <div className={`cell code-cell ${isCommandFocused ? "command-focused" : ""}`} id={`cell-${cell.id}`} onContextMenu={handleContextMenu}>
      <div className="cell-header">
        <div ref={dragHandleRef} className="cell-drag-handle" title="Drag to reorder"><i className="bi bi-grip-vertical" /></div>
        <button className="cell-fold-btn" onClick={(e) => { e.stopPropagation(); onToggleFold?.(cell.id); }} title={isFolded ? "Expand cell" : "Collapse cell"}>
          <i className={`bi ${isFolded ? "bi-chevron-right" : "bi-chevron-down"}`} />
        </button>
        <button className="cell-type cell-type-toggle" onClick={(e) => { e.stopPropagation(); onChangeType?.(); }} title="Switch to markdown (M)">code</button>
        <button className={`cell-lang-badge ${isPythonCell ? "cell-lang-python" : "cell-lang-ts"}`} onClick={(e) => { e.stopPropagation(); onChangeLanguage?.(cell.id, isPythonCell ? "typescript" : "python"); }} title={isPythonCell ? "Switch to TypeScript (T)" : "Switch to Python (P)"}>
          <i className={isPythonCell ? "bi bi-filetype-py" : "bi bi-filetype-tsx"} />{isPythonCell ? " Python" : " TypeScript"}
        </button>
        <div className="cell-actions">
          {onMoveUp && <button onClick={(e) => { e.stopPropagation(); onMoveUp(); }} title="Move up"><i className="bi bi-arrow-up" /></button>}
          {onMoveDown && <button onClick={(e) => { e.stopPropagation(); onMoveDown(); }} title="Move down"><i className="bi bi-arrow-down" /></button>}
          <button className={`run-btn ${busy ? "stop" : ""}`} onClick={(e) => { e.stopPropagation(); busy ? onInterrupt?.() : onRun(cell.id, sourceRef.current); }} title={busy ? "Stop execution" : "Run cell"}>
            <i className={busy ? "bi bi-stop-fill" : "bi bi-play-fill"} />
          </button>
          <button className="run-btn" onClick={(e) => { e.stopPropagation(); onRunAllBelow?.(); }} title="Run all from here">
            <i className="bi bi-skip-end-fill" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(cell.id); }} title="Delete cell"><i className="bi bi-trash3" /></button>
        </div>
      </div>
      {isFolded ? (
        <div className="cell-fold-summary" onClick={() => onToggleFold?.(cell.id)}>
          <span className="cell-fold-preview">{(cell.source[0] || "// empty cell").slice(0, 80)}{(cell.source[0]?.length ?? 0) > 80 ? "..." : ""}</span>
          {cell.source.length > 1 && <span className="cell-fold-lines"> ({cell.source.length} lines)</span>}
        </div>
      ) : (
      <div className="code-area">
        <Editor
          height={editorHeight}
          defaultLanguage={isPythonCell ? "python" : "typescript"}
          defaultValue={cell.source.join("\n") || ""}
          path={`cell-${cell.id}.${isPythonCell ? "py" : "ts"}`}
          theme={theme === "dark" ? "yeastbook-dark" : "yeastbook-light"}
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
            contextmenu: false,
            fixedOverflowWidgets: true,
            multiCursorModifier: "alt",
          }}
        />
      </div>
      )}
      {!isFolded && (displayOutputs.length > 0 || installing) && (
        <div className="output-section">
          <div className="output-actions">
            <button onClick={(e) => { e.stopPropagation(); onClear(cell.id); }} title="Clear output"><i className="bi bi-eraser" /></button>
          </div>
          {installing && (
            <div className="output-area">
              {!installing.done && (
                <div className="output-stdout">
                  <div className="loading-bar" />
                  Installing {installing.packages.join(", ")}...
                </div>
              )}
              {installing.logs.length > 0 && (
                <div className="output-stdout">{installing.logs.join("")}</div>
              )}
              {installing.done && !installing.error && (
                <div className="output-stdout">Installed {installing.packages.join(", ")}</div>
              )}
              {installing.done && installing.error && (
                <div className="output-stderr">Install failed: {installing.error}</div>
              )}
            </div>
          )}
          <CellOutput outputs={displayOutputs} />
        </div>
      )}
      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={buildCtxItems()} onClose={() => setCtxMenu(null)} />}
    </div>
  );
}
