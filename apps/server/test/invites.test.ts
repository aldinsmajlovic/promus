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
  const invite = async (cookie = cookieA, body?: unknown) => (await (await send('POST', '/api/invites', body, cookie)).json()) as Created;
  const check = (token: string) => send('POST', '/api/invites/check', { token });
  const accept = (token: string, username = 'Bo', password = PW, locale?: string) =>
    send('POST', '/api/invites/accept', { token, username, password, locale });
  const me = async (cookie: string) =>
    (await (await t.app.request('/api/me', { headers: { Cookie: cookie } })).json()) as {
      households: { id: string; role: string; members: { id: string; username: string; role: string; former: boolean }[] }[];
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
    const members = [{ id: t.anna.userId, username: 'Anna', role: 'owner', former: false }, { id: bo.id, username: 'Bo', role: 'member', former: false }];
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

  it('check names who sent the invite', async () => {
    const t = await setup();
    const { token } = await t.invite();
    const res = await t.check(token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ expiresAt: T0 + 7 * DAY, invitedBy: 'Anna', ownHousehold: false });
  });

  it('an own-household invite gives the new account a household and list of its own', async () => {
    const t = await setup();
    const { id, token } = await t.invite(t.cookieA, { ownHousehold: true });
    expect(await (await t.check(token)).json()).toEqual({ expiresAt: T0 + 7 * DAY, invitedBy: 'Anna', ownHousehold: true });
    // the inviter's household, so the inviter can revoke it
    expect(t.db.prepare('SELECT household_id, own_household FROM invites WHERE id = ?').get(id))
      .toEqual({ household_id: t.anna.householdId, own_household: 1 });

    expect((await t.accept(token, 'Bo', PW, 'sv')).status).toBe(201);
    const bo = t.db.prepare("SELECT id FROM users WHERE username = 'Bo'").get() as { id: string };
    const cookieB = cookieOf(await login(t.app, 'bo', PW));
    const { households } = await t.me(cookieB);
    expect(households).toEqual([{ id: expect.any(String), role: 'owner', members: [{ id: bo.id, username: 'Bo', role: 'owner', former: false }] }]);
    expect(households[0]!.id).not.toBe(t.anna.householdId);
    expect((await t.me(t.cookieA)).households[0]!.members).toEqual([{ id: t.anna.userId, username: 'Anna', role: 'owner', former: false }]);

    const pulled = (await (await t.app.request('/api/sync/pull', { headers: { Cookie: cookieB } })).json()) as PullResponse;
    expect(pulled.events.map((e) => [e.type, e.householdId, (e.payload as { name: string }).name]))
      .toEqual([['list.created', households[0]!.id, 'Inköpslista']]);
    expect((await t.accept(token, 'Cia')).status).toBe(404);
  });

  it('an own-household invite names the list in English without a locale', async () => {
    const t = await setup();
    const { token } = await t.invite(t.cookieA, { ownHousehold: true });
    expect((await t.accept(token)).status).toBe(201);
    const cookieB = cookieOf(await login(t.app, 'bo', PW));
    const pulled = (await (await t.app.request('/api/sync/pull', { headers: { Cookie: cookieB } })).json()) as PullResponse;
    expect(pulled.events.map((e) => (e.payload as { name: string }).name)).toEqual(['Shopping list']);
  });

  it('refuses an invite request it can\'t read', async () => {
    const t = await setup();
    for (const body of [{ ownHousehold: 'yes' }, 'x']) {
      const res = await t.send('POST', '/api/invites', body, t.cookieA);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_request' });
    }
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

  describe('a former member', () => {
    async function removedBo() {
      const t = await setup();
      expect((await t.accept((await t.invite()).token)).status).toBe(201);
      const boId = (t.db.prepare("SELECT id FROM users WHERE username = 'Bo'").get() as { id: string }).id;
      const cookieB = cookieOf(await login(t.app, 'bo', PW));
      const householdInvite = await t.invite(cookieB);
      const ownInvite = await t.invite(cookieB, { ownHousehold: true });
      const setRemoved = (at: number | null) =>
        t.db.prepare('UPDATE household_members SET removed_at = ?, removed_by = ? WHERE user_id = ?').run(at, at === null ? null : t.anna.userId, boId);
      return { ...t, boId, cookieB, householdInvite, ownInvite, setRemoved };
    }

    it('signs in to no household, and their session sees none', async () => {
      const t = await removedBo();
      t.setRemoved(T0);
      const res = await login(t.app, 'bo', PW);
      expect(((await res.json()) as { householdId: string | null }).householdId).toBeNull();
      expect((await t.me(t.cookieB)).households).toEqual([]);
    });

    it('is listed on /me, marked', async () => {
      const t = await removedBo();
      t.setRemoved(T0);
      expect((await t.me(t.cookieA)).households[0]!.members).toEqual([
        { id: t.anna.userId, username: 'Anna', role: 'owner', former: false },
        { id: t.boId, username: 'Bo', role: 'member', former: true },
      ]);
    });

    it("has invites that stop working, and work again once they're back", async () => {
      const t = await removedBo();
      t.setRemoved(T0);
      expect((await t.check(t.householdInvite.token)).status).toBe(404);
      expect((await t.check(t.ownInvite.token)).status).toBe(404);
      t.setRemoved(null);
      expect((await t.check(t.householdInvite.token)).status).toBe(200);
    });
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
