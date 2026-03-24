# Roadmap

## Current: v0.0.x (Internal Dev)

Core execution engine, Monaco editor, rich output (charts, tables, JSON trees), Jupyter import/export, session persistence, VS Code extension, Python bridge with YeastBridge, native language selector.

## Next: v0.1.0 (Public Beta)

- [ ] `bunx @codepawl/yeastbook new` works on another user's machine
- [ ] No crash during normal usage
- [x] README sufficient for new users
- [x] Binary builds on Linux + macOS
- [ ] At least 1-2 external testers confirm usable

## Planned

**Zero-Setup Reproducibility** — "Write once, run anywhere" for notebooks
- [x] Embed `package.json` + `bun.lock` in `.ybk` metadata on save
- [x] Auto-detect missing dependencies on open → prompt install via Bun
- [x] `bunx yeastbook file.ybk` installs deps + runs in one step

**Readable Diff Mode** — Git-friendly notebook format
- [x] `.ybk.md` split-save: code & markdown in plain Markdown, outputs in sidecar JSON
- [x] Clean diffs on GitHub — reviewable without opening Yeastbook
- [x] Round-trip: open `.ybk.md` back in Yeastbook with full output restore

**SQL Cells** — Native data exploration powered by `bun:sqlite`
- [ ] `%sql` cell type with syntax highlighting
- [ ] Drag-and-drop `.db`, `.csv`, `.json` files as queryable tables
- [ ] Query results render as Interactive Table (existing rich output)

**Editor**
- [x] Multi-cursor support
- [x] Cell folding
- [x] Find & replace across cells

**Kernel**
- [x] `%install`-style magic for Bun packages
- [x] Cell execution queue with cancel
- [x] Session export/restore (snapshot persistence)

**Output**
- [x] Interactive DataFrame viewer
- [x] Vega/Vega-Lite chart support
- [ ] LaTeX/KaTeX math rendering

**Ecosystem**
- [x] Plugin API for custom output renderers
- [x] npm publish for `@codepawl/yeastbook` CLI
- [x] Homebrew formula

## Non-Goals (for now)

- Multi-user collaboration (Google Docs style)
- Cloud hosting / Yeastbook-as-a-service
- R kernel support
- JupyterHub compatibility
