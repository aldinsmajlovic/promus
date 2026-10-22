# Promus

A self-hosted grocery list for your phone that works offline. Anything you've bought before comes back with a tap, never as a duplicate, and checked items clear themselves instead of piling up.

In Latin, a *promus* is the household steward who brings provisions out of the storeroom.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/list-dark.png">
  <img src="docs/images/list-light.png" alt="The list screen: six items, three of them with notes, and two checked items under Done" width="320">
</picture>

## Features

- Re-add anything you've bought before with a few letters and a tap. Typos and diacritics are fine: "gradd" finds "grädd". The same item comes back, never a duplicate.
- With the add field empty, your most-bought items that aren't on the list are one tap away.
- Works fully offline in the store. Changes sync when the server is reachable, with nothing lost or duplicated.
- Checked items move to a Done section and leave the list after 24 hours.
- Every action can be undone from the snackbar. There are no confirmation dialogs.
- Several lists, sharing one item history.
- Swedish and English, with light and dark themes.
- Runs on your own server, with no public sign-up. Every change is kept with when it happened and who made it.

## Status

Early: the list, search, offline sync and undo are done, and being tried day to day.
Stats, data export and a Home Assistant integration come next.

## Quick start

With Docker:

```sh
git clone https://github.com/aldinsmajlovic/promus.git
cd promus
cp .env.example .env
docker compose up -d --build
docker compose exec promus node apps/server/src/cli.ts user:create <username>
```

Open <http://localhost:8080> on the same machine and sign in. Phones need HTTPS in front: the self-hosting guide sets that up with Tailscale and installs the app on the phone.

## Documentation

- [Self-hosting](docs/self-hosting.md): a Proxmox container or Docker, Tailscale, the phone, backups and updates.
- [Configuration](docs/configuration.md): the environment variables.
- [Server commands](docs/cli.md): accounts and backups.
- [Development](docs/development.md): running it locally, the checks and the project layout.
- [Writing docs](docs/writing-docs.md): rules for these pages.

## License

[MIT](LICENSE).
