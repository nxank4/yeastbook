// @codepawl/yeastbook-core — shared logic and types
export { transformCellCode } from "./transform.ts";
export { parseMagicCommands } from "./magic.ts";
export type { MagicCommand, CellMagic, ParseResult } from "./magic.ts";
export { detectOutputType } from "./output.ts";
export type { OutputData, ChartConfig } from "./output.ts";
export { loadNotebook, saveNotebook, ybkToIpynb, ipynbToYbk, detectFormat, createEmptyYbk } from "./format.ts";
export type { YbkNotebook, YbkCell, YbkCellOutput, IpynbNotebook, NotebookFormat } from "./format.ts";
export { Notebook } from "./notebook.ts";
export type { YbkPlugin, OutputRendererPlugin } from "./plugins.ts";
export type { Settings, Cell, CellOutput, CellLanguage, PythonEnv, NotebookData, RichOutput, WsIncoming, WsOutgoing, VariableDetails } from "./types.ts";
export { DEFAULT_SETTINGS } from "./types.ts";
export { detectMimeOutput } from "./mime.ts";
export type { MimeOutput } from "./mime.ts";
export { createSlider, createInput, createToggle, createSelect } from "./widgets.ts";
export type { Widget } from "./widgets.ts";
export { notebookToMarkdown, markdownToNotebook, extractOutputs } from "./ybk-md.ts";
