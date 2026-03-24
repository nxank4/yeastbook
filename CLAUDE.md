## Branching Strategy

- **`main`** — production only, stable releases
- **`staging`** — development, commit directly here
- **`hotfix/<name>`** — urgent fixes branched off main

### Rules
- Commit directly to staging (no feature branches)
- Never commit directly to main
- When staging tested and stable: merge staging into main + tag release
- Hotfixes: branch off main, merge back to both main AND staging

### Commit Messages (Conventional Commits)
- `feat:` new feature
- `fix:` bug fix
- `chore:` tooling, config
- `docs:` documentation
- `refactor:` code restructure
- `test:` adding tests

### Merge Strategy
- Rebase before merging to keep history linear
- No fast-forward merges to staging/main: use `--no-ff`
- Squash commits on feature branch before merging if too many small commits

### PR Checklist (before merging to staging)
- `bun test` passes
- `bun run build:ui` succeeds
- Manual smoke test: `bun packages/app/src/cli.ts new` works
- No TypeScript errors

## Package Names

- **`@codepawl/yeastbook`** — CLI + server (packages/app)
- **`@codepawl/yeastbook-core`** — shared types and logic (packages/core)
- **`@codepawl/yeastbook-ui`** — React UI components (packages/ui)

All source imports use `@codepawl/yeastbook-core`. Workspace dependencies use `workspace:*`.

## Versioning

- `0.0.x` — internal dev, not usable by others
- `0.x.0` — public beta, usable but not stable
- `1.0.0` — stable MVP, production-ready

### MVP Checklist (before 0.1.0)
- [ ] `bunx @codepawl/yeastbook new` works on a stranger's machine
- [ ] No crash during normal usage
- [ ] README sufficient for new users
- [ ] At least 1-2 external testers confirm usable
- [ ] Binary builds on Linux + Mac

### Release History
- **0.0.1** (current) — core execution, Monaco editor, rich output, Python bridge, VS Code extension

## Publishing

```bash
npm login
bun run publish:all  # builds UI + embeds assets + publishes core → ui → app
```

---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

- Import HTML files directly in server: `import index from "./index.html"`
- HTML files can import .tsx, .jsx, .js directly — Bun transpiles automatically
- `<link>` tags pointing to stylesheets — Bun CSS bundler handles automatically
- Use `Bun.serve()` with `routes` object for API endpoints
- Use `development: { hmr: true }` for hot reload in dev
- Run with `bun --hot ./index.ts`

## Architecture

### Polyglot Kernel
- TypeScript cells: executed via `AsyncFunction` in Bun (packages/app/src/kernel/execute.ts)
- Python cells: persistent daemon via `Bun.spawn` (packages/app/src/kernel/python-bridge.ts + python/yeastbook_kernel.py)
- Language selection: stored in `cell.metadata.language`, routed server-side via WS `language` field
- YeastBridge: bi-directional key-value store for cross-language data sharing

### VS Code Extension
- packages/vscode — notebook serializer + kernel controller
- CLI discovery: extension path → workspace node_modules → workspace monorepo → global install
- Configurable via `yeastbook.cliPath` setting
