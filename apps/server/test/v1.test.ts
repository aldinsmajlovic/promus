import { formatHlc, makeEvent, newId } from '@promus/shared';
import type { ApiItem, ApiList, EventType, PayloadOf } from '@promus/shared';
import { describe, expect, it } from 'vitest';
import { API_SCOPES, createSession, hashToken } from '../src/auth/sessions.ts';
import { insertEvents } from '../src/events-repo.ts';
import { acceptInvite, createInvite } from '../src/invites.ts';
import { ensureHousehold, removeMember } from '../src/members.ts';
import { createUser } from '../src/users.ts';
import { DAY, SAME_ORIGIN, T0, cookieOf, login, makeTestApp } from './helpers.ts';

const PW = 'correct horse';
const MIN = 60_000;

async function setup() {
  const t = makeTestApp();
  const anna = await createUser(t.db, { username: 'Anna', password: PW, locale: 'sv', now: T0 });
  const { id: tokenId, token } = createSession(t.db, { userId: anna.userId, kind: 'api', name: 'HA', scopes: [...API_SCOPES], now: T0 });
  const L = anna.listId;
  const itemsPath = `/api/v1/lists/${L}/items`;
  const api = (method: string, path: string, body?: unknown, bearer = token) =>
    t.app.request(path, {
      method,
      headers: { Host: 'promus.test', Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  let tick = 0;
  /** A phone's event, stored as Anna's: a millisecond after the one before, unless `wall` says when. */
  const seed = <T extends EventType>(type: T, payload: PayloadOf<T>, wall = T0 + ++tick) => {
    const e = makeEvent(type, payload, { householdId: anna.householdId, hlc: formatHlc(wall, 0, 'phone'), occurredAt: wall });
    insertEvents(t.db, [e], { userId: anna.userId, sessionId: 'phone' }, wall);
    return e;
  };
  const item = (name: string) => {
    const itemId = newId();
    seed('item.created', { itemId, name });
    return itemId;
  };
  /** Bröd to get, Smör under Later, Ägg in Done. */
  const stock = () => {
    const BROD = item('Bröd');
    seed('entry.added', { listId: L, itemId: BROD, note: 'Fullkorn', quantity: 2 });
    const SMOR = item('Smör');
    seed('entry.added', { listId: L, itemId: SMOR });
    seed('entry.laterSet', { listId: L, itemId: SMOR, later: true });
    const AGG = item('Ägg');
    seed('entry.added', { listId: L, itemId: AGG });
    seed('entry.checked', { listId: L, itemId: AGG });
    return { BROD, SMOR, AGG };
  };
  const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;
  const items = async (bearer = token) => (await json<{ items: ApiItem[] }>(api('GET', itemsPath, undefined, bearer))).items;
  const lists = async (bearer = token) => (await json<{ lists: ApiList[] }>(api('GET', '/api/v1/lists', undefined, bearer))).lists;
  const count = () => (t.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
  const newest = () => t.db.prepare('SELECT user_id, session_id, hlc, payload FROM events ORDER BY seq DESC LIMIT 1').get() as {
    user_id: string; session_id: string; hlc: string; payload: string;
  };
  return { ...t, anna, token, tokenId, L, itemsPath, api, seed, item, stock, json, items, lists, count, newest };
}

describe('/api/v1', { timeout: 30_000 }, () => {
  it('lists the lists with how many are left to get', async () => {
    const t = await setup();
    expect(await t.json(t.api('GET', '/api/v1/lists'))).toEqual({ lists: [{ id: t.L, name: 'Inköpslista', toGet: 0 }] });
    t.stock();
    // Later and Done don't count
    expect(await t.lists()).toEqual([{ id: t.L, name: 'Inköpslista', toGet: 1 }]);
  });

  it('adds by name: an existing item comes back, a new name makes one, and the app sees who added it', async () => {
    const t = await setup();
    const MJOLK = t.item('Mjölk');
    t.seed('entry.added', { listId: t.L, itemId: MJOLK });
    t.seed('entry.checked', { listId: t.L, itemId: MJOLK });
    t.setNow(T0 + 2 * DAY);
    expect(await t.items()).toEqual([]);
    const res = await t.api('POST', t.itemsPath, { name: '  mjölk ' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: MJOLK, name: 'Mjölk', checked: false, later: false, quantity: 1, note: null });
    expect(t.newest()).toMatchObject({ user_id: t.anna.userId, session_id: t.tokenId });
    const before = t.count();
    const again = await t.api('POST', t.itemsPath, { name: 'MJÖLK' });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ id: MJOLK, checked: false });
    expect(t.count()).toBe(before);
    const fresh = await t.api('POST', t.itemsPath, { name: 'Gurka' });
    expect(fresh.status).toBe(201);
    const made = (await fresh.json()) as ApiItem;
    expect(made).toMatchObject({ name: 'Gurka', checked: false, later: false, quantity: 1, note: null });
    expect(made.id).not.toBe(MJOLK);
    const [added, created] = t.db.prepare('SELECT type, hlc FROM events ORDER BY seq DESC LIMIT 2').all() as { type: string; hlc: string }[];
    const seeded = (t.db.prepare("SELECT MAX(hlc) AS hlc FROM events WHERE session_id = 'phone'").get() as { hlc: string }).hlc;
    expect([created!.type, added!.type]).toEqual(['item.created', 'entry.added']);
    expect(created!.hlc > seeded).toBe(true);
    expect(added!.hlc > created!.hlc).toBe(true);
  });

  it('adding the name of an archived item brings it back, then adds it', async () => {
    const t = await setup();
    const LOK = t.item('Lök');
    t.seed('item.archived', { itemId: LOK });
    const res = await t.api('POST', t.itemsPath, { name: 'lök' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: LOK, name: 'Lök', checked: false });
    const last = t.db.prepare('SELECT type, payload FROM events ORDER BY seq DESC LIMIT 2').all() as { type: string; payload: string }[];
    expect(last.map((e) => e.type)).toEqual(['entry.added', 'item.unarchived']);
    expect(last.map((e) => JSON.parse(e.payload).itemId)).toEqual([LOK, LOK]);
    expect(await t.items()).toMatchObject([{ id: LOK, checked: false }]);
  });

  it('"lok" is a new item beside "Lök"', async () => {
    const t = await setup();
    const LOK = t.item('Lök');
    const res = await t.api('POST', t.itemsPath, { name: 'lok' });
    expect(res.status).toBe(201);
    const made = (await res.json()) as ApiItem;
    expect(made.name).toBe('lok');
    expect(made.id).not.toBe(LOK);
  });

  it('adding an item under Later moves it back up', async () => {
    const t = await setup();
    const { SMOR } = t.stock();
    const res = await t.api('POST', t.itemsPath, { name: 'smör' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: SMOR, name: 'Smör', checked: false, later: false, quantity: 1, note: null });
  });

  it('two quick adds of a new name make one item', async () => {
    const t = await setup();
    const both = await Promise.all([t.api('POST', t.itemsPath, { name: 'Ost' }), t.api('POST', t.itemsPath, { name: 'ost' })]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 201]);
    const [a, b] = (await Promise.all(both.map((r) => r.json()))) as ApiItem[];
    expect(a!.id).toBe(b!.id);
    expect((await t.items()).filter((i) => i.name.toLowerCase() === 'ost')).toHaveLength(1);
  });

  it('refuses an empty, blank or 201-character name, and a body that is not one, with invalid_request', async () => {
    const t = await setup();
    const before = t.count();
    for (const body of [{ name: '' }, { name: '   ' }, { name: 'x'.repeat(201) }, {}, { name: 'Ost', note: 'x' }, ['Ost']]) {
      const res = await t.api('POST', t.itemsPath, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_request' });
    }
    const raw = await t.app.request(t.itemsPath, {
      method: 'POST',
      headers: { Host: 'promus.test', Authorization: `Bearer ${t.token}`, 'Content-Type': 'application/json' },
      body: '{nope',
    });
    expect(raw.status).toBe(400);
    expect(await raw.json()).toEqual({ error: 'invalid_request' });
    expect((await t.api('POST', t.itemsPath, { name: 'x'.repeat(200) })).status).toBe(201);
    expect((await t.api('POST', t.itemsPath, { name: 'x'.repeat(5000) })).status).toBe(413);
    expect(t.count()).toBe(before + 2);
  });

  it('reads active, then Later, then Done', async () => {
    const t = await setup();
    const { BROD } = t.stock();
    const items = await t.items();
    expect(items.map((i) => [i.name, i.checked, i.later])).toEqual([['Bröd', false, false], ['Smör', false, true], ['Ägg', true, false]]);
    expect(items[0]).toEqual({ id: BROD, name: 'Bröd', checked: false, later: false, quantity: 2, note: 'Fullkorn' });
  });

  it('checks off and unchecks, and wins against a phone clock 30 minutes ahead', async () => {
    const t = await setup();
    const { BROD } = t.stock();
    const phone = t.seed('entry.checked', { listId: t.L, itemId: BROD }, T0 + 30 * MIN);
    expect((await t.items()).find((i) => i.id === BROD)?.checked).toBe(true);
    const res = await t.api('PATCH', `${t.itemsPath}/${BROD}`, { checked: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: BROD, name: 'Bröd', checked: false, later: false, quantity: 2, note: 'Fullkorn' });
    expect(t.newest().hlc > phone.hlc).toBe(true);
    expect((await t.items()).find((i) => i.id === BROD)?.checked).toBe(false);
    expect(await t.json(t.api('PATCH', `${t.itemsPath}/${BROD}`, { checked: true }))).toMatchObject({ id: BROD, checked: true });
    const before = t.count();
    const again = await t.api('PATCH', `${t.itemsPath}/${BROD}`, { checked: true });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ id: BROD, checked: true });
    expect(t.count()).toBe(before);
    expect((await t.api('PATCH', `${t.itemsPath}/${BROD}`, { checked: 'yes' })).status).toBe(400);
  });

  it('PATCH and DELETE accept an alias id and answer with the surviving id', async () => {
    const t = await setup();
    const A = newId();
    const B = newId();
    t.seed('item.created', { itemId: A, name: 'Ost' });
    t.seed('item.created', { itemId: B, name: 'Ost' });
    t.seed('entry.added', { listId: t.L, itemId: B });
    expect(await t.json(t.api('PATCH', `${t.itemsPath}/${B}`, { checked: true }))).toMatchObject({ id: A, checked: true });
    expect(JSON.parse(t.newest().payload)).toEqual({ listId: t.L, itemId: A });
    expect((await t.api('DELETE', `${t.itemsPath}/${B}`)).status).toBe(204);
    expect(await t.items()).toEqual([]);
  });

  it('removes an item; a second DELETE is 404', async () => {
    const t = await setup();
    const { BROD } = t.stock();
    expect((await t.api('DELETE', `${t.itemsPath}/${BROD}`)).status).toBe(204);
    expect(t.newest()).toMatchObject({ user_id: t.anna.userId, session_id: t.tokenId });
    expect((await t.items()).map((i) => i.name)).toEqual(['Smör', 'Ägg']);
    const again = await t.api('DELETE', `${t.itemsPath}/${BROD}`);
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ error: 'not_found' });
  });

  it('404s a list of another household, a deleted list, and an item not on the list', async () => {
    const t = await setup();
    const bo = await createUser(t.db, { username: 'Bo', password: PW, locale: 'en', now: T0 });
    const gone = newId();
    t.seed('list.created', { listId: gone, name: 'Fest' });
    t.seed('list.deleted', { listId: gone });
    const LOK = t.item('Lök');
    const before = t.count();
    for (const listId of [bo.listId, gone, 'nope']) {
      const path = `/api/v1/lists/${listId}/items`;
      for (const res of [
        await t.api('GET', path),
        await t.api('POST', path, { name: 'Ost' }),
        await t.api('PATCH', `${path}/${LOK}`, { checked: true }),
        await t.api('DELETE', `${path}/${LOK}`),
      ]) {
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'not_found' });
      }
    }
    for (const itemId of [LOK, newId()]) {
      expect((await t.api('PATCH', `${t.itemsPath}/${itemId}`, { checked: true })).status).toBe(404);
      expect((await t.api('DELETE', `${t.itemsPath}/${itemId}`)).status).toBe(404);
    }
    expect(t.count()).toBe(before);
    expect(await t.lists()).toEqual([{ id: t.L, name: 'Inköpslista', toGet: 0 }]);
  });

  it('a token whose user left the household sees their new one; the old list is 404', async () => {
    const t = await setup();
    const invite = createInvite(t.db, { householdId: t.anna.householdId, userId: t.anna.userId, ownHousehold: false, now: T0 });
    const cy = await acceptInvite(t.db, { tokenHash: hashToken(invite.token), username: 'Cy', password: PW, locale: 'sv', now: T0 });
    const cyToken = createSession(t.db, { userId: cy.userId, kind: 'api', name: 'HA', scopes: [...API_SCOPES], now: T0 }).token;
    expect(await t.lists(cyToken)).toEqual([{ id: t.L, name: 'Inköpslista', toGet: 0 }]);
    expect(removeMember(t.db, { householdId: t.anna.householdId, actorId: t.anna.userId, targetId: cy.userId, now: T0 })).toBe('ok');
    expect(await t.lists(cyToken)).toEqual([]);
    expect((await t.api('GET', t.itemsPath, undefined, cyToken)).status).toBe(404);
    const own = ensureHousehold(t.db, { userId: cy.userId, locale: 'sv', now: T0, sessionId: 'test' });
    const [list, ...more] = await t.lists(cyToken);
    expect(more).toEqual([]);
    expect(list).toMatchObject({ name: 'Inköpslista', toGet: 0 });
    expect(list!.id).not.toBe(t.L);
    expect((await t.api('GET', t.itemsPath, undefined, cyToken)).status).toBe(404);
    expect((await t.api('POST', t.itemsPath, { name: 'Ost' }, cyToken)).status).toBe(404);
    expect((await t.api('POST', `/api/v1/lists/${list!.id}/items`, { name: 'Ost' }, cyToken)).status).toBe(201);
    const stored = t.db.prepare("SELECT household_id, user_id FROM events WHERE type = 'item.created'").all();
    expect(stored).toEqual([{ household_id: own.householdId, user_id: cy.userId }]);
  });

  it('a browser cookie gets 403 on /api/v1, a token without lists:write gets 403 on POST', async () => {
    const t = await setup();
    const { BROD } = t.stock();
    const cookie = cookieOf(await login(t.app, 'anna', PW));
    const browser = await t.app.request('/api/v1/lists', { headers: { ...SAME_ORIGIN, Cookie: cookie } });
    expect(browser.status).toBe(403);
    expect(await browser.json()).toEqual({ error: 'forbidden' });
    expect((await t.app.request('/api/v1/lists', { headers: { Host: 'promus.test' } })).status).toBe(401);
    const reader = createSession(t.db, { userId: t.anna.userId, kind: 'api', name: 'Wall', scopes: ['lists:read'], now: T0 }).token;
    expect((await t.api('GET', '/api/v1/lists', undefined, reader)).status).toBe(200);
    expect((await t.api('GET', t.itemsPath, undefined, reader)).status).toBe(200);
    const before = t.count();
    for (const res of [
      await t.api('POST', t.itemsPath, { name: 'Ost' }, reader),
      await t.api('PATCH', `${t.itemsPath}/${BROD}`, { checked: true }, reader),
      await t.api('DELETE', `${t.itemsPath}/${BROD}`, undefined, reader),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'forbidden' });
    }
    expect(t.count()).toBe(before);
  });
});
