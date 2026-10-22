# Decisions

What changed from the original plan, and why. Newest first, one line each.

- **2026-10-22, exposing the server is the maintainer's job.** The docs say what Promus needs in front of it (HTTPS, the `Host` header kept) and give one reverse proxy example, but no longer walk through Tailscale. How a server is reached is the maintainer's choice, and Promus shouldn't carry one network product's setup. This replaces the Funnel-first quick start below.

- **2026-10-22, Docker first.** A prebuilt image for amd64 and arm64 is the main install, and the Proxmox LXC setup becomes the advanced one. Installing needs no clone and no build, and runs on any machine with Docker.
- **2026-10-22, setup wizard.** The first account comes from a setup wizard in the browser instead of only from the CLI. It asks for a one-time code from the server's log, so a fresh public server can't be claimed by whoever finds it first.
- **2026-10-22, household members.** Households can have several members, who join with an invite link. Before, sharing a list meant sharing a login.
- **2026-10-22, public servers.** The server may be reachable from the internet, through Tailscale Funnel or a reverse proxy, and the quick start leads with Funnel. It's the only setup where other phones need nothing but the app.
- **2026-10-22, iPhone.** iPhones with Safari are supported, with the app on the Home Screen. Anyone should be able to use it, not only Android owners.
- **2026-10-22, docs links in the app.** The app links to its own docs on GitHub, at the running version's tag, and the `CLAUDE.md` rule against URLs in code now covers configuration only. A link helps someone stuck on HTTPS more than naming the guide does.
