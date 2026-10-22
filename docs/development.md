# Development

This needs Node.js 26 (see `.node-version`). The end-to-end tests and the screenshots also need Google Chrome, and the end-to-end tests need Playwright's WebKit: `npx playwright install webkit`.

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
npm run e2e          # Playwright in mobile Chrome and WebKit, against a fresh build and database
```

WebKit, like Safari, drops the `Secure` session cookie on `http://localhost`, so it can't stay signed in to the test server. The WebKit run only checks that the app says it needs HTTPS. The signed-in flows run in Chrome, and `e2e/setup.spec.ts` starts a server of its own on an empty database for the setup wizard and invites.

## On a real phone

Connect an Android phone over USB with USB debugging enabled, then run:

```sh
adb reverse tcp:4200 tcp:4200
```

Then open <http://localhost:4200> in Chrome on the phone. The phone sees the dev server as `localhost`, which is a secure context, so signing in works without HTTPS.

An iPhone needs HTTPS, even for testing. Build the app and serve it through Tailscale, with the phone on your tailnet:

```sh
npm run build -w apps/web
npm run dev:server
tailscale serve --bg 8080
```

Then open the `https://` address that `tailscale serve` prints in Safari on the iPhone.

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
