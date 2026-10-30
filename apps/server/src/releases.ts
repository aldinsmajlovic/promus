import type { Release } from '@promus/shared';
import { z } from 'zod';
import pkg from '../../../package.json' with { type: 'json' };
import type { Logger } from './log.ts';

const DAY = 86_400_000;
const REPO = new URL(pkg.repository.url).pathname.slice(1);
const githubReleases = z.array(z.object({ tag_name: z.string(), body: z.string().nullable() }));

const parts = (version: string) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version)?.slice(1).map(Number);

/** Whether `version` comes after `than`; a version not shaped x.y.z never does. */
export function isNewer(version: string, than: string): boolean {
  const a = parts(version);
  const b = parts(than);
  if (!a || !b) return false;
  const i = a.findIndex((n, j) => n !== b[j]);
  return i !== -1 && a[i]! > b[i]!;
}

/** A changelog section's bullets: English above `### Svenska`, Swedish below it, English for both without it. */
export function releaseNotes(body: string): Release['notes'] {
  const [en = '', sv = en] = body.split(/^### Svenska\s*$/m);
  const bullets = (part: string) =>
    part.split('\n').filter((line) => line.startsWith('- ')).map((line) => line.slice(2).trim());
  return { en: bullets(en), sv: bullets(sv) };
}

/** The releases after `current`, newest first, asked of GitHub at most once a day. Never rejects. */
export function releaseChecker(opts: {
  logger: Logger;
  now: () => number;
  fetch?: typeof globalThis.fetch;
  current?: string;
}): () => Promise<Release[]> {
  const { logger, now, fetch = globalThis.fetch, current = pkg.version } = opts;
  let last: { at: number; releases: Promise<Release[]> } | undefined;

  async function check(): Promise<Release[]> {
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'promus' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
      return githubReleases
        .parse(await res.json())
        .filter((r) => isNewer(r.tag_name, current))
        .map((r) => ({ version: r.tag_name.replace(/^v/, ''), notes: releaseNotes(r.body ?? '') }))
        .sort((a, b) => (isNewer(a.version, b.version) ? -1 : 1));
    } catch (err) {
      // offline, or GitHub is down or rate-limited: no notice until tomorrow's try
      logger.warn({ err }, 'update check failed');
      return [];
    }
  }

  return () => {
    if (!last || now() - last.at >= DAY) last = { at: now(), releases: check() };
    return last.releases;
  };
}
