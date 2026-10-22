# Self-hosting Promus

This guide installs Promus in an unprivileged Debian 13 container (LXC) on Proxmox VE. Tailscale makes it reachable from your devices and from nowhere else. The server listens on `127.0.0.1:8080` only. `tailscale serve` puts HTTPS with a real `*.ts.net` certificate in front of it. The app needs HTTPS because its service worker and its `Secure` session cookie only work in a secure context.

The Docker alternative is at the end.

Placeholders used below:

| Placeholder | Meaning |
|---|---|
| `<id>` | The Proxmox container ID |
| `<repository-url>` | The Git URL of this repository |
| `<name>` | The container's machine name on your tailnet |
| `<your-tailnet>` | Your tailnet's DNS name, shown on the DNS page of the Tailscale admin console |
| `<username>` | A Promus account name |
| `you@example.com` | The address you log in to Tailscale with |

All commands inside the container run as root, for example from `pct enter <id>` on the Proxmox host.

## 1. Requirements

- Proxmox VE 7 or later.
- A Tailscale account with permission to edit the tailnet policy file and generate auth keys (Owner, Admin or Network admin).
- An Android phone with the Tailscale app and Chrome.
- For the container:
  - 1 CPU core.
  - **At least 1 GB of RAM.** Each login runs scrypt with 128 MiB of memory, and building the web app uses close to 1 GB.
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
git clone <repository-url> /opt/promus
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
curl -fsS http://127.0.0.1:8080/api/health
```

The health check prints `{"status":"ok",...}`.

Notes:
- `/etc/promus/promus.env` sets `PORT`, `HOST`, `DATA_DIR` and `LOG_LEVEL`. Keep `HOST=127.0.0.1`.
- `DATA_DIR=/var/lib/promus` matches `StateDirectory=promus` in the unit. systemd creates that directory, owned by `promus`. Apart from its private `/tmp`, it is the only place the sandboxed service can write to. If you change `DATA_DIR`, keep it under `/var/lib/promus`.
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
- Funnel also needs a `funnel` attribute in the policy file's `nodeAttrs`. Never add `tag:promus` to its `target`.

## 5. Optional: tighten the Tailscale policy

This step isn't required: the app has its own login whatever the network policy is. It limits the damage if a device or the server is ever compromised.

The target policy:
- Your own devices keep reaching each other on every port, as they do under allow-all.
- Your devices reach the server on `tcp:443` only, which is the HTTPS port that `tailscale serve` listens on.
- Home Assistant reaches the server on `tcp:443`, if its device is tagged. A Home Assistant node logged in as a user is already covered by the first two rules.
- The server reaches nothing. No grant has `tag:promus` as `src`. Grants are directional, so letting your devices connect to the server doesn't let the server connect to them. A compromised container can't reach Proxmox or anything else on the tailnet.

### First, list your tagged devices

`autogroup:member` covers only devices logged in as a user. Removing the allow-all rule cuts off every tagged device, such as subnet routers, other servers or a tagged Home Assistant, unless a grant covers it.

List the tagged devices on the **Machines** page of the admin console, or from one of your devices with `jq` installed:

```sh
tailscale status --json | jq -r '.Peer[] | select(.Tags) | "\(.HostName) \(.Tags | join(","))"'
```

For each one, decide what it needs and add a grant for it.

### The policy

Open **Access controls** and change only these parts:
- Remove the allow-all rule. In the default policy it is the `acls` entry `{"action": "accept", "src": ["*"], "dst": ["*:*"]}`. In a policy written with grants it is `{"src": ["*"], "dst": ["*"], "ip": ["*"]}`. `acls` and `grants` can coexist and both apply, so check both.
- Keep your other sections, such as `ssh`, `nodeAttrs` and `groups`, as they are.

Then merge in the following. Replace `you@example.com` with your Tailscale login. If your Home Assistant isn't tagged, remove `tag:homeassistant` everywhere: its `tagOwners` line, its grant, its test and the `tag:homeassistant:8123` entry.

```jsonc
{
  "tagOwners": {
    "tag:promus": ["autogroup:admin"],
    "tag:homeassistant": ["autogroup:admin"],
  },

  "grants": [
    // Your devices reach each other on every port, as before.
    {"src": ["autogroup:member"], "dst": ["autogroup:member"], "ip": ["*"]},
    // Your devices reach Promus over HTTPS only.
    {"src": ["autogroup:member"], "dst": ["tag:promus"], "ip": ["tcp:443"]},
    // A tagged Home Assistant reaches Promus over HTTPS only.
    {"src": ["tag:homeassistant"], "dst": ["tag:promus"], "ip": ["tcp:443"]},
    // Add grants here for the tagged devices you listed above.
    // No grant has tag:promus as src: the server reaches nothing.
  ],

  "tests": [
    {
      "src": "you@example.com",
      "proto": "tcp",
      "accept": ["tag:promus:443", "you@example.com:22"],
      "deny": ["tag:promus:22", "tag:promus:8080"],
    },
    {
      "src": "tag:homeassistant",
      "proto": "tcp",
      "accept": ["tag:promus:443"],
      "deny": ["tag:promus:22"],
    },
    {
      "src": "tag:promus",
      "deny": ["you@example.com:22", "you@example.com:443", "tag:homeassistant:8123"],
    },
  ],
}
```

Tailscale runs the `tests` on every save and rejects the policy if one fails.

The syntax was checked against Tailscale's [policy file syntax](https://tailscale.com/kb/1337/policy-syntax) and [grants syntax](https://tailscale.com/docs/reference/syntax/grants) references:
- `autogroup:member` is valid as both `src` and `dst`.
- A test's `src` takes a user, a group, a tag or a host, not an autogroup. That's why the tests use your login.
- If several people use your tailnet and each should reach only their own devices, use `"dst": ["autogroup:self"]` in the first grant.

Afterwards:
- Open the app on your phone.
- Check that Home Assistant still syncs.
- Check that every tagged device you listed still works.

From now on, manage the container from the Proxmox console (`pct enter <id>`), because the tailnet allows only port 443 to it.

## 6. Create your account

There is no sign-up page. Create accounts on the server, as the `promus` user and with the same `DATA_DIR` as in `/etc/promus/promus.env`:

```sh
cd /opt/promus
runuser -u promus -- env DATA_DIR=/var/lib/promus node apps/server/src/cli.ts user:create <username>
```

- The password prompt is hidden. The password must be at least 8 characters.
- Without a TTY, for example in a script, the CLI reads the password from the first line of stdin.
- The account gets a default list. Its name is in English by default (`--locale en`). Add `--locale sv` for a Swedish name.

To change a password, which also signs that user out on every device:

```sh
runuser -u promus -- env DATA_DIR=/var/lib/promus node apps/server/src/cli.ts user:password <username>
```

## 7. Install the app on your phone

1. Install the Tailscale app on the phone and log in to the same tailnet.
2. In Chrome, open `https://<name>.<your-tailnet>.ts.net` and sign in.
3. Open Chrome's menu and choose **Install app**. On some Chrome versions this is **Add to home screen**, then **Install**.

The installed app works offline. It syncs whenever the phone can reach the server through Tailscale.

## 8. Backups and restore

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

## 9. Updating

```sh
systemctl start promus-backup.service
cd /opt/promus
git pull
npm ci
npm run build -w apps/web
systemctl restart promus
```

- Database migrations run on startup and are forward-only, which is why the backup comes first.
- If a release changes the files in `deploy/`, copy them to `/etc/systemd/system/` again and run `systemctl daemon-reload`.
- Installed apps pick up the new version on their own and offer a reload.

## 10. Alternative: Docker

```sh
git clone <repository-url> promus
cd promus
cp .env.example .env
docker compose up -d --build
docker compose exec promus node apps/server/src/cli.ts user:create <username>
```

How the container is set up:
- `compose.yaml` publishes the app on `127.0.0.1:8080` only.
- Inside the container, the server listens on all interfaces of the container's own network, and keeps its data in the `promus-data` volume at `/data`. `compose.yaml` sets `HOST` and `DATA_DIR` for that, overriding `.env`.
- To use a different host port, change the left side of `ports`, not `PORT`.
- The image runs as the unprivileged `node` user and has a healthcheck on `/api/health`.

Put HTTPS in front, with one of:
- **Tailscale on the Docker host**, in kernel mode as in section 4, followed by `tailscale serve --bg 8080`.
- **A reverse proxy** that terminates TLS and forwards to `http://127.0.0.1:8080`. It must keep the original `Host` header, because the server compares a request's `Origin` with its `Host` to block cross-site requests.

Two warnings:
- **A Tailscale sidecar container defaults to userspace mode.** The official image's `TS_USERSPACE` setting is on by default. As explained in section 4, every port bound to localhost in the shared network namespace then becomes reachable from the tailnet. Use Tailscale on the host instead. If you do use a sidecar, set `TS_USERSPACE=false` and give it `/dev/net/tun` and the capabilities listed in Tailscale's [Docker parameters](https://tailscale.com/docs/features/containers/docker/docker-params).
- **Docker inside a Proxmox LXC is not recommended.** It has broken on Proxmox updates before, and the Proxmox documentation recommends nesting containers inside a VM when isolation matters. On Proxmox, use the LXC setup above, or run Docker in a VM.

Backups, restore and updates:

```sh
# backup (run it from cron or a systemd timer on the host)
docker compose exec -T promus node apps/server/src/cli.ts backup

# restore
docker compose stop promus
docker compose run --rm promus sh -c 'cp /data/backups/promus-YYYY-MM-DD.db /data/promus.db && rm -f /data/promus.db-wal /data/promus.db-shm'
docker compose start promus

# update
git pull
docker compose up -d --build
```
