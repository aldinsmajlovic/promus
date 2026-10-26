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

An iPhone needs HTTPS, even for testing. Build the app, start the server with `npm run build -w apps/web` and `npm run dev:server`, and put HTTPS in front of port 8080 as in [the self-hosting guide](self-hosting.md#put-https-in-front). Then open that `https://` address in Safari on the iPhone.

## Releasing

Pushing a version tag publishes the Docker image:

```sh
npm version 0.2.0 --no-git-tag-version
git commit -am "release: v0.2.0"
git tag v0.2.0
git push origin main v0.2.0
```

`.github/workflows/image.yml` then:
1. checks that the tag matches `version` in `package.json`;
2. builds the image for amd64 and arm64;
3. starts it and waits for `/api/health`;
4. pushes it to `ghcr.io/aldinsmajlovic/promus` as `0.2.0` and `latest`.

The app reports this version and links to the docs at this tag, so tag only commits whose docs match the code.

The package takes the repository's visibility. To check that anyone can pull it, run `docker manifest inspect ghcr.io/aldinsmajlovic/promus:0.2.0` while logged out of `ghcr.io`. If that's refused, open the package under **Packages** on your GitHub profile, then **Package settings**, and change its visibility to **Public**.

## Icons and screenshots

- `npm run icons` regenerates `brand/promus-p.svg` and the app icons in `apps/web/public/icons` from the Fraunces font.
- `npm run screenshots` retakes the screenshots in `docs/images/`, light and dark. It builds the app, starts it on a throwaway database and fills the list with made-up items through the UI. `npm run screenshots -- <dir>` writes them to another directory, to look without touching the committed ones.

## Layout

The repository is a set of npm workspaces.

| Folder | Holds |
|---|---|
| `apps/server` | Hono API, serves the built app, CLI |
| `apps/web` | Angular app |
| `packages/shared` | Event schemas, fold, name normalization, HLC |
| `deploy/` | systemd units, for the Proxmox setup |
| `.github/workflows/` | The release workflow, which publishes the image |
| `docs/` | Guides, and screenshots in `docs/images/` |
| `e2e/` | Playwright tests |
| `scripts/` | Icon and screenshot generators |

[`CLAUDE.md`](../CLAUDE.md) lists the conventions for code changes, including AI-assisted ones, and [writing docs](writing-docs.md) the rules for docs.
