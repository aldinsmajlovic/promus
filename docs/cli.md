# Server commands

The server CLI is `apps/server/src/cli.ts`, with three commands:

```
user:create <username> [--locale en|sv]
user:password <username>
backup
```

Run it against the server's own database:
- **Docker:** `docker compose exec promus node apps/server/src/cli.ts <command>`
- **systemd install:** run it as the `promus` user, with the service's `DATA_DIR`:

  ```sh
  cd /opt/promus
  runuser -u promus -- env $(grep '^DATA_DIR=' /etc/promus/promus.env) node apps/server/src/cli.ts <command>
  ```

  For a backup, `systemctl start promus-backup.service` does the same.

Without `DATA_DIR`, the CLI uses `./data`, which is a separate database. `user:create` would then create an account the server never sees. `backup` refuses a database that doesn't exist: it exits with `No database at <path>; check DATA_DIR` and creates nothing.

## What the commands do

- **`user:create`** asks for a password of at least 8 characters, on a hidden prompt. Without a TTY, it reads the first line of stdin.
  - It also creates the user's default list.
  - The list's name is English by default (`--locale en`). `--locale sv` gives it a Swedish name.
- **`user:password`** sets a new password and signs that user out on every device.
- **`backup`** writes a consistent copy of the database, as it is, to `DATA_DIR/backups/promus-YYYY-MM-DD.db`, and keeps the 14 newest. It doesn't migrate the database: the server does that on startup.

Restoring a backup is in the self-hosting guide, under [backups and restore](self-hosting.md#8-backups-and-restore).
