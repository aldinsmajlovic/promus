import { formatHlc, makeEvent, newId } from '@promus/shared';
import type { PushResponse } from '@promus/shared';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { createUser } from '../src/users.ts';
import { SAME_ORIGIN, T0, cookieOf, login, makeTestApp } from './helpers.ts';

const PW = 'correct horse';
type Me = { households: { id: string }[] };

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
  const join = async (username: string) => {
    const { token } = (await (await send('POST', '/api/invites', undefined, cookieA)).json()) as { token: string };
    await send('POST', '/api/invites/accept', { token, username, password: PW });
    const id = (t.db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: string }).id;
    return { id, cookie: cookieOf(await login(t.app, username.toLowerCase(), PW)) };
  };
  const bo = await join('Bo');
  const cy = await join('Cy');
  const h = anna.householdId;
  const remove = (who: string, cookie: string) => send('DELETE', `/api/households/${h}/members/${who}`, undefined, cookie);
  const restore = (who: string, cookie: string) => send('POST', `/api/households/${h}/members/${who}/restore`, undefined, cookie);
  const me = async (cookie: string) => (await (await t.app.request('/api/me', { headers: { Cookie: cookie } })).json()) as Me;
  const push = async (householdId: string, cookie: string) => {
    const e = makeEvent('item.created', { itemId: newId(), name: 'Milk' }, { householdId, hlc: formatHlc(T0, 0, 'phone'), occurredAt: T0 });
    return (await (await send('POST', '/api/sync/push', { events: [e] }, cookie)).json()) as PushResponse;
  };
  const member = (id: string, household = h) =>
    t.db.prepare('SELECT removed_at, removed_by FROM household_members WHERE household_id = ? AND user_id = ?').get(household, id);
  return { ...t, lines, anna, cookieA, send, bo, cy, h, remove, restore, me, push, member };
}

describe('removing and restoring members', { timeout: 30_000 }, () => {
  it('the owner removes a member, who is out at once', async () => {
    const t = await setup();
    expect((await t.remove(t.bo.id, t.cookieA)).status).toBe(204);
    expect(t.member(t.bo.id)).toEqual({ removed_at: T0, removed_by: t.anna.userId });
    expect((await t.me(t.bo.cookie)).households).toEqual([]);
    expect((await t.push(t.h, t.bo.cookie)).rejected.map((r) => r.code)).toEqual(['forbidden_household']);
  });

  it('a member leaves', async () => {
    const t = await setup();
    expect((await t.remove(t.bo.id, t.bo.cookie)).status).toBe(204);
    expect(t.member(t.bo.id)).toEqual({ removed_at: T0, removed_by: t.bo.id });
  });

  it("a member can't remove another", async () => {
    const t = await setup();
    const res = await t.remove(t.cy.id, t.bo.cookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(t.member(t.cy.id)).toEqual({ removed_at: null, removed_by: null });
  });

  it('nobody removes the owner', async () => {
    const t = await setup();
    expect((await t.remove(t.anna.userId, t.cookieA)).status).toBe(403);
    expect((await t.remove(t.anna.userId, t.bo.cookie)).status).toBe(403);
    expect(t.member(t.anna.userId)).toEqual({ removed_at: null, removed_by: null });
  });

  it('removing twice is not found', async () => {
    const t = await setup();
    await t.remove(t.bo.id, t.cookieA);
    const res = await t.remove(t.bo.id, t.cookieA);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('restoring someone who is not removed is not found', async () => {
    const t = await setup();
    expect((await t.restore(t.bo.id, t.cookieA)).status).toBe(404);
  });

  it('the owner restores', async () => {
    const t = await setup();
    await t.remove(t.bo.id, t.cookieA);
    expect((await t.restore(t.bo.id, t.cookieA)).status).toBe(204);
    expect(t.member(t.bo.id)).toEqual({ removed_at: null, removed_by: null });
    expect((await t.me(t.bo.cookie)).households.map((x) => x.id)).toEqual([t.h]);
  });

  it('the one who left restores their own leave', async () => {
    const t = await setup();
    await t.remove(t.bo.id, t.bo.cookie);
    expect((await t.restore(t.bo.id, t.bo.cookie)).status).toBe(204);
    expect((await t.me(t.bo.cookie)).households.map((x) => x.id)).toEqual([t.h]);
  });

  it("someone the owner removed can't put themself back", async () => {
    const t = await setup();
    await t.remove(t.bo.id, t.cookieA);
    expect((await t.restore(t.bo.id, t.bo.cookie)).status).toBe(403);
    expect((await t.restore(t.bo.id, t.cy.cookie)).status).toBe(403);
    expect((await t.me(t.bo.cookie)).households).toEqual([]);
  });

  it('restore retires an untouched household of theirs', async () => {
    const t = await setup();
    await t.remove(t.bo.id, t.cookieA);
    const created = await t.send('POST', '/api/households', undefined, t.bo.cookie);
    expect(created.status).toBe(201);
    const { householdId } = (await created.json()) as { householdId: string };
    expect((await t.restore(t.bo.id, t.cookieA)).status).toBe(204);
    expect((await t.me(t.bo.cookie)).households.map((x) => x.id)).toEqual([t.h]);
    expect(t.member(t.bo.id, householdId)).toEqual({ removed_at: T0, removed_by: t.bo.id });
  });

  it('restore refuses once their own lists have changed', async () => {
    const t = await setup();
    await t.remove(t.bo.id, t.cookieA);
    const { householdId } = (await (await t.send('POST', '/api/households', undefined, t.bo.cookie)).json()) as { householdId: string };
    expect((await t.push(householdId, t.bo.cookie)).accepted).toHaveLength(1);
    const res = await t.restore(t.bo.id, t.cookieA);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'member_moved' });
    expect(t.member(t.bo.id)).toEqual({ removed_at: T0, removed_by: t.anna.userId });
    expect(t.member(t.bo.id, householdId)).toEqual({ removed_at: null, removed_by: null });
  });

  it('a household on demand: made once, then the same one', async () => {
    const t = await setup();
    await t.remove(t.bo.id, t.cookieA);
    const first = await t.send('POST', '/api/households', { locale: 'sv' }, t.bo.cookie);
    expect(first.status).toBe(201);
    const { householdId } = (await first.json()) as { householdId: string };
    expect(householdId).not.toBe(t.h);
    const list = t.db.prepare("SELECT payload FROM events WHERE household_id = ? AND type = 'list.created'").get(householdId) as { payload: string };
    expect(JSON.parse(list.payload).name).toBe('Inköpslista');
    const again = await t.send('POST', '/api/households', undefined, t.bo.cookie);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ householdId });
    const own = await t.send('POST', '/api/households', undefined, t.cookieA);
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ householdId: t.h });
  });

  it('refuses a bad body', async () => {
    const t = await setup();
    expect((await t.send('POST', '/api/households', { locale: 'de' }, t.bo.cookie)).status).toBe(400);
  });

  it('two at once make one household', async () => {
    const t = await setup();
    await t.remove(t.bo.id, t.cookieA);
    const [a, b] = await Promise.all([
      t.send('POST', '/api/households', undefined, t.bo.cookie),
      t.send('POST', '/api/households', undefined, t.bo.cookie),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(((await a.json()) as { householdId: string }).householdId).toBe(((await b.json()) as { householdId: string }).householdId);
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM household_members WHERE user_id = ? AND role = 'owner'").get(t.bo.id)).toEqual({ n: 1 });
  });

  it('logs who did what', async () => {
    const t = await setup();
    await t.remove(t.bo.id, t.cookieA);
    const { householdId } = (await (await t.send('POST', '/api/households', undefined, t.bo.cookie)).json()) as { householdId: string };
    await t.restore(t.bo.id, t.cookieA);
    const logged = t.lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const find = (msg: string) => logged.find((l) => l.msg === msg);
    expect(find('member removed')).toMatchObject({ householdId: t.h, userId: t.anna.userId, memberId: t.bo.id });
    expect(find('member restored')).toMatchObject({ householdId: t.h, userId: t.anna.userId, memberId: t.bo.id });
    expect(find('household created')).toMatchObject({ householdId, userId: t.bo.id });
  });
});
