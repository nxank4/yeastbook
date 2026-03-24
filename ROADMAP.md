# Roadmap

## Current: v0.0.x (Internal Dev)

Core execution engine, Monaco editor, rich output (charts, tables, JSON trees), Jupyter import/export, session persistence, VS Code extension.

## Next: v0.1.0 (Public Beta)

- [ ] `bunx yeastbook new` works on a another user's machine
- [ ] No crash during normal usage
- [ ] README sufficient for new users
- [ ] Binary builds on Linux + macOS
- [ ] At least 1-2 external testers confirm usable

## Planned

**Zero-Setup Reproducibility** — "Write once, run anywhere" for notebooks
- [ ] Embed `package.json` + `bun.lockb` in `.ybk` metadata on save
- [ ] Auto-detect missing dependencies on open → prompt install via Bun
- [ ] `bunx yeastbook file.ybk` installs deps + runs in one step

**Readable Diff Mode** — Git-friendly notebook format
- [ ] `.ybk.md` split-save: code & markdown in plain Markdown, outputs in sidecar JSON
- [ ] Clean diffs on GitHub — reviewable without opening Yeastbook
- [ ] Round-trip: open `.ybk.md` back in Yeastbook with full output restore

**SQL Cells** — Native data exploration powered by `bun:sqlite`
- [ ] `%sql` cell type with syntax highlighting
- [ ] Drag-and-drop `.db`, `.csv`, `.json` files as queryable tables
- [ ] Query results render as Interactive Table (existing rich output)

**Editor**
- [ ] Multi-cursor support
- [ ] Cell folding
- [ ] Find & replace across cells

**Kernel**
- [ ] `%pip`-style magic for Bun packages
- [ ] Cell execution queue with cancel
- [ ] Session export/restore

**Output**
- [ ] Interactive DataFrame viewer
- [ ] Vega/Vega-Lite chart support
- [ ] LaTeX/KaTeX math rendering

**Ecosystem**
- [ ] Plugin API for custom output renderers
- [ ] npm publish for `yeastbook` CLI
- [ ] Homebrew formula

## Non-Goals (for now)

- Multi-user collaboration (Google Docs style)
- Cloud hosting / Yeastbook-as-a-service
- Python/R kernel support
- JupyterHub compatibility
