// src/parse-flags.ts — CLI flag parsing (extracted for testability)

export interface ParsedArgs {
  positional: string[];
  port: number;
  noOpen: boolean;
  ipynb: boolean;
  dev: boolean;
  template: string | null;
  dir: string | null;
}

export function parseFlags(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  let port = parseInt(process.env.PORT ?? "3000", 10);
  let noOpen = false;
  let ipynb = false;
  let dev = false;
  let template: string | null = null;
  let dir: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port") {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        port = parseInt(next, 10);
        i++;
      } else {
        console.error("Error: --port requires a numeric argument.");
        process.exit(1);
      }
    } else if (arg!.startsWith("--port=")) {
      port = parseInt(arg!.slice("--port=".length), 10);
    } else if (arg === "--no-open") {
      noOpen = true;
    } else if (arg === "--ipynb") {
      ipynb = true;
    } else if (arg === "--dev") {
      dev = true;
    } else if (arg === "--template") {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        template = next;
        i++;
      }
    } else if (arg === "--dir") {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        dir = next;
        i++;
      }
    } else {
      positional.push(arg!);
    }
  }

  return { positional, port, noOpen, ipynb, dev, template, dir };
}
