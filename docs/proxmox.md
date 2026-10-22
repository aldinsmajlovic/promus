# Promus with systemd

Promus built from source and run as a sandboxed systemd service, here in an unprivileged Debian 13 container (LXC) on Proxmox VE. The steps inside the container work on any Debian 13 machine. The server listens on `127.0.0.1:8080` only, and you put HTTPS in front of it.

The [Docker setup](self-hosting.md) is shorter and runs anywhere.

`<id>` is the Proxmox container ID. All commands inside the container run as root, for example from `pct enter <id>` on the Proxmox host.

## 1. Requirements

- Proxmox VE 8.4 or 9, fully updated. Older `pve-container` releases refuse Debian 13 point releases.
- For the container:
  - 1 CPU core.
  - **2 GB of RAM, or 1 GB with the container's default 512 MB of swap kept.** Each login runs scrypt with 128 MiB of memory, and building the web app peaks at about 1 GB.
  - 8 GB of disk.
- A way to give it an `https://` address, as for the [Docker setup](self-hosting.md#put-https-in-front).

## 2. Create the container on Proxmox

Create a container from the Debian 13 template:
- Keep **Unprivileged container** checked.
- Under **Options → Features**, make sure **Nesting** is enabled. systemd needs it to sandbox services. Without it, the Promus service fails with `status=226/NAMESPACE`. From the host shell, `pct set <id> --features nesting=1` sets it, replacing the container's whole features list.

## 3. Install Promus

Install Node.js 26 from NodeSource, and Git:

```sh
apt update
apt install -y ca-certificates curl git
curl -fsSL https://deb.nodesource.com/setup_26.x -o nodesource_setup.sh
bash nodesource_setup.sh
apt install -y nodejs
node --version
command -v node
```

`command -v node` should print `/usr/bin/node`, which the systemd units use. If your Node.js lives somewhere else, change `ExecStart=` in both `.service` files to that path.

Create a system user, then fetch and build the app:

```sh
useradd --system --user-group --home-dir /var/lib/promus --shell /usr/sbin/nologin promus
git clone https://github.com/aldinsmajlovic/promus.git /opt/promus
cd /opt/promus
npm ci
npm run build -w apps/web
```

`npm ci` may warn that four packages' install scripts aren't covered by `allowScripts`. The build doesn't need them.

The code stays owned by root, so the service can read it but can't change it.

Write the configuration and start the service and the nightly backup timer:

```sh
install -d /etc/promus
cp .env.example /etc/promus/promus.env
cp deploy/promus.service deploy/promus-backup.service deploy/promus-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now promus.service promus-backup.timer
curl -fsS --retry 5 --retry-connrefused --retry-delay 1 http://127.0.0.1:8080/api/health
```

The health check prints `{"status":"ok",...}`.

Notes:
- `/etc/promus/promus.env` sets `PORT`, `HOST`, `DATA_DIR` and `LOG_LEVEL`. Keep `HOST=127.0.0.1` unless the HTTPS proxy runs on another machine (section 4).
- `DATA_DIR=/var/lib/promus` matches `StateDirectory=promus` in the unit. systemd creates that directory, owned by `promus` with mode `0700`. Apart from its private `/tmp`, it is the only place the sandboxed service can write to. If you change `DATA_DIR`, keep it under `/var/lib/promus`.
- Both units set `UMask=0077`, because the database and its backups hold password and session hashes.
- The service logs JSON lines to the journal. Follow them with `journalctl -u promus -f`.

## 4. Put HTTPS in front

Put HTTPS in front of `http://127.0.0.1:8080`, as described in [Put HTTPS in front](self-hosting.md#put-https-in-front). A proxy inside the container reaches it there. For a proxy on another machine, set `HOST` in `/etc/promus/promus.env` to the container's address on your network, keep that address off the internet, and run `systemctl restart promus`.

## 5. Set up your account

The server prints a one-time setup code to its log while it has no accounts:

```sh
journalctl -u promus | grep 'Setup code'
```

Open the server's `https://` address and follow the wizard, as in [Set up your account](self-hosting.md#set-up-your-account). A restart prints a new code.

## 6. Install the app on your phone

Follow [Install the app on your phone](self-hosting.md#install-the-app-on-your-phone), and invite your household from **Settings**.

## 7. Backups and restore

The `promus-backup.timer` unit runs the backup every night at 03:30, and catches up after downtime.
- Each backup is a complete, consistent copy of the database, written with `VACUUM INTO`. It is saved as `/var/lib/promus/backups/promus-YYYY-MM-DD.db`, named by the UTC date.
- The 14 newest backups are kept.

To run a backup now, and to check when the next one is due:

```sh
systemctl start promus-backup.service
systemctl list-timers promus-backup.timer
```

To keep copies off the machine, copy files from `backups/`, or rely on Proxmox backups (vzdump) of the container on top. Never copy the live `promus.db` on its own. Recent changes live in `promus.db-wal` until SQLite folds them in.

To restore a backup:

```sh
systemctl stop promus
cp /var/lib/promus/backups/promus-YYYY-MM-DD.db /var/lib/promus/promus.db
rm -f /var/lib/promus/promus.db-wal /var/lib/promus/promus.db-shm
chown promus:promus /var/lib/promus/promus.db
systemctl start promus
```

Removing the `-wal` and `-shm` files matters: if they're there, they belong to the old database, and SQLite would apply them to the restored one.

**A restore loses every change made after the backup.** That covers list changes, and also accounts, passwords, invites and sessions, which all return to their state in the backup.

**Then reset every device**, as described in [Backups and restore](self-hosting.md#backups-and-restore).

## 8. Updating

```sh
systemctl start promus-backup.service
systemctl stop promus
cd /opt/promus
git pull
npm ci
npm run build -w apps/web
systemctl start promus
```

- Database migrations run on startup and are forward-only, which is why the backup comes first.
- The service is stopped while `npm ci` replaces `node_modules` underneath it.
- If a release changes the files in `deploy/`, copy them to `/etc/systemd/system/` again and run `systemctl daemon-reload`.
- Installed apps pick up the new version on their own and offer a reload.
