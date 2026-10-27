import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { SHARE_MAX_GUESTS, applyEvent, fold, newId, resolveItemId, scopeItems, sharedEvents } from '@promus/shared';
import type { EventInput, HouseholdState, Person, RejectCode, ShareScope } from '@promus/shared';
import { hashToken } from './auth/sessions.ts';
import { transaction } from './db.ts';
import { householdEvents, listState } from './events-repo.ts';
import type { ShareRow } from './shares.ts';

export const guestCookieName = (shareId: string): string => `guest-${shareId}`;

export type GuestContext = { guestId: string; name: string | null; share: ShareRow };

export const shareScope = (share: ShareRow): ShareScope => ({ listId: share.listId, fromSeq: share.fromSeq, madeAt: share.createdAt });

/** Not ended, not expired, and the list not deleted. */
export function shareIsLive(db: DatabaseSync, share: ShareRow, now: number): boolean {
  return share.revokedAt === null && share.expiresAt > now && listState(db, share.householdId, share.listId)?.deleted === false;
}

/** The guest of that link with that cookie token. */
export function findGuest(db: DatabaseSync, shareId: string, token: string): { id: string; name: string | null } | undefined {
  return db.prepare('SELECT id, name FROM guests WHERE share_id = ? AND token_hash = ?').get(shareId, hashToken(token)) as
    | { id: string; name: string | null }
    | undefined;
}

/** Null when the link already has `SHARE_MAX_GUESTS`. The token is returned once; only its hash is kept. */
export function addGuest(
  db: DatabaseSync,
  { shareId, name, now }: { shareId: string; name: string | null; now: number },
): { id: string; token: string } | null {
  return transaction(db, () => {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM guests WHERE share_id = ?').get(shareId) as { n: number };
    if (n >= SHARE_MAX_GUESTS) return null;
    const id = newId();
    const token = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO guests (id, share_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(id, shareId, name, hashToken(token), now);
    return { id, token };
  });
}

export function renameGuest(db: DatabaseSync, guestId: string, name: string | null): void {
  db.prepare('UPDATE guests SET name = ? WHERE id = ?').run(name, guestId);
}

/** The sharer, the other members who authored an event the guests may see, then the link's guests. */
export function peopleOnList(db: DatabaseSync, share: ShareRow): Person[] {
  const authors = new Set(sharedEvents(householdEvents(db, share.householdId), shareScope(share), 0).map((e) => e.userId));
  const members = db
    .prepare(
      `SELECT u.id, u.username AS name FROM household_members m JOIN users u ON u.id = m.user_id
       WHERE m.household_id = ? AND u.id <> ? ORDER BY u.username_norm`,
    )
    .all(share.householdId, share.createdBy) as { id: string; name: string }[];
  const guests = db
    .prepare('SELECT id, name FROM guests WHERE share_id = ? ORDER BY created_at, rowid')
    .all(share.id) as { id: string; name: string | null }[];
  return [
    { id: share.createdBy, name: share.sharedBy, guest: false },
    ...members.filter((m) => authors.has(m.id)).map((m) => ({ ...m, guest: false })),
    ...guests.map((g) => ({ ...g, guest: true })),
  ];
}

/** `scope` holds the resolved ids of the items the guest may know, `own` the ids of the items this guest created. */
export type GuestPushContext = { householdId: string; listId: string; state: HouseholdState; scope: Set<string>; own: Set<string> };

const isEntry = (e: EventInput): e is Extract<EventInput, { type: `entry.${string}` }> => e.type.startsWith('entry.');

/** Why a guest may not push `e`, or null when it may. */
export function guestRejection(e: EventInput, { householdId, listId, state, scope, own }: GuestPushContext): RejectCode | null {
  if (e.householdId !== householdId) return 'forbidden_household';
  if (isEntry(e)) return e.payload.listId === listId ? null : 'out_of_scope';
  // a real item the guest created, that no one else's id is an alias of. One with such an alias is the household's
  // too: they named one the same later, or the guest backdated its item.created to sort before theirs
  const ownItem = (id: string): boolean =>
    own.has(id) && state.items.has(id) && ![...state.aliases].some(([alias, real]) => real === id && !own.has(alias));
  switch (e.type) {
    case 'item.created':
      return null;
    case 'item.renamed': {
      const id = resolveItemId(state, e.payload.itemId);
      return scope.has(id) || ownItem(id) ? null : 'out_of_scope';
    }
    // how Undo takes back adding a new item. Not an alias: that resolves to the household's item of that name, and
    // archiving it would archive theirs
    case 'item.archived':
    case 'item.unarchived':
      return ownItem(e.payload.itemId) ? null : 'out_of_scope';
    default:
      return 'out_of_scope';
  }
}

/** The household as the guest's push checks it, before the batch. */
export function guestPushContext(db: DatabaseSync, { guestId, share }: GuestContext): GuestPushContext {
  const events = householdEvents(db, share.householdId);
  return {
    householdId: share.householdId,
    listId: share.listId,
    state: fold(events),
    scope: scopeItems(events, shareScope(share)),
    own: new Set(events.flatMap((e) => (e.type === 'item.created' && e.userId === guestId ? [e.payload.itemId] : []))),
  };
}

/** Takes in an accepted event, so the batch's next one is checked as the household will fold it. */
export function guestAccepted(ctx: GuestPushContext, e: EventInput): void {
  applyEvent(ctx.state, e);
  if (e.type === 'item.created') ctx.own.add(e.payload.itemId);
  else if (isEntry(e) && e.payload.listId === ctx.listId) ctx.scope.add(resolveItemId(ctx.state, e.payload.itemId));
}
