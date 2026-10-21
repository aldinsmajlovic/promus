import { formatHlc, makeEvent, newId } from '@promus/shared';
import type { EventInput, PullResponse, PushResponse } from '@promus/shared';
import { describe, expect, it } from 'vitest';
import { createSession } from '../src/auth/sessions.ts';
import { createUser } from '../src/users.ts';
import { SAME_ORIGIN, T0, cookieOf, login, makeTestApp } from './helpers.ts';

const pushed = async (res: Response) => (await res.json()) as PushResponse;
const PW = 'correct horse';
const MIN = 60_000;

async function setup() {
  const t = makeTestApp();
  const a = await createUser(t.db, { username: 'Aldin', password: PW, locale: 'sv', now: T0 });
  const b = await createUser(t.db, { username: 'Bea', password: PW, locale: 'en', now: T0 });
  const cookieA = cookieOf(await login(t.app, 'aldin', PW));
  const cookieB = cookieOf(await login(t.app, 'bea', PW));
  const headers = (cookie: string) => ({ ...SAME_ORIGIN, Cookie: cookie, 'Content-Type': 'application/json' });
  const push = (cookie: string, body: unknown, raw = false) =>
    t.app.request('/api/sync/push', {
      method: 'POST',
      headers: headers(cookie),
      body: raw ? (body as string) : JSON.stringify(body),
    });
  const pull = (cookie: string, qs = '') =>
    t.app.request(`/api/sync/pull${qs}`, { headers: { ...SAME_ORIGIN, Cookie: cookie } });
  const ev = (householdId: string, wall = T0, counter = 0): EventInput =>
    makeEvent('item.created', { itemId: newId(), name: 'Milk' }, {
      householdId,
      hlc: formatHlc(wall, counter, 'phone'),
      occurredAt: wall,
    });
  return { ...t, a, b, cookieA, cookieB, push, pull, ev };
}

describe('sync routes', { timeout: 30_000 }, () => {
  it('stores a valid batch with user and session from the login', async () => {
    const { a, cookieA, push, db, ev, setNow } = await setup();
    setNow(T0 + 5);
    const e = ev(a.householdId);
    const res = await push(cookieA, { events: [e, e] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: [e.id], rejected: [], serverTime: T0 + 5 } satisfies PushResponse);
    const row = db.prepare('SELECT * FROM events WHERE id = ?').get(e.id) as Record<string, unknown>;
    const session = db.prepare('SELECT id FROM sessions WHERE user_id = ?').get(a.userId) as { id: string };
    expect(row).toMatchObject({ user_id: a.userId, session_id: session.id, received_at: T0 + 5, household_id: a.householdId });
    expect(JSON.parse(row.payload as string)).toEqual(e.payload);
  });

  it('pushing the same batch twice stores each event once', async () => {
    const { a, cookieA, push, db, ev } = await setup();
    const events = [ev(a.householdId), ev(a.householdId)];
    const first = await pushed(await push(cookieA, { events }));
    const second = await pushed(await push(cookieA, { events }));
    expect(second.accepted).toEqual(events.map((e) => e.id));
    expect(second).toEqual(first);
    expect(db.prepare('SELECT COUNT(*) AS n FROM events WHERE id IN (?, ?)').get(events[0]!.id, events[1]!.id)).toEqual({ n: 2 });
  });

  it('stores valid events and rejects invalid ones in the same batch', async () => {
    const { a, cookieA, push, ev, db } = await setup();
    const good = ev(a.householdId);
    const bad = { ...ev(a.householdId), type: 'nope' };
    const res = await pushed(await push(cookieA, { events: [bad, good, 42] }));
    expect(res.accepted).toEqual([good.id]);
    expect(res.rejected).toHaveLength(2);
    expect(res.rejected[0]).toMatchObject({ id: bad.id, code: 'invalid' });
    expect(res.rejected[1]).toMatchObject({ id: null, code: 'invalid' });
    for (const r of res.rejected) expect(r.message.length).toBeLessThanOrEqual(200);
    expect(db.prepare('SELECT id FROM events WHERE id = ?').get(bad.id)).toBeUndefined();
  });

  it('rejects more than 500 events and bodies over 1 MB', async () => {
    const { a, cookieA, push, ev } = await setup();
    const e = ev(a.householdId);
    expect((await push(cookieA, { events: Array<EventInput>(501).fill(e) })).status).toBe(400);
    expect((await push(cookieA, { events: [] })).status).toBe(400);
    expect((await push(cookieA, { events: 'x' })).status).toBe(400);
    const malformed = await push(cookieA, '{nope', true);
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'invalid_request' });
    const big = await push(cookieA, JSON.stringify({ events: [e], pad: 'x'.repeat(1_000_001) }), true);
    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ error: 'payload_too_large' });
  });

  it('rejects events for another household', async () => {
    const { a, b, cookieA, cookieB, push, ev, db } = await setup();
    const toB = ev(b.householdId);
    const toA = ev(a.householdId);
    const resA = await pushed(await push(cookieA, { events: [toB] }));
    const resB = await pushed(await push(cookieB, { events: [toA] }));
    expect(resA.rejected).toMatchObject([{ id: toB.id, code: 'forbidden_household' }]);
    expect(resB.rejected).toMatchObject([{ id: toA.id, code: 'forbidden_household' }]);
    expect(resA.accepted).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM events WHERE id IN (?, ?)').get(toA.id, toB.id)).toEqual({ n: 0 });
  });

  it('rejects events more than one hour in the future', async () => {
    const { a, cookieA, push, ev } = await setup();
    const late = ev(a.householdId, T0 + 61 * MIN);
    const ok = ev(a.householdId, T0 + 59 * MIN);
    const res = await pushed(await push(cookieA, { events: [late, ok] }));
    expect(res.accepted).toEqual([ok.id]);
    expect(res.rejected).toMatchObject([{ id: late.id, code: 'clock_skew' }]);
  });

  it('pages through events in order without gaps', async () => {
    const { a, cookieA, push, pull, ev } = await setup();
    await push(cookieA, { events: Array.from({ length: 5 }, (_, i) => ev(a.householdId, T0, i)) });
    const seen: PullResponse['events'] = [];
    let after = 0;
    let pages = 0;
    for (;;) {
      const page = (await (await pull(cookieA, `?after=${after}&limit=2`)).json()) as PullResponse;
      pages++;
      seen.push(...page.events);
      expect(page.lastSeq).toBe(page.events.at(-1)?.seq ?? after);
      after = page.lastSeq;
      if (!page.hasMore) break;
    }
    // the signup list.created event plus 5 pushed
    expect(seen).toHaveLength(6);
    expect(pages).toBe(3);
    expect(seen.map((e) => e.seq)).toEqual([...seen.map((e) => e.seq)].sort((x, y) => x - y));
    expect(new Set(seen.map((e) => e.seq)).size).toBe(6);
    expect(seen[0]).toMatchObject({ type: 'list.created', userId: a.userId, receivedAt: T0 });
    expect(seen[0]).not.toHaveProperty('undoOf');
    expect(seen[0]).not.toHaveProperty('sessionId');
    expect(seen[0]).not.toHaveProperty('session_id');
    const empty = (await (await pull(cookieA, `?after=${after}`)).json()) as PullResponse;
    expect(empty).toMatchObject({ events: [], lastSeq: after, hasMore: false });
  });

  it("pull only returns the caller's households", async () => {
    const { a, b, cookieA, cookieB, pull } = await setup();
    const resA = (await (await pull(cookieA)).json()) as PullResponse;
    const resB = (await (await pull(cookieB)).json()) as PullResponse;
    expect(resA.events.map((e) => e.householdId)).toEqual([a.householdId]);
    expect(resB.events.map((e) => e.householdId)).toEqual([b.householdId]);
    for (const qs of ['?after=-1', '?limit=0', '?limit=501', '?after=x', '?limit=1.5']) {
      expect((await pull(cookieA, qs)).status).toBe(400);
    }
  });

  it('api sessions cannot sync', async () => {
    const { a, app, db, push: _p } = await setup();
    const { token } = createSession(db, { userId: a.userId, kind: 'api', name: 'cli', scopes: [], now: T0 });
    const headers = { Host: 'promus.test', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    expect((await app.request('/api/sync/pull', { headers })).status).toBe(403);
    expect((await app.request('/api/sync/push', { method: 'POST', headers, body: '{"events":[]}' })).status).toBe(403);
  });

  it('push is CSRF-checked', async () => {
    const { a, app, cookieA, ev } = await setup();
    const res = await app.request('/api/sync/push', {
      method: 'POST',
      headers: { Host: 'promus.test', Origin: 'https://evil.test', 'Sec-Fetch-Site': 'cross-site', Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [ev(a.householdId)] }),
    });
    expect(res.status).toBe(403);
  });
});
