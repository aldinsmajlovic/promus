import { entryKey, fold, formatHlc, hlcWall, makeEvent, newId, resolveItemId } from '@promus/shared';
import type { EventInput, EventType, PayloadOf, PullResponse, PushResponse, Share, ShareJoined } from '@promus/shared';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { createUser } from '../src/users.ts';
import { DAY, SAME_ORIGIN, T0, cookieOf, login, makeTestApp } from './helpers.ts';

const PW = 'correct horse';
const HOUR = 3_600_000;

async function setup() {
  const lines: string[] = [];
  const t = makeTestApp({ logger: pino({ level: 'info' }, { write: (line: string) => void lines.push(line) }) });
  const anna = await createUser(t.db, { username: 'Anna', password: PW, locale: 'sv', now: T0 });
  const cookieA = cookieOf(await login(t.app, 'anna', PW));
  const send = (method: string, path: string, body: unknown, cookie: string) =>
    t.app.request(path, {
      method,
      headers: { ...SAME_ORIGIN, 'Content-Type': 'application/json', Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  let n = 0;
  const ev = <T extends EventType>(type: T, payload: PayloadOf<T>, meta: { undoOf?: string; householdId?: string; wall?: number } = {}) =>
    makeEvent(type, payload, {
      householdId: meta.householdId ?? anna.householdId,
      hlc: formatHlc(meta.wall ?? T0 + ++n, 0, 'phone'),
      occurredAt: T0 + n,
      ...(meta.undoOf ? { undoOf: meta.undoOf } : {}),
    });
  const push = async (...events: EventInput[]) =>
    expect((await send('POST', '/api/sync/push', { events }, cookieA)).status).toBe(200);
  const fullPull = async () => (await (await send('GET', '/api/sync/pull', undefined, cookieA)).json()) as PullResponse;
  const annaFold = async () => fold((await fullPull()).events);
  const shareList = async () => (await (await send('POST', '/api/shares', { listId: anna.listId }, cookieA)).json()) as Share;
  const joinAs = async (share: Share) => {
    const res = await send('POST', '/api/guest/join', { token: share.token, name: 'Jonas' }, '');
    const cookie = /__Host-guest-[^=]+=[^;]*/.exec(res.headers.get('set-cookie') ?? '')?.[0] ?? '';
    const { guest } = (await res.json()) as ShareJoined;
    const gpull = (after = 0) => send('GET', `/api/guest/${share.id}/pull?after=${after}`, undefined, cookie);
    const gpush = (...events: EventInput[]) => send('POST', `/api/guest/${share.id}/push`, { events }, cookie);
    // each event's answer: 'accepted' or its reject code
    const verdicts = async (...events: EventInput[]) => {
      const res = (await (await gpush(...events)).json()) as PushResponse;
      return events.map((e) => (res.accepted.includes(e.id) ? 'accepted' : res.rejected.find((r) => r.id === e.id)?.code));
    };
    return { guestId: guest.id, gpull, gpush, verdicts };
  };
  /** The share made now, and a guest of it. */
  const shared = async () => {
    const share = await shareList();
    return { share, ...(await joinAs(share)) };
  };
  const pulled = async (res: Response) => {
    expect(res.status).toBe(200);
    return (await res.json()) as PullResponse;
  };
  const maxSeq = () => (t.db.prepare('SELECT MAX(seq) AS s FROM events').get() as { s: number }).s;
  return { ...t, lines, anna, cookieA, send, ev, push, annaFold, shared, pulled, maxSeq };
}

describe('guest sync', { timeout: 30_000 }, () => {
  it('a guest pulls only the shared list', async () => {
    const t = await setup();
    const listB = newId();
    const [milk, screws] = [newId(), newId()];
    const before = [
      t.ev('list.created', { listId: listB, name: 'Hardware' }),
      t.ev('item.created', { itemId: milk, name: 'Milk' }),
      t.ev('entry.added', { listId: t.anna.listId, itemId: milk }),
      t.ev('item.created', { itemId: screws, name: 'Screws' }),
      t.ev('entry.added', { listId: listB, itemId: screws }),
    ];
    await t.push(...before);
    const g = await t.shared();
    const checked = t.ev('entry.checked', { listId: t.anna.listId, itemId: milk });
    await t.push(checked, t.ev('entry.checked', { listId: listB, itemId: screws }));
    const res = await t.pulled(await g.gpull());
    const signup = (t.db.prepare("SELECT id FROM events WHERE type = 'list.created' AND seq = 1").get() as { id: string }).id;
    expect(res.events.map((e) => e.id)).toEqual([signup, before[1]!.id, before[2]!.id, checked.id]);
    expect(res).toMatchObject({ lastSeq: t.maxSeq(), hasMore: false, serverTime: T0 });
  });

  it('a pull with nothing new answers empty', async () => {
    const t = await setup();
    const g = await t.shared();
    const { lastSeq } = await t.pulled(await g.gpull());
    expect(lastSeq).toBe(t.maxSeq());
    expect(await t.pulled(await g.gpull(lastSeq))).toEqual({ events: [], lastSeq, hasMore: false, serverTime: T0 });
  });

  it('an old item put on the list after the cursor arrives with its item events', async () => {
    const t = await setup();
    const eggs = newId();
    const created = t.ev('item.created', { itemId: eggs, name: 'Eggs' });
    await t.push(created);
    const g = await t.shared();
    const first = await t.pulled(await g.gpull());
    expect(first.events.map((e) => e.id)).not.toContain(created.id);
    const added = t.ev('entry.added', { listId: t.anna.listId, itemId: eggs });
    await t.push(added);
    const next = await t.pulled(await g.gpull(first.lastSeq));
    expect(next.events.map((e) => e.id)).toEqual([created.id, added.id]);
    expect(next.lastSeq).toBe(t.maxSeq());
  });

  it("a guest's events are stored as the guest's", async () => {
    const t = await setup();
    const g = await t.shared();
    const bread = newId();
    const events = [t.ev('item.created', { itemId: bread, name: 'Bread' }), t.ev('entry.added', { listId: t.anna.listId, itemId: bread })];
    expect(await g.verdicts(...events)).toEqual(['accepted', 'accepted']);
    expect(await g.verdicts(...events)).toEqual(['accepted', 'accepted']);
    for (const e of events)
      expect(t.db.prepare('SELECT user_id, session_id FROM events WHERE id = ?').get(e.id)).toEqual({ user_id: g.guestId, session_id: g.guestId });
    expect((await t.annaFold()).entries.get(entryKey(t.anna.listId, bread))?.addedBy).toBe(g.guestId);
  });

  it('what a guest may push', async () => {
    const t = await setup();
    const listB = newId();
    const [milk, screws, eggs] = [newId(), newId(), newId()];
    await t.push(
      t.ev('list.created', { listId: listB, name: 'Hardware' }),
      t.ev('item.created', { itemId: milk, name: 'Milk' }),
      t.ev('entry.added', { listId: t.anna.listId, itemId: milk }),
      t.ev('item.created', { itemId: screws, name: 'Screws' }),
      t.ev('item.created', { itemId: eggs, name: 'Eggs' }),
    );
    const g = await t.shared();
    const list = t.anna.listId;
    expect(await g.verdicts(t.ev('entry.added', { listId: list, itemId: milk }))).toEqual(['accepted']);
    expect(await g.verdicts(t.ev('entry.added', { listId: listB, itemId: milk }))).toEqual(['out_of_scope']);
    expect(await g.verdicts(t.ev('list.renamed', { listId: list, name: 'Mine now' }))).toEqual(['out_of_scope']);
    expect(await g.verdicts(t.ev('list.deleted', { listId: list }))).toEqual(['out_of_scope']);
    const own = newId();
    expect(await g.verdicts(t.ev('item.created', { itemId: own, name: 'Oat milk' }))).toEqual(['accepted']);
    expect(await g.verdicts(t.ev('item.renamed', { itemId: milk, name: 'Whole milk' }))).toEqual(['accepted']);
    expect(await g.verdicts(t.ev('item.renamed', { itemId: screws, name: 'Nails' }))).toEqual(['out_of_scope']);
    const fresh = newId();
    expect(
      await g.verdicts(t.ev('item.created', { itemId: fresh, name: 'Tofu' }), t.ev('item.renamed', { itemId: fresh, name: 'Smoked tofu' })),
    ).toEqual(['accepted', 'accepted']);
    expect(
      await g.verdicts(t.ev('entry.added', { listId: list, itemId: eggs }), t.ev('item.renamed', { itemId: eggs, name: 'Free-range eggs' })),
    ).toEqual(['accepted', 'accepted']);
    expect(await g.verdicts(t.ev('item.archived', { itemId: own }))).toEqual(['accepted']);
    expect(await g.verdicts(t.ev('item.archived', { itemId: screws }))).toEqual(['out_of_scope']);
    expect(await g.verdicts(t.ev('item.unarchived', { itemId: own }))).toEqual(['accepted']);
    expect(await g.verdicts(t.ev('item.unarchived', { itemId: screws }))).toEqual(['out_of_scope']);
    expect(await g.verdicts(t.ev('item.created', { itemId: newId(), name: 'Ham' }, { householdId: newId() }))).toEqual(['forbidden_household']);
    expect(await g.verdicts(t.ev('item.created', { itemId: newId(), name: 'Jam' }, { wall: T0 + 2 * HOUR }))).toEqual(['clock_skew']);
    const state = await t.annaFold();
    expect([state.lists.get(list)?.name, state.items.get(screws)?.name, state.items.get(screws)?.archived]).toEqual(['Inköpslista', 'Screws', false]);
    const logged = t.lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.msg === 'event rejected');
    expect(logged[0]).toMatchObject({ code: 'out_of_scope', guestId: g.guestId });
    expect(t.lines.join('')).not.toContain('Jonas');
  });

  const undoAdd = (name: string, oneBatch: boolean) => async () => {
    const t = await setup();
    const milk = newId();
    await t.push(t.ev('item.created', { itemId: milk, name: 'Milk' }));
    const g = await t.shared();
    const item = newId();
    const created = t.ev('item.created', { itemId: item, name });
    const added = t.ev('entry.added', { listId: t.anna.listId, itemId: item });
    const removed = t.ev('entry.removed', { listId: t.anna.listId, itemId: item }, { undoOf: added.id });
    const archived = t.ev('item.archived', { itemId: item }, { undoOf: created.id });
    const verdicts = oneBatch
      ? await g.verdicts(created, added, removed, archived)
      : [...(await g.verdicts(created, added)), ...(await g.verdicts(removed, archived))];
    // the household's Milk: the guest's item is an alias of it
    const theirs = name.toLowerCase() === 'milk';
    expect(verdicts).toEqual(['accepted', 'accepted', 'accepted', theirs ? 'out_of_scope' : 'accepted']);
    const state = await t.annaFold();
    expect(state.items.get(milk)?.archived).toBe(false);
    if (!theirs) expect(state.items.get(item)?.archived).toBe(true);
  };

  it("undoing a guest's add of a name the household has never archives the household's item", undoAdd('milk', false));

  it("undoing a guest's add of a new item works", undoAdd('Oat milk', false));

  it('an add and its undo in one batch, as an offline phone sends them', async () => {
    await undoAdd('Oat milk', true)();
    await undoAdd('milk', true)();
  });

  it("a backdated name doesn't hand a guest the household's item", async () => {
    const t = await setup();
    const milk = newId();
    const theirs = t.ev('item.created', { itemId: milk, name: 'Milk' });
    await t.push(theirs);
    const g = await t.shared();
    const mine = newId();
    expect(await g.verdicts(t.ev('item.created', { itemId: mine, name: 'Milk' }, { wall: hlcWall(theirs.hlc) - HOUR / 2 }))).toEqual(['accepted']);
    expect(await g.verdicts(t.ev('item.archived', { itemId: mine }), t.ev('item.renamed', { itemId: mine, name: 'Mine' }))).toEqual([
      'out_of_scope',
      'out_of_scope',
    ]);
    const state = await t.annaFold();
    expect(state.items.get(resolveItemId(state, milk))).toMatchObject({ name: 'Milk', archived: false });
  });

  it("a guest's new item the household made later stays the household's", async () => {
    const t = await setup();
    const g = await t.shared();
    const mine = newId();
    expect(await g.verdicts(t.ev('item.created', { itemId: mine, name: 'Bread' }))).toEqual(['accepted']);
    const bread = newId();
    await t.push(t.ev('item.created', { itemId: bread, name: 'Bread' }));
    expect((await t.annaFold()).aliases.get(bread)).toBe(mine);
    expect(await g.verdicts(t.ev('item.archived', { itemId: mine }))).toEqual(['out_of_scope']);
    expect((await t.annaFold()).items.get(mine)?.archived).toBe(false);
  });

  it("a guest can't claim a household item by its id", async () => {
    const t = await setup();
    const milk = newId();
    await t.push(t.ev('item.created', { itemId: milk, name: 'Milk' }), t.ev('entry.added', { listId: t.anna.listId, itemId: milk }));
    const g = await t.shared();
    expect((await t.pulled(await g.gpull())).events.map((e) => e.type === 'item.created' && e.payload.itemId)).toContain(milk);
    expect(await g.verdicts(t.ev('item.created', { itemId: milk, name: 'Mine' }))).toEqual(['out_of_scope']);
    expect(await g.verdicts(t.ev('item.archived', { itemId: milk }))).toEqual(['out_of_scope']);
    expect((await t.annaFold()).items.get(milk)).toMatchObject({ name: 'Milk', archived: false });
  });

  it("a backdated name in one batch can't rename or unarchive a household item", async () => {
    const t = await setup();
    const bread = newId();
    await t.push(t.ev('item.created', { itemId: bread, name: 'Bread' }), t.ev('item.archived', { itemId: bread }));
    const g = await t.shared();
    const mine = newId();
    expect(
      await g.verdicts(
        t.ev('item.created', { itemId: mine, name: 'Bread' }, { wall: T0 - HOUR / 2 }),
        t.ev('item.renamed', { itemId: mine, name: 'Junk' }),
        t.ev('item.unarchived', { itemId: mine }),
      ),
    ).toEqual(['accepted', 'out_of_scope', 'out_of_scope']);
    const state = await t.annaFold();
    expect(state.items.get(resolveItemId(state, bread))).toMatchObject({ name: 'Bread', archived: true });
  });

  it("a backdated name in one batch can't rename or archive a household item on another list", async () => {
    const t = await setup();
    const [bakery, bread] = [newId(), newId()];
    await t.push(
      t.ev('list.created', { listId: bakery, name: 'Bakery' }, { wall: T0 - 100 }),
      t.ev('item.created', { itemId: bread, name: 'Bread' }, { wall: T0 - 90 }),
      t.ev('entry.added', { listId: bakery, itemId: bread }, { wall: T0 - 80 }),
      t.ev('item.renamed', { itemId: bread, name: 'Sourdough' }, { wall: T0 - 50 }),
    );
    const g = await t.shared();
    const mine = newId();
    expect(
      await g.verdicts(
        t.ev('item.created', { itemId: mine, name: 'Bread' }, { wall: T0 - 70 }),
        t.ev('item.renamed', { itemId: mine, name: 'Junk' }),
        t.ev('item.archived', { itemId: mine }),
      ),
    ).toEqual(['accepted', 'out_of_scope', 'out_of_scope']);
    const state = await t.annaFold();
    expect(state.items.get(bread)).toMatchObject({ name: 'Sourdough', archived: false });
    expect(state.entries.get(entryKey(bakery, bread))?.state).toBe('active');
  });

  it('a refused item change refuses every item change in the batch', async () => {
    const t = await setup();
    const [bread, milk] = [newId(), newId()];
    await t.push(
      t.ev('item.created', { itemId: bread, name: 'Bread' }, { wall: T0 - 100 }),
      t.ev('item.created', { itemId: milk, name: 'Milk' }),
      t.ev('entry.added', { listId: t.anna.listId, itemId: milk }),
    );
    const g = await t.shared();
    const mine = newId();
    // the judged fold holds the refused rename, which frees "Bread" before the guest's create: without it, the guest's
    // "Bread" is an alias of the household's, so nothing judged beside it stands
    expect(
      await g.verdicts(
        t.ev('item.renamed', { itemId: bread, name: 'Rye' }, { wall: T0 - 60 }),
        t.ev('item.created', { itemId: mine, name: 'Bread' }, { wall: T0 - 50 }),
        t.ev('item.archived', { itemId: mine }),
        t.ev('item.renamed', { itemId: milk, name: 'Oat milk' }),
      ),
    ).toEqual(['out_of_scope', 'accepted', 'out_of_scope', 'out_of_scope']);
    const state = await t.annaFold();
    expect(state.items.get(bread)).toMatchObject({ name: 'Bread', archived: false });
    expect(state.items.get(milk)?.name).toBe('Milk');
  });

  it('one event id twice in a batch is judged as it will be stored', async () => {
    const t = await setup();
    const [bakery, bread] = [newId(), newId()];
    await t.push(
      t.ev('list.created', { listId: bakery, name: 'Bakery' }),
      t.ev('item.created', { itemId: bread, name: 'Bread' }),
      t.ev('entry.added', { listId: bakery, itemId: bread }),
    );
    const g = await t.shared();
    const mine = newId();
    const first = t.ev('item.created', { itemId: mine, name: 'Bread' }, { wall: T0 - HOUR / 2 });
    const again = { ...t.ev('item.created', { itemId: mine, name: 'Zzz unique' }, { wall: T0 - HOUR / 2 - 10 }), id: first.id };
    expect(
      await g.verdicts(first, again, t.ev('item.renamed', { itemId: mine, name: 'Junk' }), t.ev('item.archived', { itemId: mine })),
    ).toEqual(['accepted', 'accepted', 'out_of_scope', 'out_of_scope']);
    const state = await t.annaFold();
    const id = resolveItemId(state, bread);
    expect(state.items.get(id)).toMatchObject({ name: 'Bread', archived: false });
    expect(state.entries.get(entryKey(bakery, id))?.state).toBe('active');
  });

  it("a household event's id sent again is judged as stored, not as sent", async () => {
    const t = await setup();
    const g = await t.shared();
    const bread = newId();
    const theirs = t.ev('item.created', { itemId: bread, name: 'Bread' });
    await t.push(theirs);
    const resent = { ...t.ev('item.created', { itemId: newId(), name: 'Zzz unique' }, { wall: hlcWall(theirs.hlc) - 10 }), id: theirs.id };
    const mine = newId();
    expect(
      await g.verdicts(resent, t.ev('item.created', { itemId: mine, name: 'Bread' }), t.ev('item.archived', { itemId: mine })),
    ).toEqual(['accepted', 'accepted', 'out_of_scope']);
    expect((await t.annaFold()).items.get(bread)).toMatchObject({ name: 'Bread', archived: false });
  });

  it('a rename judged beside a refused unarchive is refused too', async () => {
    const t = await setup();
    const bread = newId();
    await t.push(
      t.ev('item.created', { itemId: bread, name: 'Bread' }, { wall: T0 - 100 }),
      t.ev('item.archived', { itemId: bread }, { wall: T0 - 50 }),
    );
    const g = await t.shared();
    const [mine, other] = [newId(), newId()];
    expect(
      await g.verdicts(
        t.ev('item.created', { itemId: mine, name: 'Bread' }, { wall: T0 - 90 }),
        t.ev('item.unarchived', { itemId: mine }, { wall: T0 - 40 }),
        t.ev('item.created', { itemId: other, name: 'Bread' }, { wall: T0 - 30 }),
        t.ev('entry.added', { listId: t.anna.listId, itemId: other }),
        t.ev('item.renamed', { itemId: mine, name: 'Junk' }),
      ),
    ).toEqual(['accepted', 'out_of_scope', 'accepted', 'accepted', 'out_of_scope']);
    const state = await t.annaFold();
    expect(state.items.get(bread)).toMatchObject({ name: 'Bread', archived: true });
    expect(state.entries.has(entryKey(t.anna.listId, bread))).toBe(false);
  });

  it("a guest can't date an item before the link to reach an archived one", async () => {
    const t = await setup();
    const bread = newId();
    await t.push(t.ev('item.created', { itemId: bread, name: 'Bread' }), t.ev('item.archived', { itemId: bread }));
    const g = await t.shared();
    const mine = newId();
    expect(
      await g.verdicts(
        t.ev('item.created', { itemId: mine, name: 'Bread' }, { wall: T0 - DAY }),
        t.ev('entry.added', { listId: t.anna.listId, itemId: mine }),
        t.ev('item.renamed', { itemId: mine, name: 'Junk' }),
      ),
    ).toEqual(['clock_skew', 'accepted', 'accepted']);
    const state = await t.annaFold();
    expect(state.items.get(resolveItemId(state, bread))).toMatchObject({ id: bread, name: 'Bread', archived: true });
    expect(state.entries.has(entryKey(t.anna.listId, bread))).toBe(false);
  });

  it('a guest event dated two hours before the link is clock_skew', async () => {
    const t = await setup();
    const g = await t.shared();
    expect(await g.verdicts(t.ev('item.created', { itemId: newId(), name: 'Bread' }, { wall: T0 - 2 * HOUR }))).toEqual(['clock_skew']);
    expect(await g.verdicts(t.ev('item.created', { itemId: newId(), name: 'Rye' }, { wall: T0 - HOUR / 2 }))).toEqual(['accepted']);
  });

  it('an ended link refuses pull and push', async () => {
    const t = await setup();
    const g = await t.shared();
    expect((await t.send('DELETE', `/api/shares/${g.share.id}`, undefined, t.cookieA)).status).toBe(204);
    for (const res of [await g.gpull(), await g.gpush(t.ev('item.created', { itemId: newId(), name: 'Bread' }))])
      expect([res.status, await res.json()]).toEqual([401, { error: 'share_ended' }]);
  });
});
