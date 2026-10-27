import { createHash } from 'node:crypto';
import { formatHlc, makeEvent, newId } from '@promus/shared';
import type { GuestMe, Share, ShareCheck, ShareJoined, SharesResponse } from '@promus/shared';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { createUser } from '../src/users.ts';
import { DAY, SAME_ORIGIN, T0, cookieOf, login, makeTestApp } from './helpers.ts';

const PW = 'correct horse';

async function setup() {
  const lines: string[] = [];
  const t = makeTestApp({ logger: pino({ level: 'info' }, { write: (line: string) => void lines.push(line) }) });
  const anna = await createUser(t.db, { username: 'Anna', password: PW, locale: 'sv', now: T0 });
  const cookieA = cookieOf(await login(t.app, 'anna', PW));
  const send = (method: string, path: string, body?: unknown, cookie = cookieA) =>
    t.app.request(path, {
      method,
      headers: { ...SAME_ORIGIN, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  let n = 0;
  const push = async (cookie: string, events: [Parameters<typeof makeEvent>[0], Parameters<typeof makeEvent>[1]][]) => {
    const made = events.map(([type, payload]) =>
      makeEvent(type, payload, { householdId: anna.householdId, hlc: formatHlc(T0 + ++n, 0, 'phone'), occurredAt: T0 + n }),
    );
    expect((await send('POST', '/api/sync/push', { events: made }, cookie)).status).toBe(200);
  };
  const rename = (name: string) => push(cookieA, [['list.renamed', { listId: anna.listId, name }]]);
  await rename('Taco night');
  const share = (await (await send('POST', '/api/shares', { listId: anna.listId })).json()) as Share;
  const member = async (username: string) => {
    const { token } = (await (await send('POST', '/api/invites')).json()) as { token: string };
    await send('POST', '/api/invites/accept', { token, username, password: PW }, '');
    return cookieOf(await login(t.app, username.toLowerCase(), PW));
  };
  const check = (token: string, cookie = '') => send('POST', '/api/guest/check', { token }, cookie);
  const join = (token: string, name?: string, cookie = '') => send('POST', '/api/guest/join', { token, name }, cookie);
  const guestCookieOf = (res: Response) => /__Host-guest-[^=]+=[^;]*/.exec(res.headers.get('set-cookie') ?? '')?.[0] ?? '';
  const joinAs = async (name?: string) => {
    const res = await join(share.token, name);
    return { cookie: guestCookieOf(res), joined: (await res.json()) as ShareJoined };
  };
  const me = (cookie: string) => send('GET', `/api/guest/${share.id}/me`, undefined, cookie);
  return { ...t, lines, anna, cookieA, send, push, rename, share, member, check, join, guestCookieOf, joinAs, me };
}

describe('guests', { timeout: 30_000 }, () => {
  it('check names the list, the sharer and the expiry', async () => {
    const t = await setup();
    const res = await t.check(t.share.token);
    expect(res.status).toBe(200);
    expect((await res.json()) as ShareCheck).toEqual({
      shareId: t.share.id, listName: 'Taco night', sharedBy: 'Anna', expiresAt: T0 + 14 * DAY, joined: false,
    });
    await t.rename('Pizza night');
    expect(((await (await t.check(t.share.token)).json()) as ShareCheck).listName).toBe('Pizza night');
  });

  it('one answer for unknown, ended, expired and deleted links', async () => {
    const t = await setup();
    const invalid = async (token: string) => {
      const res = await t.check(token);
      expect([res.status, await res.json()]).toEqual([404, { error: 'share_invalid' }]);
    };
    await invalid('x'.repeat(43));
    expect((await t.send('DELETE', `/api/shares/${t.share.id}`)).status).toBe(204);
    await invalid(t.share.token);
    expect((await t.send('POST', `/api/shares/${t.share.id}/restore`)).status).toBe(204);
    expect((await t.check(t.share.token)).status).toBe(200);
    await t.push(t.cookieA, [['list.deleted', { listId: t.anna.listId }]]);
    await invalid(t.share.token);
    await t.push(t.cookieA, [['list.restored', { listId: t.anna.listId }]]);
    expect((await t.check(t.share.token)).status).toBe(200);
    t.setNow(T0 + 14 * DAY);
    await invalid(t.share.token);
  });

  it('join makes a guest with a cookie for that link only', async () => {
    const t = await setup();
    const res = await t.join(t.share.token, 'Jonas');
    expect(res.status).toBe(201);
    const joined = (await res.json()) as ShareJoined;
    expect(joined).toEqual({ shareId: t.share.id, guest: { id: joined.guest.id, name: 'Jonas' } });
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(new RegExp(`^__Host-guest-${t.share.id}=[^;]+;`));
    for (const part of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=1209600']) expect(setCookie).toContain(part);
    const token = /=([^;]+)/.exec(setCookie)?.[1] ?? '';
    const row = t.db.prepare('SELECT * FROM guests WHERE id = ?').get(joined.guest.id) as Record<string, unknown>;
    expect(row).toMatchObject({
      share_id: t.share.id, name: 'Jonas', created_at: T0, token_hash: createHash('sha256').update(token).digest('hex'),
    });
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it('an empty, blank or missing name is Guest, and 41 characters is too long', async () => {
    const t = await setup();
    for (const name of ['', '   ', undefined]) {
      const res = await t.join(t.share.token, name);
      expect(res.status).toBe(201);
      const { guest } = (await res.json()) as ShareJoined;
      expect(guest.name).toBeNull();
      expect(t.db.prepare('SELECT name FROM guests WHERE id = ?').get(guest.id)).toEqual({ name: null });
    }
    const res = await t.join(t.share.token, 'a'.repeat(41));
    expect([res.status, await res.json()]).toEqual([400, { error: 'name_too_long' }]);
    expect((await t.join(t.share.token, 'a'.repeat(40))).status).toBe(201);
  });

  it('check knows this phone already joined', async () => {
    const t = await setup();
    const { cookie } = await t.joinAs('Jonas');
    expect(((await (await t.check(t.share.token, cookie)).json()) as ShareCheck).joined).toBe(true);
    const elsewhere = cookie.replace(t.share.id, newId());
    expect(((await (await t.check(t.share.token, elsewhere)).json()) as ShareCheck).joined).toBe(false);
  });

  it('a link takes at most 50 guests', async () => {
    const t = await setup();
    for (let i = 0; i < 50; i++) expect((await t.join(t.share.token)).status).toBe(201);
    const res = await t.join(t.share.token);
    expect([res.status, await res.json()]).toEqual([409, { error: 'share_full' }]);
    expect((t.db.prepare('SELECT COUNT(*) AS n FROM guests').get() as { n: number }).n).toBe(50);
  });

  it('me answers the guest, the share and the people on the list', async () => {
    const t = await setup();
    const cookieBo = await t.member('Bo');
    const cookieCy = await t.member('Cy');
    const cookieDee = await t.member('Dee');
    const [boItem, cyItem, cyList, deeItem] = [newId(), newId(), newId(), newId()];
    await t.push(cookieBo, [
      ['item.created', { itemId: boItem, name: 'Tortillas' }],
      ['entry.added', { listId: t.anna.listId, itemId: boItem }],
    ]);
    await t.push(cookieCy, [
      ['list.created', { listId: cyList, name: 'Hardware' }],
      ['item.created', { itemId: cyItem, name: 'Screws' }],
      ['entry.added', { listId: cyList, itemId: cyItem }],
    ]);
    await t.push(cookieDee, [['item.created', { itemId: deeItem, name: 'Salsa' }]]);
    await t.push(t.cookieA, [['entry.added', { listId: t.anna.listId, itemId: deeItem }]]);
    const { cookie, joined } = await t.joinAs('Jonas');
    const res = await t.me(cookie);
    expect(res.status).toBe(200);
    const anna = { id: t.anna.userId, name: 'Anna', guest: false };
    const bo = (t.db.prepare("SELECT id FROM users WHERE username = 'Bo'").get() as { id: string }).id;
    expect((await res.json()) as GuestMe).toEqual({
      guest: { id: joined.guest.id, name: 'Jonas' },
      share: { id: t.share.id, householdId: t.anna.householdId, listId: t.anna.listId, expiresAt: T0 + 14 * DAY, sharedBy: 'Anna' },
      people: [anna, { id: bo, name: 'Bo', guest: false }, { id: joined.guest.id, name: 'Jonas', guest: true }],
    });
  });

  it("me lists a guest of the list's earlier link whose change is still on it", async () => {
    const t = await setup();
    const { cookie: jonas, joined } = await t.joinAs('Jonas');
    await t.joinAs('Pia');
    const bread = newId();
    const events = (['item.created', 'entry.added'] as const).map((type, i) =>
      makeEvent(type, type === 'item.created' ? { itemId: bread, name: 'Bread' } : { listId: t.anna.listId, itemId: bread }, {
        householdId: t.anna.householdId, hlc: formatHlc(T0 + 100 + i, 0, 'guest'), occurredAt: T0 + 100 + i,
      }),
    );
    expect((await t.send('POST', `/api/guest/${t.share.id}/push`, { events }, jonas)).status).toBe(200);
    expect((await t.send('DELETE', `/api/shares/${t.share.id}`)).status).toBe(204);
    const next = (await (await t.send('POST', '/api/shares', { listId: t.anna.listId })).json()) as Share;
    const res = await t.join(next.token, 'Mia');
    const mia = t.guestCookieOf(res);
    const { guest } = (await res.json()) as ShareJoined;
    const me = (await (await t.send('GET', `/api/guest/${next.id}/me`, undefined, mia)).json()) as GuestMe;
    expect(me.people).toEqual([
      { id: t.anna.userId, name: 'Anna', guest: false },
      { id: joined.guest.id, name: 'Jonas', guest: true },
      { id: guest.id, name: 'Mia', guest: true },
    ]);
  });

  it('a guest can rename themselves', async () => {
    const t = await setup();
    const { cookie, joined } = await t.joinAs('Jonas');
    expect((await t.send('PUT', `/api/guest/${t.share.id}/name`, { name: '  Jonas B  ' }, cookie)).status).toBe(204);
    expect(((await (await t.me(cookie)).json()) as GuestMe).guest).toEqual({ id: joined.guest.id, name: 'Jonas B' });
    const { guests } = (await (await t.send('GET', '/api/shares')).json()) as SharesResponse;
    expect(guests).toEqual([{ id: joined.guest.id, shareId: t.share.id, name: 'Jonas B' }]);
    const res = await t.send('PUT', `/api/guest/${t.share.id}/name`, { name: 'a'.repeat(41) }, cookie);
    expect([res.status, await res.json()]).toEqual([400, { error: 'name_too_long' }]);
    expect((await t.send('PUT', `/api/guest/${t.share.id}/name`, { name: ' ' }, cookie)).status).toBe(204);
    expect(((await (await t.me(cookie)).json()) as GuestMe).guest.name).toBeNull();
  });

  it('an ended link answers share_ended, and a brought back one works again', async () => {
    const t = await setup();
    const { cookie } = await t.joinAs('Jonas');
    const ended = async () => {
      const res = await t.me(cookie);
      expect([res.status, await res.json()]).toEqual([401, { error: 'share_ended' }]);
    };
    expect((await t.me(cookie)).status).toBe(200);
    expect((await t.send('DELETE', `/api/shares/${t.share.id}`)).status).toBe(204);
    await ended();
    expect((await t.send('POST', `/api/shares/${t.share.id}/restore`)).status).toBe(204);
    expect((await t.me(cookie)).status).toBe(200);
    await t.push(t.cookieA, [['list.deleted', { listId: t.anna.listId }]]);
    await ended();
    await t.push(t.cookieA, [['list.restored', { listId: t.anna.listId }]]);
    expect((await t.me(cookie)).status).toBe(200);
    t.setNow(T0 + 14 * DAY);
    await ended();
  });

  it('a guest cookie is no session, and a session no guest cookie', async () => {
    const t = await setup();
    const { cookie } = await t.joinAs('Jonas');
    expect((await t.send('GET', '/api/sync/pull', undefined, cookie)).status).toBe(401);
    const res = await t.me(t.cookieA);
    expect([res.status, await res.json()]).toEqual([401, { error: 'unauthenticated' }]);
    expect((await t.me('')).status).toBe(401);
    const other = (await t.joinAs()).cookie.replace(/^__Host-guest-[^=]+/, `__Host-guest-${newId()}`);
    expect((await t.send('GET', `/api/guest/${t.share.id}/me`, undefined, other)).status).toBe(401);
  });

  it('a Bearer request never rides on the guest cookie', async () => {
    const t = await setup();
    const { cookie } = await t.joinAs('Jonas');
    const res = await t.app.request(`/api/guest/${t.share.id}/name`, {
      method: 'PUT',
      headers: { Host: 'promus.test', 'Content-Type': 'application/json', Authorization: 'Bearer x', Cookie: cookie },
      body: JSON.stringify({ name: 'Evil' }),
    });
    expect([res.status, await res.json()]).toEqual([401, { error: 'unauthenticated' }]);
  });

  it('a guest token only works under its own link', async () => {
    const t = await setup();
    const listB = newId();
    await t.push(t.cookieA, [['list.created', { listId: listB, name: 'Other' }]]);
    const shareB = (await (await t.send('POST', '/api/shares', { listId: listB })).json()) as Share;
    const resB = await t.join(shareB.token, 'Bea');
    const token = /=([^;]+)/.exec(resB.headers.get('set-cookie') ?? '')?.[1] ?? '';
    const forA = `__Host-guest-${t.share.id}=${token}`;
    const res = await t.me(forA);
    expect([res.status, await res.json()]).toEqual([401, { error: 'unauthenticated' }]);
    expect(((await (await t.check(t.share.token, forA)).json()) as ShareCheck).joined).toBe(false);
  });

  it('never logs a token or a guest\'s name', async () => {
    const t = await setup();
    const { cookie, joined } = await t.joinAs('Jonas Secretname');
    await t.check(t.share.token, cookie);
    await t.send('PUT', `/api/guest/${t.share.id}/name`, { name: 'Renamed Secret' }, cookie);
    const guestToken = /=(.+)$/.exec(cookie)?.[1] ?? '';
    const log = t.lines.join('');
    for (const secret of [t.share.token, guestToken, 'Secretname', 'Renamed Secret']) expect(log).not.toContain(secret);
    const logged = t.lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    for (const msg of ['guest joined', 'guest renamed'])
      expect(logged.find((l) => l.msg === msg)).toMatchObject({ guestId: joined.guest.id, shareId: t.share.id });
  });
});
