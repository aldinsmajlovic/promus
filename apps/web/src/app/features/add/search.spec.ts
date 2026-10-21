import { applyEvent, fold, formatHlc, makeEvent, newId } from '@promus/shared';
import type { EventInput, EventType, HouseholdState, PayloadOf } from '@promus/shared';
import { describe, expect, it } from 'vitest';
import { searchItems, segments } from './search';

const DAY = 86_400_000;
const NOW = 1_000 * DAY;
const householdId = newId();
const listId = newId();
let wall = NOW - 2 * DAY;
const ev = <T extends EventType>(type: T, payload: PayloadOf<T>): EventInput =>
  makeEvent(type, payload, { householdId, hlc: formatHlc(++wall, 0, 'test'), occurredAt: wall });

/** One list, and items bought the given number of times, none of them on the list. */
function catalog(items: [name: string, purchases: number][]): HouseholdState {
  const events = [ev('list.created', { listId, name: 'Inköpslista' })];
  for (const [name, purchases] of items) {
    const itemId = newId();
    events.push(ev('item.created', { itemId, name }));
    for (let i = 0; i < purchases; i++) {
      events.push(ev('entry.added', { listId, itemId }), ev('entry.checked', { listId, itemId }));
    }
  }
  return fold(events);
}

const groceries = () =>
  catalog([
    ['Grädde', 0],
    ['Gräddfil', 0],
    ['Vispgrädde', 10],
    ['Matlagningsgrädde', 3],
    ['Gurka', 5],
    ['Mjölk', 8],
  ]);

const idOf = (s: HouseholdState, name: string) => [...s.items.values()].find((i) => i.name === name)!.id;
const names = (s: HouseholdState, query: string) => searchItems(s, query, listId, NOW).results.map((r) => r.name);

describe('searchItems', () => {
  it('grädd ranks frequent matches first', () => {
    const s = groceries();
    applyEvent(s, ev('entry.added', { listId, itemId: idOf(s, 'Vispgrädde'), note: '3 dl' }));
    const { results, exact } = searchItems(s, 'grädd', listId, NOW);
    expect(results.map((r) => r.name).slice(0, 2)).toEqual(['Vispgrädde', 'Matlagningsgrädde']);
    expect(results.map((r) => r.name).slice(2).sort()).toEqual(['Grädde', 'Gräddfil']);
    expect(exact).toBeNull();
    expect(results[0]).toMatchObject({ itemId: idOf(s, 'Vispgrädde'), note: '3 dl', onList: true });
    expect(results[1]!.onList).toBe(false);
  });

  it('gradd without dots finds the same items', () => {
    const s = groceries();
    expect(names(s, 'gradd')).toEqual(names(s, 'grädd'));
    const [first] = searchItems(s, 'gradd', listId, NOW).results;
    // the ranges index the name as stored, dots and all
    expect(segments(first!.name, first!.ranges)).toEqual([
      { text: 'Visp', hit: false },
      { text: 'grädd', hit: true },
      { text: 'e', hit: false },
    ]);
  });

  it('mjlk finds Mjölk', () => {
    expect(names(groceries(), 'mjlk')).toEqual(['Mjölk']);
  });

  it('an exact match comes first regardless of score', () => {
    const s = groceries();
    const { results, exact } = searchItems(s, ' GRÄDDE ', listId, NOW);
    expect(results.map((r) => r.name)).toEqual(['Grädde', 'Vispgrädde', 'Matlagningsgrädde', 'Gräddfil']);
    expect(exact).toBe(results[0]);
  });

  it('archived items are not found', () => {
    const s = groceries();
    applyEvent(s, ev('item.archived', { itemId: idOf(s, 'Grädde') }));
    expect(names(s, 'grädd')).not.toContain('Grädde');
    expect(searchItems(s, 'grädde', listId, NOW).exact).toBeNull();
  });

  it('searches 3 000 items in under 50 ms', () => {
    const words = ['Grädde', 'Mjölk', 'Ost', 'Bröd', 'Äpplen', 'Kaffe', 'Smör', 'Ägg', 'Gurka', 'Tomater', 'Lök'];
    const s = catalog(
      Array.from({ length: 3000 }, (_, i) => [`${words[i % 11]} ${words[(i * 7) % 11]!.toLowerCase()} ${i}`, i % 4]),
    );
    expect(s.items.size).toBe(3000);
    for (const query of ['a', 'grädd', 'mjlk', 'ost 12']) {
      const start = performance.now();
      const { results } = searchItems(s, query, listId, NOW);
      expect(performance.now() - start, query).toBeLessThan(50);
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(20);
    }
  });
});
