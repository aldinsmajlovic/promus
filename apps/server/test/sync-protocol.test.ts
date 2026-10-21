import type { Hono } from 'hono';
import { ApiError, AuthError, NetworkError, entryKey, hlcWall, makeEvent, newId, syncOnce } from '@promus/shared';
import type { EventInput, HouseholdState, PullResponse, PushResponse, SyncApi } from '@promus/shared';
import { SimClient } from '@promus/shared/testing';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../src/app.ts';
import { createUser } from '../src/users.ts';
import { SAME_ORIGIN, T0, cookieOf, login, makeTestApp } from './helpers.ts';

const PW = 'correct horse';
const MIN = 60_000;
const HOUR = 60 * MIN;

/** The client's transport, over app.request with the session cookie. */
function httpApi(app: Hono<AppEnv>, session: { cookie: string }): SyncApi {
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await app.request(path, {
        ...init,
        headers: { ...SAME_ORIGIN, Cookie: session.cookie, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      throw new NetworkError('request failed', { cause: err });
    }
    if (res.status === 401) throw new AuthError(((await res.json()) as { error: string }).error);
    if (!res.ok) throw new ApiError(res.status, ((await res.json()) as { error: string }).error);
    return (await res.json()) as T;
  }
  return {
    push: (events) => call<PushResponse>('/api/sync/push', { method: 'POST', body: JSON.stringify({ events }) }),
    pull: (after, limit) => call<PullResponse>(`/api/sync/pull?after=${after}&limit=${limit}`),
  };
}

async function setup() {
  const t = makeTestApp();
  const user = await createUser(t.db, { username: 'Aldin', password: PW, locale: 'sv', now: T0 });
  /** A device signed in as the user, with its own session and a clock `clockOffsetMs` off the server's. */
  const device = async (nodeId: string, clockOffsetMs = 0) => {
    const session = { cookie: cookieOf(await login(t.app, 'aldin', PW)) };
    const client = new SimClient({ householdId: user.householdId, nodeId, now: t.now, clockOffsetMs });
    const api = httpApi(t.app, session);
    const sync = (via: SyncApi = api) => syncOnce(client.storage, via, client.now);
    return { client, session, api, sync };
  };
  const serverIds = () =>
    (t.db.prepare('SELECT id FROM events WHERE household_id = ? ORDER BY seq').all(user.householdId) as { id: string }[])
      .map((r) => r.id);
  const addItem = (client: SimClient, name: string) => {
    const itemId = newId();
    client.act('item.created', { itemId, name });
    client.act('entry.added', { listId: user.listId, itemId });
    return itemId;
  };
  return { ...t, user, device, serverIds, addItem };
}

const ids = (events: EventInput[]) => events.map((e) => e.id);
const names = (s: HouseholdState) => [...s.items.values()].map((i) => i.name).sort();

describe('sync protocol', { timeout: 30_000 }, () => {
  it('pushing the same batch twice stores each event once', async () => {
    const { device, serverIds, addItem } = await setup();
    const a = await device('a');
    addItem(a.client, 'Mjölk');
    const batch = await a.client.storage.pendingEvents(500);
    const first = await a.api.push(batch);
    const second = await a.api.push(batch);
    expect(first.accepted).toEqual(ids(batch));
    expect(second.accepted).toEqual(ids(batch));
    // the outbox still lists them, so syncOnce pushes them a third time
    expect(await a.sync()).toEqual({ pushed: 2, pulled: 3, rejected: 0 });
    expect(serverIds()).toEqual([expect.any(String), ...ids(batch)]);
    expect(a.client.storage.pendingCount()).toBe(0);
  });

  it('an interrupted push loses nothing and duplicates nothing on retry', async () => {
    const { device, serverIds, addItem } = await setup();
    const a = await device('a');
    for (const name of ['Mjölk', 'Bröd', 'Ost']) addItem(a.client, name);
    const sent = await a.client.storage.pendingEvents(500);
    const flaky: SyncApi = {
      ...a.api,
      push: async (events) => {
        await a.api.push(events);
        throw new NetworkError('connection lost');
      },
    };
    await expect(a.sync(flaky)).rejects.toBeInstanceOf(NetworkError);
    expect(a.client.storage.pendingCount()).toBe(6);
    expect(await a.sync()).toEqual({ pushed: 6, pulled: 7, rejected: 0 });
    expect(serverIds()).toEqual([expect.any(String), ...ids(sent)]);
    expect(a.client.storage.outbox.size).toBe(0);
    const state = a.client.storage.state();
    expect(names(state)).toEqual(['Bröd', 'Mjölk', 'Ost']);
    expect([...state.entries.values()].map((e) => e.state)).toEqual(['active', 'active', 'active']);
  });

  it('pull paging has no gaps or repeats', async () => {
    const { device } = await setup();
    const a = await device('a');
    for (let i = 0; i < 1203; i++) a.client.act('item.created', { itemId: newId(), name: `Vara ${i}` });
    const sent = await a.client.storage.pendingEvents(2000);
    expect((await a.sync()).pushed).toBe(1203);
    const b = await device('b');
    // the signup list.created plus A's 1,203
    expect((await b.sync()).pulled).toBe(1204);
    const pulled = [...b.client.storage.pulled.values()];
    expect(pulled).toHaveLength(1204);
    const theirs = pulled.filter((e) => e.type === 'item.created');
    expect(theirs).toHaveLength(1203);
    expect(new Set(ids(theirs))).toEqual(new Set(ids(sent)));
    const seqs = pulled.map((e) => e.seq);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
    expect(names(b.client.storage.state())).toHaveLength(1203);
  });

  it('two devices adding the same name offline end up with one item', async () => {
    const { device, addItem, user, setNow } = await setup();
    const a = await device('a');
    const b = await device('b');
    await a.sync();
    await b.sync();
    setNow(T0 + MIN);
    addItem(a.client, 'Mjölk');
    setNow(T0 + 2 * MIN);
    addItem(b.client, 'MJÖLK');
    await a.sync();
    await b.sync();
    await a.sync();
    for (const s of [a.client.storage.state(), b.client.storage.state()]) {
      expect(names(s)).toEqual(['Mjölk']);
      expect([...s.entries.values()]).toMatchObject([{ listId: user.listId, state: 'active' }]);
    }
  });

  it('last change wins by when it happened, not by sync order', async () => {
    const { device, addItem, user, setNow } = await setup();
    const a = await device('a');
    const b = await device('b');
    const itemId = addItem(a.client, 'Mjölk');
    await a.sync();
    await b.sync();
    const entry = { listId: user.listId, itemId };
    setNow(T0 + 10 * HOUR);
    a.client.act('entry.checked', entry); // A is offline
    setNow(T0 + 11 * HOUR);
    b.client.act('entry.unchecked', entry);
    await b.sync();
    setNow(T0 + 11 * HOUR + 5 * MIN);
    await a.sync();
    await b.sync();
    for (const s of [a.client.storage.state(), b.client.storage.state()]) {
      expect(s.entries.get(entryKey(user.listId, itemId))?.state).toBe('active');
    }
  });

  it('events too far in the future are re-stamped and accepted', async () => {
    const { device, db, now } = await setup();
    const a = await device('a', 2 * HOUR);
    const e = a.client.act('item.created', { itemId: newId(), name: 'Mjölk' });
    expect(hlcWall(e.hlc) - now()).toBe(2 * HOUR);
    expect(await a.sync()).toEqual({ pushed: 1, pulled: 2, rejected: 0 });
    const row = db.prepare('SELECT hlc FROM events WHERE id = ?').get(e.id) as { hlc: string };
    expect(Math.abs(hlcWall(row.hlc) - now())).toBeLessThan(5000);
    // the learned offset keeps later events on server time too
    const next = a.client.act('item.created', { itemId: newId(), name: 'Bröd' });
    expect(Math.abs(hlcWall(next.hlc) - now())).toBeLessThan(5000);
  });

  it('an expired session keeps the outbox', async () => {
    const { app, device, addItem } = await setup();
    const a = await device('a');
    addItem(a.client, 'Mjölk');
    const logout = await app.request('/api/auth/logout', { method: 'POST', headers: { ...SAME_ORIGIN, Cookie: a.session.cookie } });
    expect(logout.status).toBe(204);
    await expect(a.sync()).rejects.toBeInstanceOf(AuthError);
    expect(a.client.storage.pendingCount()).toBe(2);
    a.session.cookie = cookieOf(await login(app, 'aldin', PW));
    expect(await a.sync()).toEqual({ pushed: 2, pulled: 3, rejected: 0 });
    expect(a.client.storage.pendingCount()).toBe(0);
  });

  it('events the server refuses move to rejected and do not block the rest', async () => {
    const { device, addItem } = await setup();
    const a = await device('a');
    addItem(a.client, 'Mjölk');
    const foreign = makeEvent('item.created', { itemId: newId(), name: 'Ost' }, {
      householdId: newId(),
      hlc: a.client.storage.nextHlc(),
      occurredAt: a.client.now(),
    });
    a.client.storage.append([foreign]);
    expect(await a.sync()).toEqual({ pushed: 2, pulled: 3, rejected: 1 });
    expect(a.client.storage.pendingCount()).toBe(0);
    expect(a.client.storage.rejected.get(foreign.id)).toMatchObject({ event: foreign, code: 'forbidden_household' });
    expect(names(a.client.storage.state())).toEqual(['Mjölk']);
  });
});
