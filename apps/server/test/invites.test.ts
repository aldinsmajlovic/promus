import { createHash } from 'node:crypto';
import { formatHlc, makeEvent, newId } from '@promus/shared';
import type { PullResponse, PushResponse } from '@promus/shared';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { createUser } from '../src/users.ts';
import { DAY, SAME_ORIGIN, T0, cookieOf, login, makeTestApp } from './helpers.ts';

const hashes = vi.hoisted(() => ({ n: 0 }));
vi.mock('../src/auth/password.ts', async (load) => {
  const real = await load<typeof import('../src/auth/password.ts')>();
  return {
    ...real,
    hashPassword: (pw: string) => {
      hashes.n++;
      return real.hashPassword(pw);
    },
  };
});

const PW = 'correct horse';
type Created = { id: string; token: string; expiresAt: number };

async function setup() {
  const lines: string[] = [];
  const t = makeTestApp({ logger: pino({ level: 'info' }, { write: (line: string) => void lines.push(line) }) });
  const anna = await createUser(t.db, { username: 'Anna', password: PW, locale: 'sv', now: T0 });
  const cookieA = cookieOf(await login(t.app, 'anna', PW));
  const send = (method: string, path: string, body?: unknown, cookie = '') =>
    t.app.request(path, {
      method,
      headers: { ...SAME_ORIGIN, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const invite = async (cookie = cookieA) => (await (await send('POST', '/api/invites', undefined, cookie)).json()) as Created;
  const check = (token: string) => send('POST', '/api/invites/check', { token });
  const accept = (token: string, username = 'Bo', password = PW) =>
    send('POST', '/api/invites/accept', { token, username, password });
  const me = async (cookie: string) =>
    (await (await t.app.request('/api/me', { headers: { Cookie: cookie } })).json()) as {
      households: { id: string; role: string; members: { username: string; role: string }[] }[];
    };
  return { ...t, lines, anna, cookieA, send, invite, check, accept, me };
}

describe('invites', { timeout: 30_000 }, () => {
  it('stores only the hash of a 43-character token', async () => {
    const { invite, db, anna, send, cookieA } = await setup();
    const res = await send('POST', '/api/invites', undefined, cookieA);
    expect(res.status).toBe(201);
    const { id, token, expiresAt } = (await res.json()) as Created;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expiresAt).toBe(T0 + 7 * DAY);
    const row = db.prepare('SELECT * FROM invites WHERE id = ?').get(id) as Record<string, unknown>;
    expect(row).toMatchObject({
      household_id: anna.householdId, created_by: anna.userId, created_at: T0, expires_at: T0 + 7 * DAY,
      token_hash: createHash('sha256').update(token).digest('hex'), used_at: null, used_by: null, revoked_at: null,
    });
    expect(JSON.stringify(db.prepare('SELECT * FROM invites').all())).not.toContain(token);
    expect((await invite()).token).not.toBe(token);
  });

  it('needs a signed-in browser', async () => {
    const { send } = await setup();
    expect((await send('POST', '/api/invites')).status).toBe(401);
  });

  it('accepting joins the inviter\'s household as a member, with its history', async () => {
    const t = await setup();
    const { token } = await t.invite();
    expect((await t.check(token)).status).toBe(200);
    const events = (n: number) => (t.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n === n;
    expect(events(1)).toBe(true);

    const res = await t.accept(token);
    expect(res.status).toBe(201);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM households').get()).toEqual({ n: 1 });
    // no default list of their own
    expect(events(1)).toBe(true);
    const bo = t.db.prepare("SELECT id FROM users WHERE username = 'Bo'").get() as { id: string };
    expect(t.db.prepare('SELECT used_by FROM invites').get()).toEqual({ used_by: bo.id });

    const cookieB = cookieOf(await login(t.app, 'bo', PW));
    const members = [{ username: 'Anna', role: 'owner' }, { username: 'Bo', role: 'member' }];
    expect(await t.me(t.cookieA)).toEqual(expect.objectContaining({ households: [{ id: t.anna.householdId, role: 'owner', members }] }));
    expect((await t.me(cookieB)).households).toEqual([{ id: t.anna.householdId, role: 'member', members }]);

    const pulled = (await (await t.app.request('/api/sync/pull', { headers: { Cookie: cookieB } })).json()) as PullResponse;
    expect(pulled.events.map((e) => e.type)).toEqual(['list.created']);
    const e = makeEvent('item.created', { itemId: newId(), name: 'Milk' }, {
      householdId: t.anna.householdId, hlc: formatHlc(T0, 0, 'phone'), occurredAt: T0,
    });
    const pushed = (await (await t.send('POST', '/api/sync/push', { events: [e] }, cookieB)).json()) as PushResponse;
    expect(pushed.accepted).toEqual([e.id]);

    const again = await t.accept(token, 'Cia');
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ error: 'invite_invalid' });
  });

  it('a token expires after 7 days', async () => {
    const t = await setup();
    const { token } = await t.invite();
    t.setNow(T0 + 7 * DAY);
    expect((await t.check(token)).status).toBe(200);
    t.setNow(T0 + 7 * DAY + 1);
    for (const res of [await t.check(token), await t.accept(token)]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'invite_invalid' });
    }
  });

  it('revoking is idempotent and only works within your household', async () => {
    const t = await setup();
    const { id, token } = await t.invite();
    await createUser(t.db, { username: 'Eve', password: PW, locale: 'en', now: T0 });
    const cookieE = cookieOf(await login(t.app, 'eve', PW));
    const foreign = await t.send('DELETE', `/api/invites/${id}`, undefined, cookieE);
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: 'not_found' });
    expect((await t.check(token)).status).toBe(200);

    expect((await t.send('DELETE', `/api/invites/${id}`, undefined, t.cookieA)).status).toBe(204);
    expect((await t.send('DELETE', `/api/invites/${id}`, undefined, t.cookieA)).status).toBe(204);
    expect((await t.check(token)).status).toBe(404);
    expect((await t.accept(token)).status).toBe(404);
  });

  it('refuses an unknown token before hashing', async () => {
    const t = await setup();
    const before = hashes.n;
    const res = await t.accept('x'.repeat(43));
    expect(res.status).toBe(404);
    expect(hashes.n).toBe(before);
    expect((await t.send('POST', '/api/invites/accept', { token: '', username: 'Bo', password: PW })).status).toBe(400);
  });

  it('a taken name leaves the invite usable', async () => {
    const t = await setup();
    const { token } = await t.invite();
    const taken = await t.accept(token, ' anna ');
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: 'username_taken' });
    const short = await t.accept(token, 'Bo', '1234567');
    expect(short.status).toBe(400);
    expect(await short.json()).toEqual({ error: 'password_too_short' });
    expect((await t.accept(token, 'Bo')).status).toBe(201);
  });

  it('never logs a token', async () => {
    const t = await setup();
    const { token } = await t.invite();
    await t.check(token);
    await t.accept(token);
    expect(t.lines.length).toBeGreaterThan(0);
    expect(t.lines.join('')).not.toContain(token);
  });
});
