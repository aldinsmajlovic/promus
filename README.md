# Promus

Promus is a self-hosted grocery list that works offline. It is an installable web app (PWA) for the phone, backed by a small Node.js server with SQLite that syncs your devices. Every change is stored as an event, so bringing back something you bought before takes one tap and never creates a duplicate.

In Latin, a *promus* is the household steward who brings provisions out of the storeroom.

## Features

- Re-add any item you've bought before with a few letters and a tap. The same item is reused, never duplicated.
- Search handles typos and diacritics: "gradd" finds "grädd".
- With the add field empty, your most-bought items that aren't on the list are one tap away.
- Fully usable offline. Changes sync when the server is reachable, with nothing lost or duplicated.
- Checked items move to a Done section and drop off the list after 24 hours.
- Every action can be undone from the snackbar. There are no confirmation dialogs.
- Several lists, sharing one item history.
- Swedish and English, plus light and dark themes.
- Every change is logged with when it happened and who made it.
- Accounts are created on the server. There is no public sign-up.

## Quick start with Docker

```sh
git clone <repository-url> promus
cd promus
cp .env.example .env
docker compose up -d --build
docker compose exec promus node apps/server/src/cli.ts user:create <username>
```

Open <http://localhost:8080> on the same machine and sign in.
- The container is published on `127.0.0.1:8080` only.
- Phones and other machines need HTTPS in front, because the service worker and the `Secure` session cookie only work in a secure context. `localhost` counts as one, so a browser on the Docker host works over plain HTTP.

## Self-hosting

[docs/self-hosting.md](docs/self-hosting.md) is the full guide. It covers:
- a Proxmox LXC with a sandboxed systemd service
- Tailscale with `tailscale serve`, and an optional policy lockdown
- backups, restore and updating
- the Docker setup in more detail

The `deploy/` folder holds the systemd units for the service and for the nightly backup.

### Configuration

Configuration comes only from environment variables. See [.env.example](.env.example).

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | TCP port to listen on |
| `HOST` | `127.0.0.1` | Address to bind |
| `DATA_DIR` | `./data` | Database (`promus.db`) and `backups/` |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |

### Accounts and backups

These commands run on the server, from the repository root:

```sh
node apps/server/src/cli.ts user:create <username> [--locale en|sv]
node apps/server/src/cli.ts user:password <username>
node apps/server/src/cli.ts backup
```

- **`user:create`** asks for a password of at least 8 characters, on a hidden prompt. Without a TTY, it reads the first line of stdin.
  - It also creates the user's default list.
  - The list's name is English by default (`--locale en`). `--locale sv` gives it a Swedish name.
- **`user:password`** sets a new password and signs that user out on every device.
- **`backup`** writes a consistent copy of the database to `DATA_DIR/backups/promus-YYYY-MM-DD.db`, and keeps the 14 newest.

### Updating

- **Docker:** `git pull && docker compose up -d --build`.
- **systemd install:** see [Updating](docs/self-hosting.md#9-updating) in the guide.

Database migrations run automatically on startup.

## Development

This needs Node.js 26 (see `.node-version`). The end-to-end tests also need Google Chrome.

```sh
npm ci
npm run dev:server   # API on http://127.0.0.1:8080, data in ./data, restarts on change
npm run dev:web      # app on http://localhost:4200, proxies /api to the API
node apps/server/src/cli.ts user:create dev
```

Checks:

```sh
npm run typecheck
npm test             # unit and integration tests, against real SQLite files
npm run e2e          # Playwright in mobile Chrome, against a fresh build and database
```

To test on a real Android phone, connect it over USB with USB debugging enabled, then run:

```sh
adb reverse tcp:4200 tcp:4200
```

Then open <http://localhost:4200> in Chrome on the phone. The phone sees the dev server as `localhost`, which is a secure context, so signing in works without HTTPS.

`npm run icons` regenerates `brand/promus-p.svg` and the app icons in `apps/web/public/icons` from the Fraunces font.

Repository layout (npm workspaces):

```
apps/server       Hono API, serves the built app, CLI
apps/web          Angular app
packages/shared   event schemas, fold, name normalization, HLC
deploy/           systemd units
docs/             self-hosting guide
e2e/              Playwright tests
```

`CLAUDE.md` lists the conventions for changes, including AI-assisted ones.
