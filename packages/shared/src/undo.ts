import type { EventType, FoldEvent, PayloadOf } from './events.ts';
import { entryKey, resolveItemId, type HouseholdState } from './fold.ts';
import { normalizeName } from './normalize.ts';

export type Draft = { [T in EventType]: { type: T; payload: PayloadOf<T>; undoOf?: string } }[EventType];

// the events that undo `e`, given the state just before `e` was applied
export function inverseOf(e: FoldEvent, before: HouseholdState): Draft[] {
  const undoOf = e.id;
  const entryOf = (p: { listId: string; itemId: string }) =>
    before.entries.get(entryKey(p.listId, resolveItemId(before, p.itemId)));
  switch (e.type) {
    case 'entry.added': {
      const prev = entryOf(e.payload);
      const at = { listId: e.payload.listId, itemId: e.payload.itemId };
      if (!prev) return [{ type: 'entry.removed', payload: at, undoOf }];
      if (prev.state === 'checked') return [{ type: 'entry.checked', payload: at, undoOf }];
      const note: Draft = { type: 'entry.noteSet', payload: { ...at, note: prev.note ?? '' }, undoOf };
      return prev.quantity === (e.payload.quantity ?? 1)
        ? [note]
        : [note, { type: 'entry.quantitySet', payload: { ...at, quantity: prev.quantity }, undoOf }];
    }
    case 'entry.checked':
      return [{ type: 'entry.unchecked', payload: e.payload, undoOf }];
    case 'entry.unchecked':
      return [{ type: 'entry.checked', payload: e.payload, undoOf }];
    case 'entry.removed': {
      const prev = entryOf(e.payload);
      // ponytail: brings a Done entry back without its note, and with quantity 1. An entry.added before the check
      // would keep them, at the cost of who added it and when.
      if (prev?.state === 'checked') return [{ type: 'entry.checked', payload: e.payload, undoOf }];
      if (!prev) return [];
      const payload = {
        ...e.payload,
        ...(prev.note ? { note: prev.note } : {}),
        ...(prev.quantity > 1 ? { quantity: prev.quantity } : {}),
      };
      return [{ type: 'entry.added', payload, undoOf }];
    }
    case 'entry.noteSet': {
      const prev = entryOf(e.payload);
      return prev ? [{ type: 'entry.noteSet', payload: { ...e.payload, note: prev.note ?? '' }, undoOf }] : [];
    }
    case 'entry.quantitySet': {
      const prev = entryOf(e.payload);
      return prev ? [{ type: 'entry.quantitySet', payload: { ...e.payload, quantity: prev.quantity }, undoOf }] : [];
    }
    case 'item.created':
      // a duplicate name becomes an alias of the existing item; archiving it would hit that item. Archived
      // and renamed items leave empty sets behind, so only a non-empty one is a live item of that name
      return (before.byName.get(normalizeName(e.payload.name))?.size ?? 0) > 0
        ? []
        : [{ type: 'item.archived', payload: { itemId: e.payload.itemId }, undoOf }];
    case 'item.renamed': {
      const item = before.items.get(resolveItemId(before, e.payload.itemId));
      return item ? [{ type: 'item.renamed', payload: { itemId: e.payload.itemId, name: item.name }, undoOf }] : [];
    }
    case 'item.priceSet': {
      const item = before.items.get(resolveItemId(before, e.payload.itemId));
      return item ? [{ type: 'item.priceSet', payload: { itemId: e.payload.itemId, price: item.price }, undoOf }] : [];
    }
    case 'item.archived':
      return [{ type: 'item.unarchived', payload: e.payload, undoOf }];
    case 'item.unarchived':
      return before.items.get(resolveItemId(before, e.payload.itemId))?.archived
        ? [{ type: 'item.archived', payload: e.payload, undoOf }]
        : [];
    case 'list.created':
      return [{ type: 'list.deleted', payload: { listId: e.payload.listId }, undoOf }];
    case 'list.renamed': {
      const list = before.lists.get(e.payload.listId);
      return list ? [{ type: 'list.renamed', payload: { listId: list.id, name: list.name }, undoOf }] : [];
    }
    case 'list.deleted':
      return [{ type: 'list.restored', payload: e.payload, undoOf }];
    case 'list.restored':
      return [];
  }
}
