# Configuration

Configuration comes only from environment variables. [`.env.example`](../.env.example) lists them with comments.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | TCP port to listen on |
| `HOST` | `127.0.0.1` | Address to bind |
| `DATA_DIR` | `./data` | Database (`promus.db`) and `backups/` |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |

Keep `HOST` at `127.0.0.1` and put HTTPS in front, with `tailscale serve` or a reverse proxy. The [self-hosting guide](self-hosting.md) covers both.

In Docker, `compose.yaml` sets `HOST` and `DATA_DIR` itself, overriding `.env`. To use a different host port, change the left side of `ports`, not `PORT`.
