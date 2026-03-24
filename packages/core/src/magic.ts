// src/kernel/magic.ts — Parse magic commands from cell code

export type MagicCommand =
  | { type: "install"; packages: string[] }
  | { type: "reload"; modules: string[] }
  | { type: "timeit"; runs: number; code: string }
  | { type: "time"; code: string }
  | { type: "sql_attach"; path: string; alias?: string }
  | { type: "sql_import"; path: string; table?: string }
  | { type: "sql"; query: string; db?: string };

export type CellMagic = { type: "python" };

export interface ParseResult {
  magic: MagicCommand[];
  cleanCode: string;
  cellMagic?: CellMagic;
}

export function parseMagicCommands(code: string): ParseResult {
  const lines = code.split("\n");

  // Check for cell-level magic (must be first non-empty line)
  const firstNonEmptyIdx = lines.findIndex((l) => l.trim().length > 0);
  if (firstNonEmptyIdx !== -1 && lines[firstNonEmptyIdx]!.trim() === "%%python") {
    return {
      magic: [],
      cleanCode: lines.slice(firstNonEmptyIdx + 1).join("\n").trim(),
      cellMagic: { type: "python" },
    };
  }

  const magic: MagicCommand[] = [];
  const cleanLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trimStart();

    if (trimmed.startsWith("%timeit")) {
      const runsMatch = trimmed.match(/^%timeit\s+-n(\d+)\s+(.+)$/);
      if (runsMatch) {
        magic.push({ type: "timeit", runs: parseInt(runsMatch[1]!), code: runsMatch[2]! });
      } else {
        magic.push({ type: "timeit", runs: 100, code: trimmed.slice(7).trim() });
      }
      continue;
    }

    if (trimmed.startsWith("%time ")) {
      magic.push({ type: "time", code: trimmed.slice(6).trim() });
      continue;
    }

    if (trimmed.startsWith("%install")) {
      const rest = trimmed.slice("%install".length).replace(/\/\/.*$/, "").trim();
      const packages = rest ? rest.split(/\s+/) : [];
      magic.push({ type: "install", packages });
      continue;
    }

    if (trimmed.startsWith("%reload")) {
      const rest = trimmed.slice("%reload".length).replace(/\/\/.*$/, "").trim();
      const modules = rest ? rest.split(/\s+/) : [];
      if (modules.length > 0) {
        magic.push({ type: "reload", modules });
      }
      continue;
    }

    if (trimmed.startsWith("%sql attach ")) {
      const parts = trimmed.slice("%sql attach ".length).trim().split(/\s+as\s+/i);
      magic.push({ type: "sql_attach", path: parts[0]!, alias: parts[1] });
      continue;
    }

    if (trimmed.startsWith("%sql import ")) {
      const parts = trimmed.slice("%sql import ".length).trim().split(/\s+as\s+/i);
      magic.push({ type: "sql_import", path: parts[0]!, table: parts[1] });
      continue;
    }

    if (trimmed.startsWith("%sql ")) {
      const rest = trimmed.slice("%sql ".length).trim();
      const dbMatch = rest.match(/^@(\S+)\s+([\s\S]+)$/);
      if (dbMatch) {
        magic.push({ type: "sql", db: dbMatch[1], query: dbMatch[2]! });
      } else {
        magic.push({ type: "sql", query: rest });
      }
      continue;
    }

    cleanLines.push(line);
  }

  return {
    magic,
    cleanCode: cleanLines.join("\n").trim(),
  };
}
