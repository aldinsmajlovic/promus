import { describe, expect, it } from 'vitest';
import type { EventType, FoldEvent, PayloadOf } from '../src/index.ts';
import { fold, formatHlc, frequentItems, listSummaries, listView, newId } from '../src/index.ts';

const ev = <T extends EventType>(type: T, payload: PayloadOf<T>, wall: number, undoOf?: string): FoldEvent =>
  ({ id: newId(), type, v: 1, hlc: formatHlc(wall, 0, 't'), occurredAt: wall, payload, undoOf }) as FoldEvent;

const L = 'list-home';
const H = 3_600_000;
const NOW = 1_000 * 24 * H;
const sv = new Intl.Collator('sv', { numeric: true });
const base = [ev('list.created', { listId: L, name: 'Hem' }, 1)];
const item = (itemId: string, name: string, wall: number) => ev('item.created', { itemId, name }, wall);
const buy = (itemId: string, wall: number) => [
  ev('entry.added', { listId: L, itemId }, wall),
  ev('entry.checked', { listId: L, itemId }, wall + 1),
];

describe('views', () => {
  it('active rows carry who added them', () => {
    const s = fold([...base, item('milk', 'Mjölk', 2), { ...ev('entry.added', { listId: L, itemId: 'milk' }, 3), userId: 'u1' }]);
    expect(listView(s, L, NOW, sv).active[0]!.addedBy).toBe('u1');
  });

  it('sorts active entries the Swedish way', () => {
    const names = ['Ägg', 'Bananer', 'Vispgrädde', 'Kaffe'];
    const s = fold([
      ...base,
      ...names.flatMap((n, i) => [item(`i${i}`, n, 10 + i), ev('entry.added', { listId: L, itemId: `i${i}` }, 20 + i)]),
    ]);
    expect(listView(s, L, NOW, sv).active.map((e) => e.name)).toEqual(['Bananer', 'Kaffe', 'Vispgrädde', 'Ägg']);
  });

  it('shows checked items in Done for 24 hours', () => {
    const s = fold([
      ...base,
      item('new', 'Nytt', 2),
      item('old', 'Gammalt', 3),
      ...buy('new', NOW - 23 * H),
      ...buy('old', NOW - 25 * H),
    ]);
    const v = listView(s, L, NOW, sv);
    expect(v.done.map((e) => e.name)).toEqual(['Nytt']);
    expect(v.active).toEqual([]);
  });

  it('returns nothing for a deleted list', () => {
    const s = fold([...base, item('a', 'A', 2), ev('entry.added', { listId: L, itemId: 'a' }, 3), ev('list.deleted', { listId: L }, 4)]);
    expect(listView(s, L, NOW, sv)).toEqual({ active: [], done: [] });
    expect(listView(s, 'missing', NOW, sv)).toEqual({ active: [], done: [] });
    expect(listSummaries(s, sv)).toEqual([]);
  });

  it('summarises non-deleted lists with active counts, sorted by name', () => {
    const s = fold([
      ...base,
      ev('list.created', { listId: 'b', name: 'Affär' }, 2),
      item('a', 'A', 3),
      ev('entry.added', { listId: L, itemId: 'a' }, 4),
    ]);
    expect(listSummaries(s, sv)).toEqual([
      { id: 'b', name: 'Affär', activeCount: 0 },
      { id: L, name: 'Hem', activeCount: 1 },
    ]);
  });

  it('ranks frequent items by count and recency and skips archived, active and just-bought items', () => {
    const day = 24 * H;
    const s = fold([
      ...base,
      ...['often', 'rare', 'stale', 'archived', 'active', 'justBought', 'never'].map((n, i) => item(n, n, 2 + i)),
      ...buy('often', NOW - 10 * day), ...buy('often', NOW - 9 * day), ...buy('often', NOW - 8 * day),
      ...buy('rare', NOW - 5 * day),
      ...buy('stale', NOW - 300 * day),
      ...buy('archived', NOW - 2 * day),
      ev('item.archived', { itemId: 'archived' }, NOW - day),
      ...buy('active', NOW - 3 * day),
      ev('entry.added', { listId: L, itemId: 'active' }, NOW - day),
      ...buy('justBought', NOW - 2 * H),
    ]);
    expect(frequentItems(s, L, NOW).map((i) => i.id)).toEqual(['often', 'rare', 'stale']);
    expect(frequentItems(s, L, NOW, 1).map((i) => i.id)).toEqual(['often']);
  });
});
