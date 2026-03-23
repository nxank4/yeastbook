// src/kernel/magic.ts — Parse magic commands from cell code

export type MagicCommand =
  | { type: "install"; packages: string[] }
  | { type: "reload"; modules: string[] };

export interface ParseResult {
  magic: MagicCommand[];
  cleanCode: string;
}

export function parseMagicCommands(code: string): ParseResult {
  const lines = code.split("\n");
  const magic: MagicCommand[] = [];
  const cleanLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("%install")) {
      const rest = trimmed.slice("%install".length).replace(/\/\/.*$/, "").trim();
      const packages = rest ? rest.split(/\s+/) : [];
      magic.push({ type: "install", packages });
    } else if (trimmed.startsWith("%reload")) {
      const rest = trimmed.slice("%reload".length).replace(/\/\/.*$/, "").trim();
      const modules = rest ? rest.split(/\s+/) : [];
      if (modules.length > 0) {
        magic.push({ type: "reload", modules });
      }
    } else {
      cleanLines.push(line);
    }
  }

  return {
    magic,
    cleanCode: cleanLines.join("\n").trim(),
  };
}
