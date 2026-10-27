import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { SHARE_MAX_GUESTS, fold, isKind, newId, resolveItemId, scopeItems, sharedEvents } from '@promus/shared';
import type { EventInput, Person, RejectCode, ShareScope, StoredEvent } from '@promus/shared';
import { hashToken } from './auth/sessions.ts';
import { transaction } from './db.ts';
import { createdItemIds, householdEvents, listState, storedEventIds } from './events-repo.ts';
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

/**
 * The sharer, the other members who changed the list in what the guests may see, then the link's guests and the
 * guests of the list's earlier links who did.
 */
export function peopleOnList(db: DatabaseSync, share: ShareRow): Person[] {
  const shared = sharedEvents(householdEvents(db, share.householdId), shareScope(share), 0);
  // an item's events say who made or named it, not who changed the list
  const authors = new Set(shared.flatMap((e) => (isKind(e, 'item') ? [] : [e.userId])));
  const members = db
    .prepare(
      `SELECT u.id, u.username AS name FROM household_members m JOIN users u ON u.id = m.user_id
       WHERE m.household_id = ? AND u.id <> ? ORDER BY u.username_norm`,
    )
    .all(share.householdId, share.createdBy) as { id: string; name: string }[];
  const guests = db
    .prepare(
      `SELECT g.id, g.name, g.share_id AS shareId FROM guests g JOIN shares s ON s.id = g.share_id
       WHERE s.household_id = ? AND s.list_id = ? ORDER BY g.created_at, g.rowid`,
    )
    .all(share.householdId, share.listId) as { id: string; name: string | null; shareId: string }[];
  return [
    { id: share.createdBy, name: share.sharedBy, guest: false },
    ...members.filter((m) => authors.has(m.id)).map((m) => ({ ...m, guest: false })),
    ...guests.filter((g) => g.shareId === share.id || authors.has(g.id)).map(({ id, name }) => ({ id, name, guest: true })),
  ];
}

/**
 * Why a guest may not push `e`, judged on its own, or null. `created` holds the item ids that already exist. A rename
 * is judged again in `guestRefusals`, on the fold.
 */
export function guestRejection(
  e: EventInput,
  { householdId, listId, created }: { householdId: string; listId: string; created: Set<string> },
): RejectCode | null {
  if (e.householdId !== householdId) return 'forbidden_household';
  if (isKind(e, 'entry')) return e.payload.listId === listId ? null : 'out_of_scope';
  // an item id that exists stays its creator's: the fold skips a second create, but it would still be stored, and
  // dated earlier it would win and make that id an alias of whatever had its name
  if (e.type === 'item.created') return created.has(e.payload.itemId) ? 'out_of_scope' : null;
  // A guest never archives or unarchives, not even its own item: a later event can make that item an alias of the
  // household's, and the stored archive would then land on theirs. Undoing a guest's add takes back the entry only.
  return e.type === 'item.renamed' ? null : 'out_of_scope';
}

type Rename = Extract<EventInput, { type: 'item.renamed' }>;

/** The guest's refusals among a push's events that passed every other check, by event id. */
export function guestRefusals(db: DatabaseSync, { guestId, share }: GuestContext, events: EventInput[]): Map<string, RejectCode> {
  // judged as it will be stored: the first event of each id, and none whose id is already stored. Those others are
  // answered as /sync/push answers them, accepted and not stored again
  const seen = storedEventIds(db, events.map((e) => e.id));
  const batch: EventInput[] = [];
  for (const e of events) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    batch.push(e);
  }
  const creates = batch.flatMap((e) => (e.type === 'item.created' ? [e.payload.itemId] : []));
  const ctx = { householdId: share.householdId, listId: share.listId, created: createdItemIds(db, creates) };
  const refused = new Map<string, RejectCode>();
  // in batch order, so `created` takes in the batch's own creates
  for (const e of batch) {
    const code = guestRejection(e, ctx);
    if (code) refused.set(e.id, code);
    else if (e.type === 'item.created') ctx.created.add(e.payload.itemId);
  }
  const renames = batch.filter((e): e is Rename => e.type === 'item.renamed' && !refused.has(e.id));
  if (renames.length === 0) return refused;
  // A rename must land on an item on the list. The household folds in hlc order, not in the order a batch arrives:
  // a create dated earlier sorts before theirs and changes which item an id is. So renames are judged on the fold
  // of the stored events and the batch together, and one refused rename refuses them all.
  const stored = householdEvents(db, share.householdId);
  const last = stored.at(-1)?.seq ?? 0;
  const all: StoredEvent[] = [
    ...stored,
    ...batch.filter((e) => !refused.has(e.id)).map((e, i) => ({ ...e, seq: last + 1 + i, userId: guestId, receivedAt: 0 })),
  ];
  const state = fold(all);
  const scope = scopeItems(all, shareScope(share), state);
  if (renames.some((e) => !scope.has(resolveItemId(state, e.payload.itemId)))) for (const e of renames) refused.set(e.id, 'out_of_scope');
  return refused;
}
