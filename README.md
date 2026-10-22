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
- Share several lists and one item history with your household. Invite someone with a link or a QR code, and each person gets their own account.
- Installs on Android and iPhone. Swedish and English, with light and dark themes.
- Runs on your own server, with no public sign-up. Every change is kept with when it happened and who made it.

## Status

Early: the list, search, offline sync, undo, the setup wizard and household invites are done, and being tried day to day.
Stats, data export and a Home Assistant integration come next.

## Quick start

On a machine with Docker and [Tailscale](https://tailscale.com/download):

```sh
docker run -d --name promus -p 127.0.0.1:8080:8080 -v promus-data:/data --restart unless-stopped ghcr.io/aldinsmajlovic/promus
tailscale funnel --bg 8080
docker logs promus
```

Open the `https://` address that `tailscale funnel` prints, enter the setup code from `docker logs`, and follow the wizard. It ends with a QR code that opens Promus on your phone. Then invite your household from **Settings**.

Funnel makes the sign-in page reachable from the internet. To keep Promus private to your own devices, or to use your own domain, see the [self-hosting guide](docs/self-hosting.md).

## Documentation

- [Self-hosting](docs/self-hosting.md): Docker, HTTPS with Tailscale or your own domain, the phone, invites, backups and updates.
- [Promus on Proxmox](docs/proxmox.md): an LXC container with systemd, built from source.
- [Tailscale access policy](docs/tailscale-policy.md): limiting what each device on your tailnet can reach.
- [Configuration](docs/configuration.md): the environment variables.
- [Server commands](docs/cli.md): accounts and backups.
- [Development](docs/development.md): running it locally, the checks, releasing and the project layout.
- [Decisions](docs/decisions.md): what changed from the original plan, and why.
- [Writing docs](docs/writing-docs.md): rules for these pages.

## License

[MIT](LICENSE).
