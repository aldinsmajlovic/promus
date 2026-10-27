# Decisions

What changed from the original plan, and why. Newest first, one line each.

- **2026-10-26, guests start from the moment of sharing.** A guest gets the list as it is when shared, and everything after, not its history or the household's other items. The server folds the household's events to work that out; until now it only stored and relayed them.
- **2026-10-26, guests.** A guest is a name, or "Guest", tied to one link and one phone, not an account. A link takes at most 50 guests instead of a rate limit on tries: its 256 random bits can't be guessed anyway, and a limit on tries would let anyone block new guests.
- **2026-10-26, sharing a list.** Any household member can share one list by a link that works for 14 days, for people without an account. The server keeps the link itself, not only its hash, so any member can show it again: anyone who can read the database already has the lists.
- **2026-10-26, the empty list.** A basket in a tinted circle, "Nothing on Shopping list yet" and a pointer to Add or find, instead of one grey sentence. A new list looked dead rather than ready to fill.
- **2026-10-26, Settings as rows that lead to pages.** Your account and the household each get a page, and theme and language change in place. More to explore, less on screen at once.
- **2026-10-26, computer layout.** On a computer the list and an always-open Add or find sit side by side under the band, so items can be typed one after another and seen landing. Tablets held upright get the phone layout in a centered column.
- **2026-10-26, Add or find is the search.** Typing finds items already on the list, and they check off right there. The owner asked for search, and this covers it without a second field.
- **2026-10-26, gestures.** Long-press (or right-click) opens an item's options and swiping left removes it, instead of a ⋮ on every row. Left, because that's where both platforms put delete.
- **2026-10-26, Add or find.** A field docked at the bottom of the list replaces the Add button.
- **2026-10-26, Done starts open.** A checked row is seen landing there. Folding it away is remembered on each device.
- **2026-10-26, faces.** The band shows who shares the list, and a row shows who added it when that wasn't you. Before, nothing showed the household.
- **2026-10-26, the list menu.** Lists are switched and made from the list name, and renamed or deleted with a long-press there, instead of a ⋮ in the toolbar that looked like every row's.
- **2026-10-26, sync status on your initial.** A badge with the unsynced count, or "!", instead of a sync icon in the toolbar. Subtle, because an unsynced list is expected sometimes.
- **2026-10-26, own look.** Promus has its own colors, from the green `#3F6B21`, and its screens are a deep green band with a sheet over its lower edge. Titles are in Fraunces and everything else in Bricolage Grotesque, instead of Material's baseline green and Roboto. The app read as a template, not as an app of its own.
- **2026-10-26, member ids and the inviter's name.** `/api/me` lists each member's id, and checking an invite answers with who sent it. The redesigned list shows a face per member, matched by id to who made each change, and the join page says whose household you're joining.

- **2026-10-22, exposing the server is the maintainer's job.** The docs say what Promus needs in front of it (HTTPS, the `Host` header kept) and give one reverse proxy example, but no longer walk through Tailscale. How a server is reached is the maintainer's choice, and Promus shouldn't carry one network product's setup. This replaces the Funnel-first quick start below.

- **2026-10-22, Docker first.** A prebuilt image for amd64 and arm64 is the main install, and the Proxmox LXC setup becomes the advanced one. Installing needs no clone and no build, and runs on any machine with Docker.
- **2026-10-22, setup wizard.** The first account comes from a setup wizard in the browser instead of only from the CLI. It asks for a one-time code from the server's log, so a fresh public server can't be claimed by whoever finds it first.
- **2026-10-22, household members.** Households can have several members, who join with an invite link. Before, sharing a list meant sharing a login.
- **2026-10-22, public servers.** The server may be reachable from the internet, through Tailscale Funnel or a reverse proxy, and the quick start leads with Funnel. It's the only setup where other phones need nothing but the app.
- **2026-10-22, iPhone.** iPhones with Safari are supported, with the app on the Home Screen. Anyone should be able to use it, not only Android owners.
- **2026-10-22, docs links in the app.** The app links to its own docs on GitHub, at the running version's tag, and the `CLAUDE.md` rule against URLs in code now covers configuration only. A link helps someone stuck on HTTPS more than naming the guide does.
