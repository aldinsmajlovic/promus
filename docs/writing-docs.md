# Writing docs

## Docs

A change is not done until the docs say it exists. In the same commit as the code:

- **The topic page** that owns the subject gets the detail. A new subject gets its own page.
- **`docs/plan.md`** (or the equivalent) gets status, dates, test results and measurements. Never the README.
- **`docs/decisions.md`** gets one line for any change from the plan: date, what, why.
- **Screenshots** in `docs/images/` are retaken, light and dark, for any visible UI change.

Before committing, read the README top to bottom once and ask: would someone cloning today be
surprised by anything? Remove what is no longer true. Stale lines are worse than missing ones.

## The README is a front page, not a changelog

It answers what the project is, what it looks like, how to start it, and where to read more.
Anything longer than a line or two goes to a page in `docs/` and the README links to it.

- Contents: pitch, one screenshot, about eight features, status in two lines, quickstart, links.
- Touch it only when the change alters what the project is at a glance: a new capability area,
  a new requirement, a quickstart step, a status change. Most changes belong on their topic page alone.
- The feature list stays at about eight lines, one or two sentences each, about what the user gets.
  A new feature is folded into an existing line or replaces a weaker one. Never append a bullet.
- No implementation detail: no timings, config keys, dates, test names, or how something works inside.
- When you edit it, reread the whole file and rewrite it as one page, the way a well-kept open
  source README reads. Not a log of what was added last.

## Where things go

- One subject per page. A subject that outgrows its section gets its own page in `docs/`, linked
  from the README and from the page it left.
- Prefer several short pages over one long one.
- Keep a short table of page and what it owns, so new detail has an obvious home.

| Page | Owns |
|---|---|
| `README.md` | The front page |
| `docs/self-hosting.md` | Installing with Docker, what HTTPS in front needs, setup, the phone, invites, shared lists, backups, restore, updating |
| `docs/proxmox.md` | The systemd install, in a Proxmox LXC container |
| `docs/configuration.md` | Environment variables |
| `docs/cli.md` | Server commands: accounts and backups |
| `docs/development.md` | Running locally, checks, phone testing, releasing, project layout |
| `docs/decisions.md` | Changes from the plan, with the why |
| `docs/images/` | Screenshots, retaken with `npm run screenshots` |
| `docs/writing-docs.md` | These rules |
| `CLAUDE.md` | Code conventions for changes |

## Style

- Short. Say what it does and how to use it. The why goes in `decisions.md`.
- Plain words, first-hand tone. Numbers that were measured, not adjectives.
- Headings in sentence case.
- Code blocks only for things someone types or pastes.
- Examples use made-up values. Personal data never goes in code, docs, examples or screenshots.

## Not looking machine-written

- No em dashes anywhere. Use a comma, colon, parentheses or a new sentence. `npm run lint` enforces it.
- No emoji in prose, headings or bullets. No icons drawn from Unicode or emoji.
- No intros that restate the heading, no closing summaries, no "Overview", "Introduction" or
  "Conclusion" sections.
- No hype words: comprehensive, robust, seamless, powerful, blazing fast, cutting-edge, leverage,
  utilize, delve, streamline, effortless.
- No throat-clearing: "It's worth noting", "In order to", "Simply", "Let's dive in",
  "Whether you're X or Y".
- No padding in threes ("fast, simple and reliable") unless each one is true and measured.
- No "Note:" or "Tip:" callouts for what is just the next sentence.
- Bullets for lists, sentences for explanations.

## Pictures

- Screenshots over descriptions. Keep them in `docs/images/`, taken at one fixed size in both
  themes and cropped to the content. Show them with `<picture>` so GitHub picks light or dark:

  ```html
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/home-dark.png">
    <img src="docs/images/home-light.png" alt="The home page" width="720">
  </picture>
  ```

  Take them with Playwright against a running instance seeded with fake data, never real data.
- Diagrams in Mermaid, never ASCII art. One idea per diagram, under about a dozen nodes.
- Badges from shields.io. Use the project's own logo once it exists.
