import { EVENT_TYPES, type FoldEvent } from './events.ts';
import { hlcWall } from './hlc.ts';
import { normalizeName } from './normalize.ts';

export type ListState = { id: string; name: string; deleted: boolean; createdAt: number };
export type ItemState = {
  id: string;
  name: string;
  normalized: string;
  archived: boolean;
  purchaseCount: number;
  lastPurchasedAt: number | null;
  lastNote: string | null;
};
export type EntryState = {
  listId: string;
  itemId: string;
  state: 'active' | 'checked';
  note: string | null;
  addedAt: number;
  checkedAt: number | null;
  addedBy: string | null;
};
export type HouseholdState = {
  lists: Map<string, ListState>;
  items: Map<string, ItemState>;
  entries: Map<string, EntryState>;
  aliases: Map<string, string>;
  skipped: number;
  // fold internals: itemId -> counted entry.checked id -> its hlc wall
  purchases: Map<string, Map<string, number>>;
  // fold internals: normalized name -> ids of non-archived items with that name
  byName: Map<string, Set<string>>;
};

// an event from a newer app version, with a type or payload version this code doesn't know
type UnknownEvent = { id: string; type: string; v: number; hlc: string; occurredAt: number; undoOf?: string; payload: unknown };
type EntryEvent = Extract<FoldEvent, { type: `entry.${string}` }>;

const KNOWN_TYPES = new Set<string>(EVENT_TYPES);
const isKnown = (e: FoldEvent | UnknownEvent): e is FoldEvent => e.v === 1 && KNOWN_TYPES.has(e.type);

export const entryKey = (listId: string, itemId: string): string => `${listId}:${itemId}`;

// code-unit order, not localeCompare: the order must not depend on the device's locale
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const compareEvents = (a: { hlc: string; id: string }, b: { hlc: string; id: string }): number =>
  cmp(a.hlc, b.hlc) || cmp(a.id, b.id);

export const emptyState = (): HouseholdState => ({
  lists: new Map(),
  items: new Map(),
  entries: new Map(),
  aliases: new Map(),
  skipped: 0,
  purchases: new Map(),
  byName: new Map(),
});

// alias targets are always real items, so one hop is enough
export const resolveItemId = (state: HouseholdState, id: string): string => state.aliases.get(id) ?? id;

export function fold(events: Iterable<FoldEvent | UnknownEvent>): HouseholdState {
  const state = emptyState();
  const seen = new Set<string>();
  for (const e of [...events].sort(compareEvents)) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    applyEvent(state, e);
  }
  return state;
}

export function applyEvent(state: HouseholdState, e: FoldEvent | UnknownEvent): void {
  if (!isKnown(e) || !apply(state, e)) state.skipped++;
}

export function toSnapshot(state: HouseholdState): unknown {
  const sorted = <T>(m: Map<string, T>) => [...m].sort(([a], [b]) => cmp(a, b));
  const { lists, items, entries, aliases, skipped } = state;
  return { lists: sorted(lists), items: sorted(items), entries: sorted(entries), aliases: sorted(aliases), skipped };
}

const indexName = (s: HouseholdState, item: ItemState): void => {
  s.byName.set(item.normalized, (s.byName.get(item.normalized) ?? new Set()).add(item.id));
};

const derivePurchases = (item: ItemState, p: Map<string, number>): void => {
  item.purchaseCount = p.size;
  item.lastPurchasedAt = p.size ? Math.max(...p.values()) : null;
};

// false: the event references a list or item that doesn't exist (or re-creates one that does)
function apply(s: HouseholdState, e: FoldEvent): boolean {
  switch (e.type) {
    case 'list.created': {
      const { listId: id, name } = e.payload;
      if (s.lists.has(id)) return false;
      s.lists.set(id, { id, name, deleted: false, createdAt: hlcWall(e.hlc) });
      return true;
    }
    case 'list.renamed':
    case 'list.deleted':
    case 'list.restored': {
      const list = s.lists.get(e.payload.listId);
      if (!list) return false;
      if (e.type === 'list.renamed') list.name = e.payload.name;
      else list.deleted = e.type === 'list.deleted';
      return true;
    }
    case 'item.created': {
      const { itemId: id, name } = e.payload;
      if (s.items.has(id) || s.aliases.has(id)) return false;
      const normalized = normalizeName(name);
      const existing = s.byName.get(normalized)?.values().next().value;
      if (existing !== undefined) {
        s.aliases.set(id, existing);
        return true;
      }
      const item = { id, name, normalized, archived: false, purchaseCount: 0, lastPurchasedAt: null, lastNote: null };
      s.items.set(id, item);
      indexName(s, item);
      return true;
    }
    case 'item.renamed':
    case 'item.archived':
    case 'item.unarchived': {
      const item = s.items.get(resolveItemId(s, e.payload.itemId));
      if (!item) return false;
      s.byName.get(item.normalized)?.delete(item.id);
      if (e.type === 'item.renamed') {
        item.name = e.payload.name;
        item.normalized = normalizeName(e.payload.name);
      } else item.archived = e.type === 'item.archived';
      if (!item.archived) indexName(s, item);
      return true;
    }
    case 'entry.added':
    case 'entry.checked':
    case 'entry.unchecked':
    case 'entry.removed':
    case 'entry.noteSet':
      return applyEntry(s, e);
  }
}

function applyEntry(s: HouseholdState, e: EntryEvent): boolean {
  const { listId } = e.payload;
  const itemId = resolveItemId(s, e.payload.itemId);
  const item = s.items.get(itemId);
  if (!item || !s.lists.has(listId)) return false;
  const key = entryKey(listId, itemId);
  const prev = s.entries.get(key);
  const at = hlcWall(e.hlc);
  const keep = { listId, itemId, note: prev?.note ?? null, addedAt: prev?.addedAt ?? at, addedBy: prev?.addedBy ?? null };
  switch (e.type) {
    case 'entry.added': {
      const note = e.payload.note || null;
      s.entries.set(key, { listId, itemId, state: 'active', note, addedAt: at, checkedAt: null, addedBy: e.userId ?? null });
      if (note) item.lastNote = note;
      break;
    }
    case 'entry.checked': {
      if (prev?.state === 'checked') break;
      s.entries.set(key, { ...keep, state: 'checked', checkedAt: at });
      // a check that undoes something only restores state; it is not a new purchase
      if (e.undoOf) break;
      const p = (s.purchases.get(itemId) ?? new Map<string, number>()).set(e.id, at);
      s.purchases.set(itemId, p);
      derivePurchases(item, p);
      break;
    }
    case 'entry.unchecked': {
      s.entries.set(key, { ...keep, state: 'active', checkedAt: null });
      const p = s.purchases.get(itemId);
      if (p && e.undoOf && p.delete(e.undoOf)) derivePurchases(item, p);
      break;
    }
    case 'entry.removed':
      s.entries.delete(key);
      break;
    case 'entry.noteSet':
      if (!prev) break;
      prev.note = e.payload.note || null;
      item.lastNote = prev.note;
      break;
  }
  return true;
}
