import { describe, expect, it } from 'vitest';
import type { EventType, FoldEvent, PayloadOf } from '../src/index.ts';
import { entryKey, fold, formatHlc, newId, resolveItemId, toSnapshot } from '../src/index.ts';

const ev = <T extends EventType>(
  type: T,
  payload: PayloadOf<T>,
  wall: number,
  extra: { id?: string; undoOf?: string; occurredAt?: number; userId?: string } = {},
): FoldEvent => ({ id: newId(), type, v: 1, hlc: formatHlc(wall, 0, 't'), occurredAt: wall, payload, ...extra }) as FoldEvent;

const L = 'list-home';
const L2 = 'list-cabin';

const unknownEvent = (wall: number) =>
  ({ id: newId(), type: 'list.pinned', v: 1, hlc: formatHlc(wall, 0, 't'), occurredAt: wall, payload: { listId: L } });

// Park-Miller PRNG: seeded, so every run shuffles the same way
const prng = (seed: number) => () => (seed = (seed * 48271) % 2147483647) / 2147483647;

function shuffled<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const setup = [ev('list.created', { listId: L, name: 'Hem' }, 1), ev('item.created', { itemId: 'milk', name: 'Mjölk' }, 2)];
const entry = { listId: L, itemId: 'milk' };

describe('fold', () => {
  it('an entry remembers who added it last', () => {
    const by = (userId: string) => ({ userId });
    const added = (userId: string, wall: number) => ev('entry.added', entry, wall, by(userId));
    const addedBy = (...es: FoldEvent[]) => fold([...setup, ...es]).entries.get(entryKey(L, 'milk'))?.addedBy;
    expect(addedBy(added('u1', 3))).toBe('u1');
    expect(addedBy(added('u1', 3), ev('entry.checked', entry, 4, by('u2')), ev('entry.unchecked', entry, 5, by('u2')))).toBe('u1');
    expect(addedBy(added('u1', 3), added('u2', 4))).toBe('u2');
  });

  it("an add without a userId counts as nobody else's", () => {
    const s = fold([...setup, ev('entry.added', entry, 3)]);
    expect(s.entries.get(entryKey(L, 'milk'))?.addedBy).toBeNull();
  });

  it('builds lists, items and entries', () => {
    const s = fold([
      ev('list.created', { listId: L, name: 'Hem' }, 1000),
      ev('item.created', { itemId: 'milk', name: 'Mjölk' }, 1001),
      ev('item.created', { itemId: 'bread', name: 'Bröd' }, 1002),
      ev('entry.added', { listId: L, itemId: 'milk', note: 'laktosfri' }, 1003),
      ev('entry.added', { listId: L, itemId: 'bread' }, 1004),
      ev('entry.checked', { listId: L, itemId: 'bread' }, 1005),
    ]);
    expect(s.lists.get(L)).toEqual({ id: L, name: 'Hem', deleted: false, createdAt: 1000 });
    expect(s.items.get('milk')).toEqual({
      id: 'milk', name: 'Mjölk', normalized: 'mjölk', archived: false,
      purchaseCount: 0, lastPurchasedAt: null, lastNote: 'laktosfri',
    });
    expect(s.items.get('bread')).toMatchObject({ purchaseCount: 1, lastPurchasedAt: 1005 });
    expect(s.entries.get(entryKey(L, 'milk'))).toEqual({
      listId: L, itemId: 'milk', state: 'active', note: 'laktosfri', addedAt: 1003, checkedAt: null, addedBy: null,
    });
    expect(s.entries.get(entryKey(L, 'bread'))).toEqual({
      listId: L, itemId: 'bread', state: 'checked', note: null, addedAt: 1004, checkedAt: 1005, addedBy: null,
    });
    expect(s.skipped).toBe(0);
  });

  it('gives the same state for any arrival order', () => {
    const history = [
      ev('list.created', { listId: L, name: 'Hem' }, 1000),
      ev('list.created', { listId: L2, name: 'Stuga' }, 1010),
      ev('item.created', { itemId: 'milk', name: 'Mjölk' }, 1020),
      ev('item.created', { itemId: 'bread', name: 'Bröd' }, 1030),
      ev('item.created', { itemId: 'eggs', name: 'Ägg' }, 1040),
      ev('item.created', { itemId: 'milk2', name: 'MJÖLK' }, 1050),
      ev('entry.added', { listId: L, itemId: 'milk', note: 'laktosfri' }, 1060),
      ev('entry.added', { listId: L, itemId: 'bread' }, 1070),
      ev('entry.added', { listId: L2, itemId: 'milk2' }, 1080),
      ev('entry.checked', { listId: L, itemId: 'milk' }, 1090, { id: 'c1' }),
      ev('entry.unchecked', { listId: L, itemId: 'milk' }, 1100, { undoOf: 'c1' }),
      ev('entry.checked', { listId: L, itemId: 'milk' }, 1110),
      ev('entry.checked', { listId: L, itemId: 'milk' }, 1120),
      ev('entry.noteSet', { listId: L, itemId: 'bread', note: 'fullkorn' }, 1130),
      ev('list.renamed', { listId: L2, name: 'Sommarstuga' }, 1140),
      ev('list.renamed', { listId: L2, name: 'Landet' }, 1140),
      ev('list.deleted', { listId: L2 }, 1150),
      ev('entry.added', { listId: L2, itemId: 'eggs' }, 1160),
      ev('list.restored', { listId: L2 }, 1170),
      ev('item.archived', { itemId: 'bread' }, 1180),
      ev('item.created', { itemId: 'bread2', name: 'Bröd' }, 1190),
      ev('item.renamed', { itemId: 'eggs', name: 'Ägg 12-pack' }, 1200),
      ev('entry.removed', { listId: L, itemId: 'bread' }, 1210),
      ev('entry.checked', { listId: L2, itemId: 'eggs' }, 1220),
      ev('entry.unchecked', { listId: L2, itemId: 'eggs' }, 1230),
      ev('item.unarchived', { itemId: 'bread' }, 1240),
      ev('entry.noteSet', { listId: L, itemId: 'eggs', note: 'stora' }, 1250),
      ev('entry.added', { listId: L, itemId: 'ghost' }, 1260),
      unknownEvent(1270),
      ev('entry.checked', { listId: L2, itemId: 'milk2' }, 1280),
    ];
    expect(history).toHaveLength(30);
    const expected = toSnapshot(fold(history));
    const reference = fold(history);
    expect(reference.skipped).toBe(2);
    expect(reference.items.get('milk')?.purchaseCount).toBe(2);

    const rand = prng(42);
    const withDuplicates = [...history, history[0]!, history[9]!];
    for (let run = 0; run < 50; run++) expect(toSnapshot(fold(shuffled(withDuplicates, rand)))).toEqual(expected);
  });

  it('merges items created offline with the same name', () => {
    const s = fold([
      ev('entry.added', { listId: L, itemId: 'b' }, 3000),
      ev('item.created', { itemId: 'b', name: 'Mjölk' }, 2000),
      ev('item.created', { itemId: 'a', name: 'Mjölk' }, 1000),
      ev('list.created', { listId: L, name: 'Hem' }, 1),
    ]);
    expect(s.items.size).toBe(1);
    expect(resolveItemId(s, 'b')).toBe('a');
    expect([...s.entries.values()].map((e) => e.itemId)).toEqual(['a']);
  });

  it('creates a new item when the same name belongs only to an archived item', () => {
    const s = fold([
      ev('item.created', { itemId: 'a', name: 'Mjölk' }, 1000),
      ev('item.archived', { itemId: 'a' }, 1500),
      ev('item.created', { itemId: 'b', name: 'Mjölk' }, 2000),
    ]);
    expect(s.items.size).toBe(2);
    expect(s.aliases.size).toBe(0);
  });

  it('last change wins by hlc, not by arrival', () => {
    const h = (hour: number) => hour * 3_600_000;
    const s = fold([
      ...setup,
      ev('entry.unchecked', entry, h(11)),
      ev('entry.checked', entry, h(10)),
    ]);
    expect(s.entries.get(entryKey(L, 'milk'))?.state).toBe('active');
  });

  it('counts purchases and ignores undone checks', () => {
    const undone = fold([
      ...setup,
      ev('entry.added', entry, 10),
      ev('entry.checked', entry, 20, { id: 'c1' }),
      ev('entry.unchecked', entry, 30, { undoOf: 'c1' }),
    ]);
    expect(undone.items.get('milk')).toMatchObject({ purchaseCount: 0, lastPurchasedAt: null });

    const earlier = fold([
      ...setup,
      ev('entry.checked', entry, 10),
      ev('entry.unchecked', entry, 15),
      ev('entry.checked', entry, 20, { id: 'c1' }),
      ev('entry.unchecked', entry, 30, { undoOf: 'c1' }),
    ]);
    expect(earlier.items.get('milk')).toMatchObject({ purchaseCount: 1, lastPurchasedAt: 10 });
  });

  it('does not count a check that undoes an uncheck or a re-add', () => {
    for (const reset of ['entry.unchecked', 'entry.added'] as const) {
      const s = fold([
        ...setup,
        ev('entry.checked', entry, 10),
        ev(reset, entry, 20, { id: 'r1' }),
        ev('entry.checked', entry, 30, { undoOf: 'r1' }),
      ]);
      expect(s.items.get('milk')).toMatchObject({ purchaseCount: 1, lastPurchasedAt: 10 });
      expect(s.entries.get(entryKey(L, 'milk'))).toMatchObject({ state: 'checked', checkedAt: 30 });
    }
  });

  it('takes every state time from the hlc wall, not occurredAt', () => {
    const future = { occurredAt: 365 * 86_400_000 };
    const s = fold([
      ev('list.created', { listId: L, name: 'Hem' }, 1, future),
      ev('item.created', { itemId: 'milk', name: 'Mjölk' }, 2, future),
      ev('entry.added', entry, 10, future),
      ev('entry.checked', entry, 20, future),
    ]);
    expect(s.lists.get(L)?.createdAt).toBe(1);
    expect(s.entries.get(entryKey(L, 'milk'))).toMatchObject({ addedAt: 10, checkedAt: 20 });
    expect(s.items.get('milk')?.lastPurchasedAt).toBe(20);
  });

  it('does not count a second check of an already checked entry', () => {
    const s = fold([...setup, ev('entry.checked', entry, 10), ev('entry.checked', entry, 20)]);
    expect(s.items.get('milk')).toMatchObject({ purchaseCount: 1, lastPurchasedAt: 10 });
    expect(s.entries.get(entryKey(L, 'milk'))).toMatchObject({ state: 'checked', checkedAt: 10 });
  });

  it('keeps entries of a deleted list and shows them again when restored', () => {
    const offline = [...setup, ev('list.deleted', { listId: L }, 1000), ev('entry.added', entry, 2000)];
    const deleted = fold(offline);
    expect(deleted.lists.get(L)?.deleted).toBe(true);
    expect(deleted.entries.get(entryKey(L, 'milk'))?.state).toBe('active');

    const restored = fold([...offline, ev('list.restored', { listId: L }, 3000)]);
    expect(restored.lists.get(L)?.deleted).toBe(false);
    expect(restored.entries.get(entryKey(L, 'milk'))?.state).toBe('active');
  });

  it('records the latest note per item', () => {
    const first = [
      ...setup,
      ev('list.created', { listId: L2, name: 'Stuga' }, 3),
      ev('entry.added', { ...entry, note: 'laktosfri' }, 10),
      ev('entry.noteSet', { listId: L2, itemId: 'milk', note: 'ekologisk' }, 20),
      ev('entry.added', { listId: L2, itemId: 'milk' }, 30),
    ];
    const before = fold(first);
    expect(before.items.get('milk')?.lastNote).toBe('laktosfri');
    expect(before.entries.get(entryKey(L2, 'milk'))?.note).toBeNull();
    expect(before.skipped).toBe(0);

    const after = fold([...first, ev('entry.noteSet', { listId: L2, itemId: 'milk', note: 'ekologisk' }, 40)]);
    expect(after.items.get('milk')?.lastNote).toBe('ekologisk');
    expect(after.entries.get(entryKey(L2, 'milk'))?.note).toBe('ekologisk');
    expect(after.entries.get(entryKey(L, 'milk'))?.note).toBe('laktosfri');
  });

  it('skips unknown event types without throwing', () => {
    const s = fold([...setup, unknownEvent(10)]);
    expect(s.skipped).toBe(1);
    expect(s.lists.size).toBe(1);
    expect(fold([{ ...ev('list.created', { listId: L2, name: 'Stuga' }, 10), v: 2 }]).skipped).toBe(1);
  });

  it('skips events that reference unknown lists or items', () => {
    const s = fold([
      ...setup,
      ev('list.renamed', { listId: 'nope', name: 'X' }, 10),
      ev('item.archived', { itemId: 'nope' }, 11),
      ev('entry.added', { listId: 'nope', itemId: 'milk' }, 12),
      ev('entry.checked', { listId: L, itemId: 'nope' }, 13),
    ]);
    expect(s.skipped).toBe(4);
    expect(s.entries.size).toBe(0);
  });

  it('folds 20 000 events in under 500 ms', () => {
    const events: FoldEvent[] = [ev('list.created', { listId: L, name: 'Hem' }, 1)];
    for (let i = 0; i < 3000; i++) events.push(ev('item.created', { itemId: `item-${i}`, name: `Vara ${i}` }, 2 + i));
    for (let i = events.length; i < 20_000; i++) {
      events.push(ev(i % 2 ? 'entry.checked' : 'entry.added', { listId: L, itemId: `item-${i % 3000}` }, 10_000 + i));
    }
    const input = shuffled(events, prng(7));

    const start = performance.now();
    const s = fold(input);
    const ms = performance.now() - start;

    expect(input).toHaveLength(20_000);
    expect(s.items.size).toBe(3000);
    expect(s.skipped).toBe(0);
    expect(ms).toBeLessThan(500);
  });
});
