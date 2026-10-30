import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/log.ts';
import { isNewer, releaseChecker, releaseNotes } from '../src/releases.ts';
import { DAY, T0 } from './helpers.ts';

const github = (releases: { tag_name: string; body: string | null }[]) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(releases)));

describe('releases', () => {
  it('compares versions by number, not as text', () => {
    expect(isNewer('0.10.0', '0.9.1')).toBe(true);
    expect(isNewer('v0.6.2', '0.6.1')).toBe(true);
    expect(isNewer('0.6.1', '0.6.1')).toBe(false);
    expect(isNewer('0.5.9', '0.6.1')).toBe(false);
    expect(isNewer('0.7.0-rc.1', '0.6.1')).toBe(false);
  });

  it("reads a section's bullets per language, English for both without a Swedish part", () => {
    const body = 'Intro\n- Prices on items\n- Undo works offline\r\n\n### Svenska\n\n- Priser på varor\n';
    expect(releaseNotes(body)).toEqual({ en: ['Prices on items', 'Undo works offline'], sv: ['Priser på varor'] });
    expect(releaseNotes('- Faster sync')).toEqual({ en: ['Faster sync'], sv: ['Faster sync'] });
  });

  it('answers the newer releases, newest first, and asks GitHub at most once a day', async () => {
    const fetch = github([
      { tag_name: 'v0.7.0', body: '- B' },
      { tag_name: 'v0.8.0', body: '- C' },
      { tag_name: 'v0.6.1', body: '- A' },
    ]);
    let now = T0;
    const releases = releaseChecker({ logger: createLogger('silent'), now: () => now, fetch, current: '0.6.1' });

    expect((await releases()).map((r) => r.version)).toEqual(['0.8.0', '0.7.0']);
    await releases();
    expect(fetch).toHaveBeenCalledTimes(1);
    now += DAY;
    await releases();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('answers none when GitHub fails', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('', { status: 403 }));
    const releases = releaseChecker({ logger: createLogger('silent'), now: () => T0, fetch, current: '0.6.1' });
    expect(await releases()).toEqual([]);
  });
});
