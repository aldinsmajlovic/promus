# Promus

Self-hosted offline-first grocery list. npm workspaces: `packages/shared`, `apps/server`, `apps/web`.

## Rules for AI-assisted changes

- Node 26. Server and shared code is TypeScript run directly by Node: no enums, no parameter properties, no namespaces, relative imports end in `.ts`.
- One way to fetch data: the `ApiClient`. Never call `fetch` or `HttpClient` elsewhere.
- One error shape: every HTTP error body is `{ "error": "<code>", "message"?: string }`.
- One logger: structured JSON lines (pino) to stdout. No `console.log`, no leftover debug output.
- Schema changes only through new numbered `.sql` migration files. Forward-only. Never edit an applied migration; never update or delete stored events.
- Validate with Zod 4 schemas from `packages/shared`, on server and client.
- Configuration only from environment variables (`PORT`, `HOST`, `DATA_DIR`, `LOG_LEVEL`). No URLs, hostnames, ports or secrets in code.
- Angular: standalone components, signals, zoneless, `@if`/`@for`. No NgModules, no zone.js, no `*ngIf`.
- Every user-visible string goes through Transloco (`sv` and `en`).
- Every action is undoable from a snackbar. No confirmation dialogs.
- No empty `catch`, no swallowed errors, no commented-out code, no TODOs.
- Never commit `initial.md`, `.superpowers/`, `docs/superpowers/`, `data/`, `*.db`, `node_modules/`, `dist/`, `.angular/`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Local design docs

Spec: `docs/superpowers/specs/2026-10-21-grocery-list-design.md`. Plan: `docs/superpowers/plans/2026-10-21-promus-weekend-1.md`.
