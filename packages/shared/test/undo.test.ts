import { describe, expect, it } from 'vitest';
import type { EventType, FoldEvent, PayloadOf } from '../src/index.ts';
import { fold, formatHlc, frequentItems, inverseOf, listSummaries, listView, newId } from '../src/index.ts';

const ev = <T extends EventType>(type: T, payload: PayloadOf<T>, wall: number, undoOf?: string): FoldEvent =>
  ({ id: newId(), type, v: 1, hlc: formatHlc(wall, 0, 't'), occurredAt: wall, payload, undoOf }) as FoldEvent;

const L = 'list-home';
const NOW = 1_000_000;
const sv = new Intl.Collator('sv', { numeric: true });
const e = (itemId: string) => ({ listId: L, itemId });

// milk: active with a note, bread: checked, eggs: exists but not on the list
const setup = [
  ev('list.created', { listId: L, name: 'Hem' }, 1),
  ev('item.created', { itemId: 'milk', name: 'Mjölk' }, 2),
  ev('item.created', { itemId: 'bread', name: 'Bröd' }, 3),
  ev('item.created', { itemId: 'eggs', name: 'Ägg' }, 4),
  ev('entry.added', { ...e('milk'), note: 'laktosfri' }, 5),
  ev('entry.added', e('bread'), 6),
  ev('entry.checked', e('bread'), 7),
];

// a restored check is stamped with the undo's time, so checkedAt is left out of the comparison
const snapshot = (events: FoldEvent[]) => {
  const s = fold(events);
  const { active, done } = listView(s, L, NOW, sv);
  const bare = (xs: typeof active) => xs.map(({ checkedAt: _, ...rest }) => rest);
  return { active: bare(active), done: bare(done), lists: listSummaries(s, sv) };
};

const actions: [string, FoldEvent][] = [
  ['entry.added (absent)', ev('entry.added', { ...e('eggs'), note: 'stora' }, 100)],
  ['entry.added (active)', ev('entry.added', { ...e('milk'), note: 'havre' }, 100)],
  ['entry.checked', ev('entry.checked', e('milk'), 100)],
  ['entry.unchecked', ev('entry.unchecked', e('bread'), 100)],
  ['entry.removed (active)', ev('entry.removed', e('milk'), 100)],
  ['entry.removed (checked)', ev('entry.removed', e('bread'), 100)],
  ['entry.noteSet', ev('entry.noteSet', { ...e('milk'), note: 'lätt' }, 100)],
  ['item.created', ev('item.created', { itemId: 'tea', name: 'Te' }, 100)],
  ['item.renamed', ev('item.renamed', { itemId: 'milk', name: 'Havredryck' }, 100)],
  ['item.archived', ev('item.archived', { itemId: 'milk' }, 100)],
  ['list.created', ev('list.created', { listId: 'new', name: 'Stuga' }, 100)],
  ['list.renamed', ev('list.renamed', { listId: L, name: 'Lägenhet' }, 100)],
  ['list.deleted', ev('list.deleted', { listId: L }, 100)],
];

describe('inverseOf', () => {
  it.each(actions)('applying an action and then its inverse restores the list view: %s', (_name, action) => {
    const before = fold(setup);
    const inverse = inverseOf(action, before).map((d, i) => ({ ...ev(d.type, d.payload, 200 + i, d.undoOf) }));
    expect(inverse.length).toBeGreaterThan(0);
    expect(inverse.every((d) => d.undoOf === action.id)).toBe(true);
    expect(snapshot([...setup, action, ...inverse])).toEqual(snapshot(setup));
  });

  it('has no inverse for events that cannot be undone', () => {
    const before = fold(setup);
    expect(inverseOf(ev('item.unarchived', { itemId: 'milk' }, 100), before)).toEqual([]);
    expect(inverseOf(ev('list.restored', { listId: L }, 100), before)).toEqual([]);
    expect(inverseOf(ev('entry.noteSet', { ...e('eggs'), note: 'x' }, 100), before)).toEqual([]);
  });

  it('undoing the creation of a new item hides it from suggestions', () => {
    const create = ev('item.created', { itemId: 'tea', name: 'Te' }, 10);
    const buy = [ev('entry.added', e('tea'), 11), ev('entry.checked', e('tea'), 12)];
    const [inv] = inverseOf(create, fold(setup));
    const s = fold([...setup, create, ...buy, ev(inv!.type, inv!.payload, 13, inv!.undoOf)]);
    expect(frequentItems(s, L, NOW + 10 * 86_400_000).map((i) => i.id)).not.toContain('tea');
  });

  it('undoing a new item archives it even when an archived item had its name', () => {
    const old = [ev('item.created', { itemId: 'old', name: 'Mjolk' }, 10), ev('item.archived', { itemId: 'old' }, 11)];
    const create = ev('item.created', { itemId: 'new', name: 'Mjolk' }, 12);
    const buy = [ev('entry.added', e('new'), 13), ev('entry.checked', e('new'), 14)];
    const [inv] = inverseOf(create, fold([...setup, ...old]));
    expect(inv).toEqual({ type: 'item.archived', payload: { itemId: 'new' }, undoOf: create.id });
    const s = fold([...setup, ...old, create, ...buy, ev(inv!.type, inv!.payload, 15, inv!.undoOf)]);
    expect(s.items.get('new')!.archived).toBe(true);
    expect(frequentItems(s, L, NOW + 10 * 86_400_000).map((i) => i.id)).not.toContain('new');
  });

  it('undoing an unarchive archives the item again', () => {
    const archived = fold([...setup, ev('item.archived', { itemId: 'milk' }, 10)]);
    const unarchive = ev('item.unarchived', { itemId: 'milk' }, 11);
    expect(inverseOf(unarchive, archived)).toEqual([
      { type: 'item.archived', payload: { itemId: 'milk' }, undoOf: unarchive.id },
    ]);
  });

  it('undoing a check removes the purchase', () => {
    const check = ev('entry.checked', e('milk'), 100);
    const afterCheck = fold([...setup, check]);
    expect(afterCheck.items.get('milk')!.purchaseCount).toBe(1);
    const [inv] = inverseOf(check, fold(setup));
    const s = fold([...setup, check, ev(inv!.type, inv!.payload, 101, inv!.undoOf)]);
    expect(s.items.get('milk')!.purchaseCount).toBe(0);
    expect(s.items.get('milk')!.lastPurchasedAt).toBeNull();
  });
});
