// src/templates.ts — Notebook templates for `yeastbook new --template`

import type { YbkNotebook, YbkCell } from "@codepawl/yeastbook-core";

let idCounter = 0;
function uuid(): string {
  return `tmpl-${++idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

const defaultMeta = {
  created: new Date().toISOString(),
  runtime: "bun" as const,
  bunVersion: typeof Bun !== "undefined" ? Bun.version : "unknown",
};

const defaultSettings = {
  fontSize: 13,
  tabSize: 2,
  wordWrap: false,
  theme: "light",
};

function cell(type: "code" | "markdown", source: string): YbkCell {
  return {
    id: uuid(),
    type,
    source,
    outputs: [],
    executionCount: null,
  };
}

export const templates: Record<string, YbkNotebook> = {
  scratch: {
    version: "0.1.0",
    metadata: { title: "Scratch", ...defaultMeta },
    settings: defaultSettings,
    cells: [cell("code", "")],
  },

  "api-client": {
    version: "0.1.0",
    metadata: { title: "API Client", ...defaultMeta },
    settings: defaultSettings,
    cells: [
      cell("markdown", "# API Client\nExplore an API endpoint."),
      cell(
        "code",
        `// Setup\nconst BASE_URL = "https://api.example.com"\nconst headers = {\n  "Content-Type": "application/json",\n  // "Authorization": \`Bearer \${process.env.API_KEY}\`\n}`
      ),
      cell(
        "code",
        `// GET request\nconst res = await fetch(\`\${BASE_URL}/endpoint\`, { headers })\nconst data = await res.json()\ndata`
      ),
      cell(
        "code",
        `// POST request\nconst body = { key: "value" }\nconst postRes = await fetch(\`\${BASE_URL}/endpoint\`, {\n  method: "POST",\n  headers,\n  body: JSON.stringify(body)\n})\nawait postRes.json()`
      ),
    ],
  },

  "data-explore": {
    version: "0.1.0",
    metadata: { title: "Data Exploration", ...defaultMeta },
    settings: defaultSettings,
    cells: [
      cell("markdown", "# Data Exploration\nLoad and explore a dataset."),
      cell(
        "code",
        `// Load data from file\nconst raw = await Bun.file("data.json").json()\nconsole.log("Rows:", raw.length)\nraw.slice(0, 5)`
      ),
      cell(
        "code",
        `// Basic stats\nconst keys = Object.keys(raw[0] ?? {})\nconsole.log("Columns:", keys)\n\n// Count by field\nconst counts = raw.reduce((acc, row) => {\n  const key = row[keys[0]]\n  acc[key] = (acc[key] ?? 0) + 1\n  return acc\n}, {})\ncounts`
      ),
      cell(
        "code",
        `// Visualize\n({\n  __type: "chart",\n  data: Object.values(counts),\n  config: {\n    chartType: "bar",\n    label: keys[0],\n    title: "Distribution"\n  }\n})`
      ),
    ],
  },

  "bun-script": {
    version: "0.1.0",
    metadata: { title: "Bun Script", ...defaultMeta },
    settings: defaultSettings,
    cells: [
      cell("markdown", "# Bun Script\nUse Bun APIs and shell commands."),
      cell(
        "code",
        `// Bun info\nconsole.log("Bun version:", Bun.version)\nconsole.log("CWD:", process.cwd())`
      ),
      cell(
        "code",
        "// Shell commands\nconst files = await $`ls -la`.text()\nconsole.log(files)"
      ),
      cell(
        "code",
        `// File operations\nawait Bun.write("output.txt", "Hello from yeastbook!")\nconst content = await Bun.file("output.txt").text()\nconsole.log("Written:", content)`
      ),
    ],
  },
};
