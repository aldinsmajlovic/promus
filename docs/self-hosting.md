# Self-hosting Promus

Promus runs as one Docker container that serves the app and its API. How people reach it is up to you. Promus only needs HTTPS in front of it, because the app's service worker and its `Secure` session cookie only work in a secure context.

To run it as a systemd service instead, for example in a Proxmox LXC container, see [Promus with systemd](proxmox.md).

## Requirements

- An always-on machine with Docker, on amd64 or arm64: a home server, a NAS, a Raspberry Pi 4 or 5, or a small VPS. On Proxmox, run Docker in a VM, or use the [systemd setup](proxmox.md).
- Memory: the server uses about 60 MiB, plus 128 MiB for each sign-in in progress, which runs scrypt.
- A way to give it an `https://` address: a reverse proxy with a certificate, a tunnel, or whatever you already use.
- Phones: Android with Chrome, or an iPhone with Safari on iOS 17 or later.

## Start Promus

```sh
docker run -d --name promus -p 127.0.0.1:8080:8080 -v promus-data:/data --restart unless-stopped ghcr.io/aldinsmajlovic/promus
```

Or, with Compose, download [`compose.yaml`](../compose.yaml) into a folder of its own and run `docker compose up -d` there. Both name the container `promus`, which the commands below use.

- **Where it listens:** the server is reachable only from this machine, on `127.0.0.1:8080`. To use another port, change the left side of `-p` or `ports`.
- **Where the data lives:** the `promus-data` volume holds the database and its backups.
- **Configuration:** nothing needs setting. [Configuration](configuration.md) lists what can be set.

<!-- linked from the app: keep this heading -->
## Put HTTPS in front

Promus listens on plain HTTP. Exposing it, to your network or to the internet, is up to you: a reverse proxy with port forwarding, a tunnel, a VPN. Whatever you put in front must:
- serve it over HTTPS, with a certificate the phones trust;
- forward to Promus at `http://127.0.0.1:8080`;
- keep the original `Host` header. The server compares a request's `Origin` with its `Host` to block cross-site requests.

Forwarding port 8080 itself doesn't work. That's plain HTTP: browsers won't keep the sign-in, and passwords would cross the network unencrypted.

For example, [Caddy](https://caddyserver.com) gets a certificate on its own and keeps the `Host` header. With port 443 forwarded to it, this is the whole configuration:

```
promus.example.com {
	reverse_proxy 127.0.0.1:8080
}
```

If the proxy runs on another machine, publish the port where it can reach it, for example `-p 192.168.1.10:8080:8080`, and keep that address off the internet.

When Promus is reachable from the internet:
- **Anyone can open the sign-in page.** There's no sign-up, and the first account needs the setup code from the server's log.
- **Choose strong passwords.** Promus allows 10 failed sign-ins per username every 15 minutes.

## Set up your account

Open the server's `https://` address. A new server shows the setup wizard:
1. Pick Swedish or English. It also names your first list.
2. Enter the setup code, then choose a username and a password of at least 8 characters.
3. Get it onto your phone, as described below.

The setup code is in the server's log:

```sh
docker logs promus | grep 'Setup code'
```

It prints a line with `Setup code: XXXX-XXXX`. Case and the dash don't matter. A restart prints a new code, and once the first account exists, no code works any more.

## Install the app on your phone

The wizard's last step, and **Settings > Install app**, show the server's address as a QR code. Scan it with the phone's camera.

- **Android:** in Chrome, tap **Install app** in Promus, or choose **Install app** from Chrome's menu.
- **iPhone:** in Safari, tap **Share**, then **Add to Home Screen**. Open Promus from the Home Screen and sign in once more: the installed app keeps its own sign-in, apart from Safari's. Install it before relying on it. Safari may clear a website's data after 7 days without use, and changes that haven't synced yet would go with it. An app on the Home Screen counts only its own days of use.

The installed app works offline and syncs whenever the phone can reach the server.

## Invite your household

In **Settings**, open **Household** and tap **Invite someone**. The link shows as a QR code to scan, with **Share** and **Copy**.
- **The link:** it works once, for 7 days. **Undo** in the snackbar cancels it.
- **Joining:** whoever opens it chooses their own username and password, joins your household, and sees the same lists and item history.
- **Removing someone:** not possible yet. Until it is, `user:password` from the [server commands](cli.md) signs them out everywhere.

## Backups and restore

Back up every night from cron or a systemd timer on the host, and copy the backups somewhere else:

```sh
docker exec promus node apps/server/src/cli.ts backup
docker cp promus:/data/backups ./backups
```

- **What a backup is:** a complete, consistent copy of the database, written to `/data/backups/promus-YYYY-MM-DD.db` and named by the UTC date. The 14 newest are kept.
- **Where it lives:** in the `promus-data` volume, so `docker volume rm promus-data` deletes the backups along with the database. Keep copies outside the volume.
- **Never copy the live `promus.db` on its own.** Recent changes live in `promus.db-wal` until SQLite folds them in.

To restore a backup:

```sh
docker stop promus
docker run --rm -v promus-data:/data ghcr.io/aldinsmajlovic/promus sh -c 'cp /data/backups/promus-YYYY-MM-DD.db /data/promus.db && rm -f /data/promus.db-wal /data/promus.db-shm'
docker start promus
```

Removing the `-wal` and `-shm` files matters: they belong to the old database, and SQLite would apply them to the restored one.

**A restore loses every change made after the backup.** That covers list changes, and also accounts, passwords, invites and sessions, which all return to their state in the backup.

**Then reset every device.** Each device remembers how far it has synced by its position in the server's log. A restored server hands out those positions again.
- A device that had synced past the backup would never receive new changes.
- Its own changes from after the backup would stay on that device only.

On every device:
1. Open **Settings**, tap your name, and sign out, then sign back in. Signing out clears the device's local copy. It refuses while the device has unsynced changes, so let it sync first.
2. If the app already shows the sign-in page, don't delete its site data: the device may still hold changes it hasn't synced. Instead:
   1. Sign in again as the **same** user. That keeps the local copy and its unsynced changes.
   2. Let it sync, until the badge on your initial is gone.
   3. Open **Settings**, tap your name, sign out, and sign in again.

## Updating

Back up first: database migrations run on startup and are forward-only.

```sh
docker exec promus node apps/server/src/cli.ts backup
docker pull ghcr.io/aldinsmajlovic/promus
docker rm -f promus
docker run -d --name promus -p 127.0.0.1:8080:8080 -v promus-data:/data --restart unless-stopped ghcr.io/aldinsmajlovic/promus
```

With Compose, the last three lines are `docker compose pull && docker compose up -d`.

Installed apps pick up the new version on their own and offer a reload.
