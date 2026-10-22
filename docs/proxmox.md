# Promus on Proxmox

The advanced setup: Promus built from source in an unprivileged Debian 13 container (LXC) on Proxmox VE, and run as a systemd service. Tailscale makes it reachable from your devices and from nowhere else. The server listens on `127.0.0.1:8080` only, and `tailscale serve` puts HTTPS with a real `*.ts.net` certificate in front of it.

The [Docker setup](self-hosting.md) is shorter and runs anywhere.

| Placeholder | Meaning |
|---|---|
| `<id>` | The Proxmox container ID |
| `<name>` | The container's machine name on your tailnet |
| `<your-tailnet>` | Your tailnet's DNS name, shown on the DNS page of the Tailscale admin console |

All commands inside the container run as root, for example from `pct enter <id>` on the Proxmox host.

## 1. Requirements

- Proxmox VE 8.4 or 9, fully updated. Older `pve-container` releases refuse Debian 13 point releases.
- A Tailscale account with permission to edit the tailnet policy file and generate auth keys (Owner, Admin or Network admin).
- A phone with the Tailscale app: Android with Chrome, or an iPhone with Safari on iOS 17 or later.
- For the container:
  - 1 CPU core.
  - **2 GB of RAM, or 1 GB with the container's default 512 MB of swap kept.** Each login runs scrypt with 128 MiB of memory, and building the web app peaks at about 1 GB.
  - 8 GB of disk.

## 2. Create the container on Proxmox

1. Create a container from the Debian 13 template:
   - Keep **Unprivileged container** checked.
   - Under **Options → Features**, make sure **Nesting** is enabled. systemd needs it to sandbox services. Without it, the Promus service fails with `status=226/NAMESPACE`. From the host shell, `pct set <id> --features nesting=1` sets it, replacing the container's whole features list.
   - Pick a neutral hostname that says nothing about you or the software. Section 4 explains why.
2. Pass `/dev/net/tun` through, so that Tailscale can run in kernel mode. On the Proxmox host, add these two lines to `/etc/pve/lxc/<id>.conf`:

   ```
   lxc.cgroup2.devices.allow: c 10:200 rwm
   lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
   ```

   If the container is running, shut it down and start it again.
3. Inside the container, check that the device is there. `ls -l /dev/net/tun` should list a character device with the numbers `10, 200`.

These lines come from Tailscale's guide for [unprivileged LXC containers](https://tailscale.com/kb/1130/lxc-unprivileged).

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
- `/etc/promus/promus.env` sets `PORT`, `HOST`, `DATA_DIR` and `LOG_LEVEL`. Keep `HOST=127.0.0.1`.
- `DATA_DIR=/var/lib/promus` matches `StateDirectory=promus` in the unit. systemd creates that directory, owned by `promus` with mode `0700`. Apart from its private `/tmp`, it is the only place the sandboxed service can write to. If you change `DATA_DIR`, keep it under `/var/lib/promus`.
- Both units set `UMask=0077`, because the database and its backups hold password and session hashes.
- The service logs JSON lines to the journal. Follow them with `journalctl -u promus -f`.

## 4. Tailscale

### Install it in kernel mode

These are Tailscale's [package instructions](https://pkgs.tailscale.com/stable/#debian-trixie) for Debian 13 (trixie). Don't run `tailscale up` yet.

```sh
mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.noarmor.gpg | tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.tailscale-keyring.list | tee /etc/apt/sources.list.d/tailscale.list
apt update && apt install -y tailscale
```

The package runs `tailscaled` in kernel mode, through the `tailscale0` interface. Keep it that way: `FLAGS` in `/etc/default/tailscaled` must not contain `--tun=userspace-networking`. If `tailscaled` fails because it can't open `/dev/net/tun`, fix the passthrough from section 2. Don't switch to userspace mode.

**Why not userspace mode:** in userspace mode, Tailscale [proxies incoming connections to the same port on `127.0.0.1`](https://tailscale.com/docs/reference/faq/other-vpns). Every service bound only to localhost becomes reachable from the tailnet, including Promus on port 8080 over plain HTTP, bypassing `tailscale serve`.

### Create a tag and a pre-tagged auth key

1. In the admin console, open **Access controls** and add the tag to `tagOwners`. If the section already exists, add only the `tag:promus` line to it.

   ```jsonc
   "tagOwners": {
     "tag:promus": ["autogroup:admin"],
   },
   ```

2. Open the **Keys** page (**Settings → Keys**) and select **Generate auth key**:
   - Leave **Reusable** off. Tailscale revokes a one-off key once it has been used.
   - Leave **Ephemeral** off.
   - Turn on **Tags** and choose `tag:promus`.
   - If your tailnet requires device approval, turn on **Pre-approved**.

A tagged device has no user identity: its access comes only from its tag. Key expiry is disabled by default for tagged devices, so the server doesn't drop off the tailnet after 180 days.

### Pick a neutral name and join

With HTTPS on, the certificate for `<name>.<your-tailnet>.ts.net` is published in public [Certificate Transparency logs](https://tailscale.com/kb/1153/enabling-https), which anyone can search. Pick a machine name that says nothing about you or what runs on it.

```sh
tailscale up --auth-key=tskey-auth-XXXXXXXX --hostname=<name>
ip link show tailscale0
```

`ip link show tailscale0` confirms kernel mode: in userspace mode, that interface doesn't exist. To keep the key out of shell history, write it to a file and pass `--auth-key=file:/root/authkey`, then delete the file.

`/var/lib/tailscale` now holds the node key, which is this machine's identity on your tailnet. Proxmox backups (vzdump) of the container include it, so protect them as you would the container itself.

### Enable MagicDNS and HTTPS

On the **DNS** page of the admin console:
1. Check that MagicDNS is enabled. It's on by default for tailnets created on or after 2022-10-20. Otherwise select **Enable MagicDNS**.
2. Under **HTTPS Certificates**, select **Enable HTTPS**.

### Serve the app

```sh
tailscale serve --bg 8080
tailscale serve status
```

`--bg` keeps the configuration across reboots and restarts of Tailscale. The status should read:

```
https://<name>.<your-tailnet>.ts.net (tailnet only)
|-- / proxy http://127.0.0.1:8080
```

### Check that Funnel is off

Funnel would publish the server to the whole internet. It is off by default. Check it:

```sh
tailscale funnel status
```

Every entry must say `(tailnet only)`, never `Funnel on`.
- If one says `Funnel on`, run `tailscale funnel reset`, which clears the serve configuration as well. Then run `tailscale serve --bg 8080` again.
- Funnel also needs a `funnel` attribute in the policy file's `nodeAttrs`. On this private setup, never add `tag:promus` to its `target`.

### Household members

A machine with a tag can't be [shared](https://tailscale.com/kb/1084/sharing) with another tailnet, so people in your household reach this one in one of two ways:
- **As users of your tailnet:** invite them from the **Users** page of the admin console. With the [access policy](tailscale-policy.md), use `autogroup:self` in its first grant, so they reach only their own devices and Promus.
- **Over the internet:** use Funnel instead of `tailscale serve`, as in the [Funnel setup](self-hosting.md#public-with-tailscale-funnel). For a tagged machine, the policy's `funnel` attribute needs `tag:promus` in its `target`.

## 5. Set up your account

The server prints a one-time setup code to its log while it has no accounts:

```sh
journalctl -u promus | grep 'Setup code'
```

Open `https://<name>.<your-tailnet>.ts.net` and follow the wizard, as in [Set up your account](self-hosting.md#set-up-your-account). A restart prints a new code.

## 6. Install the app on your phone

Install the Tailscale app on the phone and log in to the same tailnet. Then follow [Install the app on your phone](self-hosting.md#install-the-app-on-your-phone), and invite your household from **Settings**.

To lock the tailnet down further, see [Tailscale access policy](tailscale-policy.md). From then on, manage the container from the Proxmox console (`pct enter <id>`), because the tailnet allows only port 443 to it.

## 7. Backups and restore

The `promus-backup.timer` unit runs the backup every night at 03:30, and catches up after downtime.
- Each backup is a complete, consistent copy of the database, written with `VACUUM INTO`. It is saved as `/var/lib/promus/backups/promus-YYYY-MM-DD.db`, named by the UTC date.
- The 14 newest backups are kept.

To run a backup now, and to check when the next one is due:

```sh
systemctl start promus-backup.service
systemctl list-timers promus-backup.timer
```

To keep copies off the machine, copy files from `backups/`, or rely on Proxmox backups (vzdump) of the container on top. Those also contain the Tailscale node key in `/var/lib/tailscale`, so store them accordingly. Never copy the live `promus.db` on its own. Recent changes live in `promus.db-wal` until SQLite folds them in.

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
