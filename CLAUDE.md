## Branching Strategy

- **`main`** — production only, stable releases
- **`staging`** — pre-production, testing
- **`feature/<name>`** — one branch per feature, branched off staging
- **`hotfix/<name>`** — urgent fixes branched off main

### Rules
- Never commit directly to main or staging
- All feature work: create `feature/<name>` off staging
- When feature done: merge into staging (with `--no-ff`)
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
- Manual smoke test: `bun src/cli.ts new` works
- No TypeScript errors

## Release History

- **P0 "Go Live"** — Core execution, binary build, npm publishing (on staging)
- **P1 "Killer Features"** — Monaco Editor, %install magic command, rich output (on staging)
- **P2 "Ecosystem"** — VS Code extension, Bun Shell + file watcher, plugin system (on staging)

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
