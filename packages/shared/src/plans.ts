import { newId } from './ids.ts';
import { entryKey, resolveItemId } from './fold.ts';
import type { EntryState, HouseholdState, ItemState } from './fold.ts';
import { normalizeName } from './normalize.ts';
import type { Draft } from './undo.ts';

// one action: its events (as drafts) and the snackbar text
export type Plan = { messageKey: string; name: string; drafts: Draft[] };

export const one = (messageKey: string, name: string, draft: Draft): Plan => ({ messageKey, name, drafts: [draft] });

export const entryPlan = (
  type: 'entry.checked' | 'entry.unchecked' | 'entry.removed',
  messageKey: string,
  listId: string,
  item: ItemState,
): Plan => one(messageKey, item.name, { type, payload: { listId, itemId: item.id } });

export const laterPlan = (listId: string, item: ItemState, later: boolean): Plan =>
  one(later ? 'snack.later' : 'snack.unchecked', item.name, {
    type: 'entry.laterSet',
    payload: { listId, itemId: item.id, later },
  });

export const itemOf = (s: HouseholdState, itemId: string): ItemState | undefined =>
  s.items.get(resolveItemId(s, itemId));

export const entryOf = (
  s: HouseholdState,
  listId: string,
  itemId: string,
): { item: ItemState; entry: EntryState } | null => {
  const item = itemOf(s, itemId);
  const entry = item && s.entries.get(entryKey(listId, item.id));
  return item && entry ? { item, entry } : null;
};

export function planReadd(s: HouseholdState, listId: string, itemId: string): Plan | null {
  const item = itemOf(s, itemId);
  const entry = item && s.entries.get(entryKey(listId, item.id));
  if (!item || (entry?.state === 'active' && !entry.later)) return null;
  // as it was put off: its note, quantity and who added it
  if (entry?.state === 'active') return laterPlan(listId, item, false);
  const payload = {
    listId,
    itemId: item.id,
    ...(item.lastNote ? { note: item.lastNote } : {}),
    ...(item.lastQuantity > 1 ? { quantity: item.lastQuantity } : {}),
  };
  return one('snack.added', item.name, { type: 'entry.added', payload });
}

/** `clean` is already `cleanName`d and length-checked. An archived item of that name comes back rather than a new one. */
export function planAddByName(s: HouseholdState, listId: string, clean: string): Plan | null {
  const normalized = normalizeName(clean);
  const existing = s.byName.get(normalized)?.values().next().value;
  if (existing !== undefined) return planReadd(s, listId, existing);
  // byName holds live items only
  const archived = [...s.items.values()].find((i) => i.archived && i.normalized === normalized);
  if (archived) {
    const readd = planReadd(s, listId, archived.id)?.drafts ?? [];
    const unarchive: Draft = { type: 'item.unarchived', payload: { itemId: archived.id } };
    return { messageKey: 'snack.added', name: archived.name, drafts: [unarchive, ...readd] };
  }
  const itemId = newId();
  return {
    messageKey: 'snack.added',
    name: clean,
    drafts: [
      { type: 'item.created', payload: { itemId, name: clean } },
      { type: 'entry.added', payload: { listId, itemId } },
    ],
  };
}

export function planCheck(s: HouseholdState, listId: string, itemId: string): Plan | null {
  const found = entryOf(s, listId, itemId);
  return found?.entry.state === 'active' ? entryPlan('entry.checked', 'snack.checked', listId, found.item) : null;
}

export function planUncheck(s: HouseholdState, listId: string, itemId: string): Plan | null {
  const found = entryOf(s, listId, itemId);
  return found?.entry.state === 'checked' ? entryPlan('entry.unchecked', 'snack.unchecked', listId, found.item) : null;
}

export function planRemove(s: HouseholdState, listId: string, itemId: string): Plan | null {
  const found = entryOf(s, listId, itemId);
  return found ? entryPlan('entry.removed', 'snack.removed', listId, found.item) : null;
}
