import { createHash } from 'node:crypto';
import { SHARE_TTL_MS, formatHlc, makeEvent, newId } from '@promus/shared';
import type { Share, SharesResponse } from '@promus/shared';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { createUser } from '../src/users.ts';
import { DAY, SAME_ORIGIN, T0, cookieOf, login, makeTestApp } from './helpers.ts';

const PW = 'correct horse';

async function setup() {
  const lines: string[] = [];
  const t = makeTestApp({ logger: pino({ level: 'info' }, { write: (line: string) => void lines.push(line) }) });
  const anna = await createUser(t.db, { username: 'Anna', password: PW, locale: 'sv', now: T0 });
  const bea = await createUser(t.db, { username: 'Bea', password: PW, locale: 'sv', now: T0 });
  const cookieA = cookieOf(await login(t.app, 'anna', PW));
  const cookieB = cookieOf(await login(t.app, 'bea', PW));
  const send = (method: string, path: string, body?: unknown, cookie = cookieA) =>
    t.app.request(path, {
      method,
      headers: { ...SAME_ORIGIN, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const share = (listId = anna.listId, cookie = cookieA) => send('POST', '/api/shares', { listId }, cookie);
  const shares = async (cookie = cookieA) => (await (await send('GET', '/api/shares', undefined, cookie)).json()) as SharesResponse;
  return { ...t, lines, anna, bea, cookieA, cookieB, send, share, shares };
}

describe('shares', { timeout: 30_000 }, () => {
  it('makes a link for 14 days, keeping its token and hash', async () => {
    const { share, db, anna } = await setup();
    const res = await share();
    expect(res.status).toBe(201);
    const made = (await res.json()) as Share;
    expect(made.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(made.expiresAt).toBe(T0 + 14 * DAY);
    expect(made).toMatchObject({ listId: anna.listId, createdBy: anna.userId });
    const last = (db.prepare('SELECT MAX(seq) AS s FROM events WHERE household_id = ?').get(anna.householdId) as { s: number }).s;
    expect(db.prepare('SELECT * FROM shares WHERE id = ?').get(made.id)).toMatchObject({
      household_id: anna.householdId, list_id: anna.listId, token: made.token, created_at: T0, from_seq: last,
      token_hash: createHash('sha256').update(made.token).digest('hex'), revoked_at: null,
    });
    expect(SHARE_TTL_MS).toBe(14 * DAY);
  });

  it('sharing a shared list again answers the same link', async () => {
    const { share } = await setup();
    const first = (await (await share()).json()) as Share;
    const res = await share();
    expect(res.status).toBe(200);
    const second = (await res.json()) as Share;
    expect([second.id, second.token]).toEqual([first.id, first.token]);
  });

  it('refuses a list that is not the household\'s, or deleted', async () => {
    const t = await setup();
    expect((await t.share(t.bea.listId)).status).toBe(404);
    const missing = await t.share(newId());
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'not_found' });
    const deleted = makeEvent('list.deleted', { listId: t.anna.listId }, {
      householdId: t.anna.householdId, hlc: formatHlc(T0 + 1, 0, 'phone'), occurredAt: T0 + 1,
    });
    expect((await t.send('POST', '/api/sync/push', { events: [deleted] })).status).toBe(200);
    expect((await t.share()).status).toBe(404);
  });

  it('lists live links and every guest the household has had', async () => {
    const t = await setup();
    const made = (await (await t.share()).json()) as Share;
    t.db.prepare("INSERT INTO guests (id, share_id, name, token_hash, created_at) VALUES ('g1', ?, 'Cia', 'h1', ?)").run(made.id, T0);
    expect(await t.shares()).toEqual({ shares: [made], guests: [{ id: 'g1', shareId: made.id, name: 'Cia' }] });
    expect((await t.send('DELETE', `/api/shares/${made.id}`)).status).toBe(204);
    expect(await t.shares()).toEqual({ shares: [], guests: [{ id: 'g1', shareId: made.id, name: 'Cia' }] });
  });

  it('ends a link and brings it back until it expires', async () => {
    const t = await setup();
    const made = (await (await t.share()).json()) as Share;
    const url = `/api/shares/${made.id}`;
    expect((await t.send('DELETE', url)).status).toBe(204);
    expect((await t.shares()).shares).toEqual([]);
    expect((await t.send('POST', `${url}/restore`)).status).toBe(204);
    expect((await t.shares()).shares).toEqual([made]);
    t.setNow(T0 + 14 * DAY);
    expect((await t.shares()).shares).toEqual([]);
    expect((await t.send('DELETE', url)).status).toBe(204);
    const res = await t.send('POST', `${url}/restore`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'share_invalid' });
  });

  it('another household can neither see nor end a link', async () => {
    const t = await setup();
    const made = (await (await t.share()).json()) as Share;
    expect(await t.shares(t.cookieB)).toEqual({ shares: [], guests: [] });
    expect((await t.send('DELETE', `/api/shares/${made.id}`, undefined, t.cookieB)).status).toBe(404);
    expect((await t.send('POST', `/api/shares/${made.id}/restore`, undefined, t.cookieB)).status).toBe(404);
    expect((await t.shares()).shares).toEqual([made]);
  });

  it('needs a signed-in browser', async () => {
    const { send } = await setup();
    expect((await send('POST', '/api/shares', { listId: newId() }, '')).status).toBe(401);
    expect((await send('GET', '/api/shares', undefined, '')).status).toBe(401);
  });

  it('never logs a token', async () => {
    const t = await setup();
    const made = (await (await t.share()).json()) as Share;
    await t.send('DELETE', `/api/shares/${made.id}`);
    await t.send('POST', `/api/shares/${made.id}/restore`);
    expect(t.lines.length).toBeGreaterThan(0);
    expect(t.lines.join('')).not.toContain(made.token);
    expect(t.lines.join('')).toContain('share created');
  });
});
