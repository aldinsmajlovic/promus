# Configuration

Configuration comes only from environment variables. [`.env.example`](../.env.example) lists them with comments.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | TCP port to listen on |
| `HOST` | `127.0.0.1` | Address to bind |
| `DATA_DIR` | `./data` | Database (`promus.db`) and `backups/` |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |

Keep `HOST` at `127.0.0.1` and put HTTPS in front, with `tailscale funnel`, `tailscale serve` or a reverse proxy. The [self-hosting guide](self-hosting.md#put-https-in-front) covers all three. On [Proxmox](proxmox.md), `.env.example` becomes `/etc/promus/promus.env`.

In Docker, the image sets `HOST=0.0.0.0` and `DATA_DIR=/data` itself, so the server listens inside the container and keeps its data on the volume. Nothing else needs setting. To use a different host port, change the left side of `-p` or `ports`, not `PORT`. To set `LOG_LEVEL`, pass `-e LOG_LEVEL=debug` to `docker run`, or add it under `environment:` in `compose.yaml`.
