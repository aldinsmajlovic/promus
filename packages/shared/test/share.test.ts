import { describe, expect, it } from 'vitest';
import type { EventType, PayloadOf, StoredEvent } from '../src/index.ts';
import { fold, formatHlc, listView, newId, scopeItems, sharedEvents } from '../src/index.ts';

const stored = <T extends EventType>(
  type: T,
  payload: PayloadOf<T>,
  { seq, wall, ...extra }: { seq: number; wall: number; userId?: string; id?: string; undoOf?: string },
): StoredEvent =>
  ({
    id: newId(), householdId: 'home', type, v: 1, hlc: formatHlc(wall, 0, 't'), occurredAt: wall,
    payload, seq, userId: 'u1', receivedAt: wall, ...extra,
  }) as StoredEvent;

const DAY = 86_400_000;
const HOUR = 3_600_000;
const L = 'list-taco';
const L2 = 'list-cabin';
const madeAt = 10 * DAY;
const sv = new Intl.Collator('sv');

const listL = stored('list.created', { listId: L, name: 'Taco night' }, { seq: 1, wall: DAY });
const created = {
  milk: stored('item.created', { itemId: 'milk', name: 'Mjölk' }, { seq: 2, wall: DAY + 1 }),
  bread: stored('item.created', { itemId: 'bread', name: 'Bröd' }, { seq: 3, wall: DAY + 2 }),
  soap: stored('item.created', { itemId: 'soap', name: 'Tvål' }, { seq: 4, wall: DAY + 3 }),
  eggs: stored('item.created', { itemId: 'eggs', name: 'Ägg' }, { seq: 5, wall: DAY + 4 }),
  butter: stored('item.created', { itemId: 'butter', name: 'Smör' }, { seq: 6, wall: DAY + 5 }),
};
const household = [
  listL,
  ...Object.values(created),
  stored('list.created', { listId: L2, name: 'Stuga' }, { seq: 7, wall: DAY + 6 }),
];
const on = (listId: string, itemId: string) => ({ listId, itemId });

describe('sharedEvents', () => {
  it('a guest gets the list, its entries and their items, and nothing else', () => {
    const milkAdded = stored('entry.added', on(L, 'milk'), { seq: 8, wall: 9 * DAY });
    const all = [
      ...household,
      milkAdded,
      stored('entry.added', on(L2, 'soap'), { seq: 9, wall: 9 * DAY + 1 }),
      // after the link, none of these concern the list
      stored('entry.checked', on(L2, 'soap'), { seq: 10, wall: madeAt + HOUR }),
      stored('entry.added', on(L2, 'soap'), { seq: 11, wall: madeAt + 2 * HOUR }),
      stored('item.renamed', { itemId: 'bread', name: 'Surdegsbröd' }, { seq: 12, wall: madeAt + 3 * HOUR }),
      stored('list.renamed', { listId: L2, name: 'Fjällstugan' }, { seq: 13, wall: madeAt + 4 * HOUR }),
    ];
    const scope = { listId: L, fromSeq: 9, madeAt };
    expect(sharedEvents(all, scope, 0)).toEqual([listL, created.milk, milkAdded]);
    expect(scopeItems(all, scope)).toEqual(new Set(['milk']));
  });

  it('nothing from before the link, except what the list at that moment needs', () => {
    const milkAgain = stored('entry.added', on(L, 'milk'), { seq: 12, wall: 9 * DAY });
    const butter = [
      stored('entry.added', on(L, 'butter'), { seq: 13, wall: 9 * DAY + 1 }),
      stored('entry.checked', on(L, 'butter'), { seq: 14, wall: madeAt - 2 * HOUR }),
    ];
    const all = [
      ...household,
      stored('entry.added', on(L, 'milk'), { seq: 8, wall: DAY + HOUR }),
      stored('entry.checked', on(L, 'milk'), { seq: 9, wall: 2 * DAY }),
      stored('entry.added', on(L, 'eggs'), { seq: 10, wall: 7 * DAY }),
      stored('entry.checked', on(L, 'eggs'), { seq: 11, wall: 7 * DAY + HOUR }),
      milkAgain,
      ...butter,
    ];
    expect(sharedEvents(all, { listId: L, fromSeq: 14, madeAt }, 0)).toEqual([
      listL, created.milk, created.butter, milkAgain, ...butter,
    ]);
  });

  it('an item put on the list after the link comes with its item events', () => {
    const breadAdded = stored('entry.added', on(L, 'bread'), { seq: 8, wall: madeAt + HOUR });
    expect(sharedEvents([...household, breadAdded], { listId: L, fromSeq: 7, madeAt }, 0)).toEqual([
      listL, created.bread, breadAdded,
    ]);
  });

  it('an item entering after the cursor brings its earlier item events', () => {
    const scope = { listId: L, fromSeq: 8, madeAt };
    const before = [...household, stored('entry.added', on(L, 'milk'), { seq: 8, wall: 9 * DAY })];
    const cursor = sharedEvents(before, scope, 0).at(-1)!.seq;
    const later = [
      stored('entry.added', on(L, 'bread'), { seq: 9, wall: madeAt + HOUR }),
      stored('entry.checked', on(L, 'milk'), { seq: 10, wall: madeAt + 2 * HOUR }),
    ];
    expect(sharedEvents([...before, ...later], scope, cursor)).toEqual([created.bread, ...later]);
  });

  it('aliases come along', () => {
    const m1 = [
      stored('item.created', { itemId: 'm1', name: 'milk' }, { seq: 2, wall: DAY + 1 }),
      stored('item.renamed', { itemId: 'm1', name: 'Milk' }, { seq: 3, wall: DAY + 2 }),
    ];
    const m2 = [
      stored('item.created', { itemId: 'm2', name: 'milk' }, { seq: 4, wall: madeAt + HOUR }),
      stored('entry.added', on(L, 'm2'), { seq: 5, wall: madeAt + HOUR + 1 }),
    ];
    const all = [listL, ...m1, ...m2];
    const scope = { listId: L, fromSeq: 3, madeAt };
    expect(sharedEvents(all, scope, 0)).toEqual([listL, ...m1, ...m2]);
    expect(scopeItems(all, scope)).toEqual(new Set(['m1']));
  });

  it('prices come along for the items in scope, also from before the link', () => {
    const milkPrice = stored('item.priceSet', { itemId: 'milk', price: 1490 }, { seq: 8, wall: 2 * DAY });
    const soapPrice = stored('item.priceSet', { itemId: 'soap', price: 2990 }, { seq: 9, wall: 2 * DAY + 1 });
    const milkAdded = stored('entry.added', { ...on(L, 'milk'), quantity: 3 }, { seq: 10, wall: 9 * DAY });
    const all = [...household, milkPrice, soapPrice, milkAdded];
    const shared = sharedEvents(all, { listId: L, fromSeq: 10, madeAt }, 0);
    expect(shared).toContain(milkPrice);
    expect(shared).not.toContain(soapPrice);
    expect(listView(fold(shared), L, madeAt, sv).active[0]).toMatchObject({ itemId: 'milk', quantity: 3, price: 1490 });
  });

  it("each entry shows as the household's does", () => {
    const pre = [
      stored('item.created', { itemId: 'cream', name: 'Grädde' }, { seq: 8, wall: DAY + 7 }),
      stored('entry.added', on(L2, 'soap'), { seq: 9, wall: DAY + 8 }),
      stored('entry.added', { ...on(L, 'milk'), note: 'laktosfri' }, { seq: 10, wall: DAY + HOUR }),
      stored('entry.checked', on(L, 'milk'), { seq: 11, wall: 2 * DAY, userId: 'u2' }),
      stored('entry.added', on(L, 'eggs'), { seq: 12, wall: 7 * DAY }),
      stored('entry.checked', on(L, 'eggs'), { seq: 13, wall: 7 * DAY + HOUR }),
      stored('entry.added', { ...on(L, 'milk'), note: 'mellan' }, { seq: 14, wall: 9 * DAY, userId: 'u2' }),
      stored('entry.added', on(L, 'butter'), { seq: 15, wall: 9 * DAY + 1 }),
      stored('entry.checked', on(L, 'butter'), { seq: 16, wall: madeAt - 2 * HOUR }),
      stored('item.created', { itemId: 'cheese', name: 'Ost' }, { seq: 17, wall: DAY + 9 }),
      stored('entry.checked', on(L, 'cheese'), { seq: 18, wall: madeAt - 4 * HOUR, userId: 'u2' }),
    ];
    const post = [
      // late arrivals: pushed after the link, from before it
      stored('entry.noteSet', { ...on(L, 'milk'), note: 'eko' }, { seq: 19, wall: 3 * DAY }),
      stored('entry.noteSet', { ...on(L, 'butter'), note: 'osaltat' }, { seq: 20, wall: madeAt - 3 * HOUR }),
      stored('entry.checked', on(L, 'milk'), { seq: 21, wall: madeAt - HOUR, userId: 'u3' }),
      stored('entry.added', { ...on(L, 'cheese'), note: 'riven' }, { seq: 22, wall: madeAt - 5 * HOUR, userId: 'u3' }),
      stored('entry.added', on(L, 'bread'), { seq: 23, wall: madeAt + HOUR, userId: 'u3' }),
      stored('entry.added', on(L, 'eggs'), { seq: 24, wall: madeAt + 2 * HOUR }),
      stored('item.created', { itemId: 'cream2', name: 'grädde' }, { seq: 25, wall: madeAt + 3 * HOUR }),
      stored('entry.added', { ...on(L, 'cream2'), note: 'vispgrädde' }, { seq: 26, wall: madeAt + 3 * HOUR + 1 }),
      stored('entry.checked', on(L, 'bread'), { seq: 27, wall: madeAt + 4 * HOUR }),
      // prices and quantities, one of each from before the link, and one arriving late
      stored('item.priceSet', { itemId: 'milk', price: 1490 }, { seq: 28, wall: 5 * DAY }),
      stored('entry.quantitySet', { ...on(L, 'milk'), quantity: 2 }, { seq: 29, wall: 3 * DAY }),
      stored('entry.quantitySet', { ...on(L, 'butter'), quantity: 3 }, { seq: 30, wall: madeAt + 5 * HOUR }),
      stored('entry.added', { ...on(L, 'soap'), quantity: 4 }, { seq: 31, wall: madeAt + 6 * HOUR }),
      stored('item.priceSet', { itemId: 'soap', price: 2990 }, { seq: 32, wall: madeAt + 7 * HOUR }),
    ];
    const all = [...household, ...pre, ...post];
    const shared = sharedEvents(all, { listId: L, fromSeq: 18, madeAt }, 0);
    for (const now of [madeAt, madeAt + DAY]) {
      const theirs = listView(fold(all), L, now, sv);
      expect(theirs.active.length + theirs.done.length).toBeGreaterThan(0);
      expect(listView(fold(shared), L, now, sv)).toEqual(theirs);
    }
  });
});
