import { describe, expect, it } from 'vitest';
import type { EventType, FoldEvent, PayloadOf } from '../src/index.ts';
import { fold, formatHlc, newId, planAddByName, planCheck, planRemove, planUncheck } from '../src/index.ts';

const ev = <T extends EventType>(type: T, payload: PayloadOf<T>, wall: number): FoldEvent =>
  ({ id: newId(), type, v: 1, hlc: formatHlc(wall, 0, 't'), occurredAt: wall, payload }) as FoldEvent;

const L = 'list-home';
const MJOLK = 'milk';
const state = (...events: FoldEvent[]) => fold([ev('list.created', { listId: L, name: 'Hem' }, 1), ...events]);
const item = (itemId: string, name: string, wall: number) => ev('item.created', { itemId, name }, wall);
const added = (itemId: string, wall: number, extra: { note?: string; quantity?: number } = {}) =>
  ev('entry.added', { listId: L, itemId, ...extra }, wall);

describe('plans', () => {
  it('planAddByName matches case-insensitively and re-adds with the last note and quantity', () => {
    const s = state(
      item(MJOLK, 'Mjölk', 2),
      added(MJOLK, 3, { note: 'laktosfri', quantity: 2 }),
      ev('entry.checked', { listId: L, itemId: MJOLK }, 4),
    );
    expect(planAddByName(s, L, 'MJÖLK')?.drafts).toEqual([
      { type: 'entry.added', payload: { listId: L, itemId: MJOLK, note: 'laktosfri', quantity: 2 } },
    ]);
  });

  it('planAddByName treats diacritics as letters: "lok" is a new item beside "Lök"', () => {
    const s = state(item('onion', 'Lök', 2), added('onion', 3));
    expect(planAddByName(s, L, 'lok')?.drafts.map((d) => d.type)).toEqual(['item.created', 'entry.added']);
  });

  it('planAddByName is null for an item already active on the list', () => {
    const s = state(item(MJOLK, 'Mjölk', 2), added(MJOLK, 3));
    expect(planAddByName(s, L, 'mjölk')).toBeNull();
  });

  it('planAddByName brings an item back from Later', () => {
    const s = state(item(MJOLK, 'Mjölk', 2), added(MJOLK, 3), ev('entry.laterSet', { listId: L, itemId: MJOLK, later: true }, 4));
    expect(planAddByName(s, L, 'mjölk')?.drafts).toEqual([
      { type: 'entry.laterSet', payload: { listId: L, itemId: MJOLK, later: false } },
    ]);
  });

  it('planAddByName unarchives an archived item of that name, then re-adds it', () => {
    const s = state(item(MJOLK, 'Mjölk', 2), ev('item.archived', { itemId: MJOLK }, 3));
    expect(planAddByName(s, L, 'Mjölk')?.drafts.map((d) => d.type)).toEqual(['item.unarchived', 'entry.added']);
  });

  it('planCheck, planUncheck and planRemove are null when there is nothing to change', () => {
    const s = state(
      item('a', 'Active', 2),
      added('a', 3),
      item('c', 'Checked', 4),
      added('c', 5),
      ev('entry.checked', { listId: L, itemId: 'c' }, 6),
      item('n', 'Nowhere', 7),
    );
    expect(planCheck(s, L, 'c')).toBeNull();
    expect(planUncheck(s, L, 'a')).toBeNull();
    expect(planRemove(s, L, 'n')).toBeNull();
  });

  it('planCheck resolves an alias to the surviving item', () => {
    const s = state(item('survivor', 'Ost', 2), item('alias', 'Ost', 3), added('survivor', 4));
    expect(planCheck(s, L, 'alias')?.drafts).toEqual([
      { type: 'entry.checked', payload: { listId: L, itemId: 'survivor' } },
    ]);
  });
});
