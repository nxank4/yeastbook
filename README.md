<p align="center">
  <img src="assets/icon.png" alt="Yeastbook" width="100" />
</p>

<h1 align="center">yeastbook</h1>

<p align="center">
  <a href="https://github.com/nxank4/yeastbook/actions/workflows/ci.yml"><img src="https://github.com/nxank4/yeastbook/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=codepawl.vscode-yeastbook"><img src="https://img.shields.io/visual-studio-marketplace/v/codepawl.vscode-yeastbook?label=VS%20Code" alt="VS Code Marketplace" /></a>
</p>

<p align="center"><strong>A TypeScript notebook powered by Bun.</strong> One command, zero config. No Python, no conda, no kernel installs.</p>

```bash
bunx yeastbook new
```

## Why not Jupyter?

| | Jupyter | Marimo | **Yeastbook** |
|---|---------|--------|---------------|
| Language | Python (+ kernels) | Python | **TypeScript/JavaScript** |
| Runtime | IPython + ZeroMQ | Python | **Bun** (fast, single binary) |
| Setup | conda/pip + kernel install | pip install | **`bunx` or single binary** |
| Top-level await | No | No | **Yes** |
| Type checking | No | No | **Monaco + TypeScript** |
| Format | .ipynb (complex JSON) | .py | **.ybk** (simple JSON) + .ipynb |
| Package install | `%pip install` | `import` | **`%install lodash`** |

**Yeastbook is for developers who think in TypeScript** and want a notebook that starts in 1 second, not 30.

## Features

- **Zero config** — one command to start. No kernel setup, no config files
- **TypeScript native** — full TypeScript with Monaco editor, IntelliSense, and type checking
- **Top-level await** — `const data = await fetch(...)` just works
- **Variable sharing** — variables defined in one cell are available in the next
- **Rich output** — charts (Chart.js), data tables, JSON trees, HTML, images
- **Live streaming** — console.log streams to the browser in real-time
- **Jupyter compatible** — import/export `.ipynb` files
- **Session persistence** — variables survive server restart (24h)
- **Light & dark themes** — warm minimal aesthetic with amber accents
- **Self-contained binary** — download a single file, no runtime needed
- **Presentation mode** — present notebooks as clean slides (Ctrl+Shift+E)

## Install

```bash
# Run instantly (no install needed)
bunx yeastbook new

# Or install globally
bun install -g yeastbook
yeastbook new

# Or download a binary (no Bun required)
curl -fsSL https://github.com/nxank4/yeastbook/releases/latest/download/install.sh | bash
```

## CLI

```bash
yeastbook new                # Create a new .ybk notebook
yeastbook new --ipynb        # Create a new .ipynb notebook
yeastbook <file>             # Open an existing notebook
yeastbook export <file.ybk>  # Convert .ybk -> .ipynb
yeastbook import <file.ipynb> # Convert .ipynb -> .ybk
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Shift+Enter` | Run cell & advance |
| `Ctrl+Enter` | Run cell & stay |
| `Ctrl+S` | Save |
| `Ctrl+Shift+E` | Toggle presentation mode |
| `Ctrl+Shift+P` | Command palette |
| `A` / `B` | Add cell above / below (command mode) |
| `D D` | Delete cell (command mode) |
| `M` / `Y` | Switch to markdown / code (command mode) |

## Rich Output

```ts
// Chart
;({ __type: "chart", data: [10, 20, 30], config: { chartType: "bar", title: "My Chart" } })

// Table (any array of objects)
[{ name: "Alice", age: 30 }, { name: "Bob", age: 25 }]

// HTML
;({ __type: "html", html: "<h1>Hello</h1>" })
```

## Development

```bash
git clone https://github.com/nxank4/yeastbook
cd yeastbook
bun install
bun run dev          # Build UI + start dev server with hot reload
bun test             # Run tests (201 tests)
bun run build:all    # Full build (UI + embed + binary)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). PRs welcome!

## License

[MIT](LICENSE) — Made by [CodePawl](https://github.com/nxank4)

Built with [Claude Code](https://claude.com/claude-code) as coding assistant.
