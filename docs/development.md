# Development

This needs Node.js 26 (see `.node-version`). The end-to-end tests and the screenshots also need Google Chrome.

npm 11 skips the install scripts of esbuild, lmdb, msgpackr-extract and @parcel/watcher. That is intentional: the build, the tests and the Docker image work without them.

```sh
npm ci
npm run dev:server   # API on http://127.0.0.1:8080, data in ./data, restarts on change
npm run dev:web      # app on http://localhost:4200, proxies /api to the API
node apps/server/src/cli.ts user:create dev
```

## Checks

```sh
npm run typecheck
npm test             # unit and integration tests, against real SQLite files
npm run lint         # no em dashes in tracked files
npm run e2e          # Playwright in mobile Chrome, against a fresh build and database
```

## On a real phone

Connect an Android phone over USB with USB debugging enabled, then run:

```sh
adb reverse tcp:4200 tcp:4200
```

Then open <http://localhost:4200> in Chrome on the phone. The phone sees the dev server as `localhost`, which is a secure context, so signing in works without HTTPS.

## Icons and screenshots

- `npm run icons` regenerates `brand/promus-p.svg` and the app icons in `apps/web/public/icons` from the Fraunces font.
- `npm run screenshots` retakes the screenshots in `docs/images/`, light and dark. It builds the app, starts it on a throwaway database and fills the list with made-up items through the UI.

## Layout

The repository is a set of npm workspaces.

| Folder | Holds |
|---|---|
| `apps/server` | Hono API, serves the built app, CLI |
| `apps/web` | Angular app |
| `packages/shared` | Event schemas, fold, name normalization, HLC |
| `deploy/` | systemd units |
| `docs/` | Guides, and screenshots in `docs/images/` |
| `e2e/` | Playwright tests |
| `scripts/` | Icon and screenshot generators |

[`CLAUDE.md`](../CLAUDE.md) lists the conventions for code changes, including AI-assisted ones, and [writing docs](writing-docs.md) the rules for docs.
