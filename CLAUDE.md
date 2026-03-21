## Branching Strategy

- **`main`** — production branch. Only merge tested, stable code here.
- **`staging`** — testing branch. All new features and fixes go here first for testing before merging to `main`.
- Create feature branches off `staging`. PRs should target `staging` unless it's a hotfix for production.

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
