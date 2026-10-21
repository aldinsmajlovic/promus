import { LIMITS } from './events.ts';
import { entryKey, type EntryState, type HouseholdState, type ItemState } from './fold.ts';

export type EntryView = { itemId: string; name: string; note: string | null; checkedAt: number | null };

const entriesOf = (state: HouseholdState, listId: string): EntryState[] =>
  state.lists.get(listId)?.deleted === false ? [...state.entries.values()].filter((e) => e.listId === listId) : [];

const inDoneWindow = (e: EntryState, now: number): boolean =>
  e.state === 'checked' && e.checkedAt !== null && now - e.checkedAt <= LIMITS.doneWindowMs;

export function listView(
  state: HouseholdState,
  listId: string,
  now: number,
  collator: Intl.Collator,
): { active: EntryView[]; done: EntryView[] } {
  const active: EntryView[] = [];
  const done: EntryView[] = [];
  for (const e of entriesOf(state, listId)) {
    const item = state.items.get(e.itemId);
    if (!item) continue;
    const view = { itemId: e.itemId, name: item.name, note: e.note, checkedAt: e.checkedAt };
    if (e.state === 'active') active.push(view);
    else if (inDoneWindow(e, now)) done.push(view);
  }
  active.sort((a, b) => collator.compare(a.name, b.name));
  done.sort((a, b) => b.checkedAt! - a.checkedAt!);
  return { active, done };
}

export function listSummaries(
  state: HouseholdState,
  collator: Intl.Collator,
): { id: string; name: string; activeCount: number }[] {
  return [...state.lists.values()]
    .filter((l) => !l.deleted)
    .map((l) => ({ id: l.id, name: l.name, activeCount: entriesOf(state, l.id).filter((e) => e.state === 'active').length }))
    .sort((a, b) => collator.compare(a.name, b.name));
}

export function itemScore(item: ItemState, now: number): number {
  if (item.purchaseCount === 0 || item.lastPurchasedAt === null) return 0;
  const days = (now - item.lastPurchasedAt) / LIMITS.doneWindowMs;
  return item.purchaseCount / (1 + days / 30);
}

export function frequentItems(state: HouseholdState, listId: string, now: number, limit = 8): ItemState[] {
  const taken = new Set(
    entriesOf(state, listId)
      .filter((e) => e.state === 'active' || inDoneWindow(e, now))
      .map((e) => entryKey(listId, e.itemId)),
  );
  return [...state.items.values()]
    .filter((i) => !i.archived && i.purchaseCount > 0 && !taken.has(entryKey(listId, i.id)))
    .sort((a, b) => itemScore(b, now) - itemScore(a, now))
    .slice(0, limit);
}
