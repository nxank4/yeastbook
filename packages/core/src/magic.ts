// src/kernel/magic.ts — Parse magic commands from cell code

export type MagicCommand =
  | { type: "install"; packages: string[] }
  | { type: "reload"; modules: string[] }
  | { type: "timeit"; runs: number; code: string }
  | { type: "time"; code: string };

export interface ParseResult {
  magic: MagicCommand[];
  cleanCode: string;
}

export function parseMagicCommands(code: string): ParseResult {
  const lines = code.split("\n");
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

    cleanLines.push(line);
  }

  return {
    magic,
    cleanCode: cleanLines.join("\n").trim(),
  };
}
