// a namespace import, so bundlers keep only the zod parts used (`{ z }` pulls in every locale)
import * as z from 'zod';
import { isKind } from './events.ts';
import type { StoredEvent } from './events.ts';
import { compareEvents, fold, resolveItemId } from './fold.ts';
import type { HouseholdState } from './fold.ts';
import { cleanName } from './normalize.ts';
import { inDoneWindow } from './views.ts';

export const SHARE_TTL_MS = 14 * 86_400_000;
export const SHARE_MAX_GUESTS = 50;
export const GUEST_NAME_MAX = 40;

export const shareCreateSchema = z.object({ listId: z.uuid() });
export const shareTokenSchema = z.object({ token: z.string().min(1).max(100) });
export const shareJoinSchema = shareTokenSchema.extend({ name: z.string().max(200).optional() });
export const guestNameSchema = z.object({ name: z.string().max(200) });

/** A guest's name, cleaned; blank is no name. Callers check `GUEST_NAME_MAX`. */
export const cleanGuestName = (raw: string | undefined): string | null => cleanName(raw ?? '') || null;

export type Share = { id: string; listId: string; token: string; expiresAt: number; createdBy: string };
export type Guest = { id: string; shareId: string; name: string | null };
export type SharesResponse = { shares: Share[]; guests: Guest[] };
export type ShareCheck = { shareId: string; listName: string; sharedBy: string; expiresAt: number; joined: boolean };
export type ShareJoined = { shareId: string; guest: { id: string; name: string | null } };
export type Person = { id: string; name: string | null; guest: boolean };
export type GuestMe = {
  guest: { id: string; name: string | null };
  share: { id: string; householdId: string; listId: string; expiresAt: number; sharedBy: string };
  people: Person[];
};

/** `fromSeq` is the household's last `seq` when the link was made, `madeAt` its `created_at`. */
export type ShareScope = { listId: string; fromSeq: number; madeAt: number };

function scopeOf(events: StoredEvent[], { listId, fromSeq, madeAt }: ShareScope, now = fold(events)) {
  const before = fold(events.filter((e) => e.seq <= fromSeq));
  const itemOf = (e: { payload: { itemId: string } }) => resolveItemId(now, e.payload.itemId);
  // the items on the list at the moment -> the entry.added their entry starts from
  const starts = new Map<string, StoredEvent | undefined>();
  for (const entry of before.entries.values())
    if (entry.listId === listId && (entry.state === 'active' || inDoneWindow(entry, madeAt)))
      starts.set(resolveItemId(now, entry.itemId), undefined);
  // the other items put on the list after the moment -> the seq of their first entry event since
  const entered = new Map<string, number>();
  for (const e of events) {
    if (!isKind(e, 'entry') || e.payload.listId !== listId) continue;
    const item = itemOf(e);
    if (e.seq > fromSeq) {
      if (!starts.has(item)) entered.set(item, Math.min(e.seq, entered.get(item) ?? Infinity));
    } else if (e.type === 'entry.added' && starts.has(item)) {
      const start = starts.get(item);
      if (!start || compareEvents(e, start) > 0) starts.set(item, e);
    }
  }
  return { itemOf, starts, entered, items: new Set([...starts.keys(), ...entered.keys()]) };
}

/** The resolved ids of the items a guest of `scope` may know. `now`, when given, is `fold(events)`. */
export const scopeItems = (events: StoredEvent[], scope: ShareScope, now?: HouseholdState): Set<string> =>
  scopeOf(events, scope, now).items;

/**
 * The household's events a guest of `scope` may have after `after`, sorted by `seq`: the list's own, the item
 * events of the items in scope, and the list's entry events from the moment on, plus from before it what an
 * entry on the list at that moment needs. Plus the earlier item events of items that entered after `after`.
 */
export function sharedEvents(events: StoredEvent[], scope: ShareScope, after: number): StoredEvent[] {
  const { itemOf, starts, entered, items } = scopeOf(events, scope);
  const kept = (e: StoredEvent): boolean => {
    if (isKind(e, 'list')) return e.payload.listId === scope.listId;
    if (isKind(e, 'item')) return items.has(itemOf(e));
    if (!isKind(e, 'entry') || e.payload.listId !== scope.listId) return false;
    // ponytail: an entry that wasn't on the list at the moment gets only its events after the link, so it can look
    // different on the guest's phone: when checked or unchecked with no entry.added since (the app re-adds instead),
    // or when a late entry.added or entry.unchecked, pushed after the link, is stamped before a check stored before
    // the link (the guest shows it active, the household doesn't). Upgrade path: for an item entering after the
    // moment, also keep its pre-link entry events at or after its earliest post-link entry event, in fold order.
    if (e.seq > scope.fromSeq) return true;
    // an entry at the moment with no entry.added before it (its add was pushed late) keeps all of its events
    const item = itemOf(e);
    const start = starts.get(item);
    return starts.has(item) && (!start || compareEvents(e, start) >= 0);
  };
  const entersLater = (e: StoredEvent): boolean => isKind(e, 'item') && (entered.get(itemOf(e)) ?? 0) > after;
  return events.filter((e) => kept(e) && (e.seq > after || entersLater(e))).sort((a, b) => a.seq - b.seq);
}
