import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { SHARE_MAX_GUESTS, emptyState, fold, isKind, newId, resolveItemId, scopeItems, sharedEvents } from '@promus/shared';
import type { EventInput, HouseholdState, Person, RejectCode, ShareScope, StoredEvent } from '@promus/shared';
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
 * `scope` holds the resolved ids of the items on the list, `own` the ids of the items this guest created, `created`
 * the ids of every item.created stored. `state` is the fold an item change lands in, and `aliased` the ids in it that
 * an id outside `own` is an alias of.
 */
export type GuestPushContext = {
  householdId: string; listId: string; state: HouseholdState; scope: Set<string>; own: Set<string>; created: Set<string>;
  aliased: Set<string>;
};

type ItemChange = Extract<EventInput, { type: 'item.renamed' | 'item.archived' | 'item.unarchived' }>;
const isItemChange = (e: EventInput): e is ItemChange =>
  e.type === 'item.renamed' || e.type === 'item.archived' || e.type === 'item.unarchived';

/** Why a guest may not push `e`, or null when it may. Only item changes read `state`, `scope` and `aliased`. */
export function guestRejection(e: EventInput, ctx: GuestPushContext): RejectCode | null {
  const { householdId, listId, state, scope, own, created, aliased } = ctx;
  if (e.householdId !== householdId) return 'forbidden_household';
  if (isKind(e, 'entry')) return e.payload.listId === listId ? null : 'out_of_scope';
  // a real item the guest created, that no one else's id is an alias of. One with such an alias is the household's
  // too: they named one the same later, or the guest backdated its item.created to sort before theirs
  const ownItem = (id: string): boolean => own.has(id) && state.items.has(id) && !aliased.has(id);
  switch (e.type) {
    // an id the household already has stays theirs: the fold would skip this, but `own` would take it in. Its own
    // ids again are a retried push. Not judged on the fold, where a backdated create of that id would win
    case 'item.created': {
      const id = e.payload.itemId;
      return created.has(id) && !own.has(id) ? 'out_of_scope' : null;
    }
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

/** The guest's refusals among a push's events that passed every other check, by event id. */
export function guestRefusals(db: DatabaseSync, { guestId, share }: GuestContext, events: EventInput[]): Map<string, RejectCode> {
  const stored = householdEvents(db, share.householdId);
  // judged as it will be stored: the first event of each id, and none already stored. Those others are answered as
  // /sync/push answers them, accepted and not stored again
  const seen = new Set(stored.map((e) => e.id));
  const batch: EventInput[] = [];
  for (const e of events) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    batch.push(e);
  }
  const creates = stored.flatMap((e) => (e.type === 'item.created' ? [e] : []));
  const ctx: GuestPushContext = {
    householdId: share.householdId,
    listId: share.listId,
    // set below, before the item changes are judged
    state: emptyState(),
    scope: new Set(),
    aliased: new Set(),
    own: new Set(creates.flatMap((e) => (e.userId === guestId ? [e.payload.itemId] : []))),
    created: new Set(creates.map((e) => e.payload.itemId)),
  };
  const refused = new Map<string, RejectCode>();
  // in batch order, so `own` takes in the batch's creates
  for (const e of batch) {
    if (isItemChange(e)) continue;
    const code = guestRejection(e, ctx);
    if (code) refused.set(e.id, code);
    else if (e.type === 'item.created') ctx.own.add(e.payload.itemId);
  }
  // The household folds in hlc order, not in the order a batch arrives: a backdated item.created sorts before
  // theirs, and their item becomes an alias of the guest's. So item changes are judged on the fold of the stored
  // events and the batch together. Refusing one would leave the others judged on a fold that won't be stored, so
  // one refusal refuses them all.
  const last = stored.at(-1)?.seq ?? 0;
  const all: StoredEvent[] = [
    ...stored,
    ...batch.filter((e) => !refused.has(e.id)).map((e, i) => ({ ...e, seq: last + 1 + i, userId: guestId, receivedAt: 0 })),
  ];
  ctx.state = fold(all);
  ctx.scope = scopeItems(all, shareScope(share), ctx.state);
  ctx.aliased = new Set([...ctx.state.aliases].flatMap(([alias, real]) => (ctx.own.has(alias) ? [] : [real])));
  const changes = batch.filter((e) => isItemChange(e) && !refused.has(e.id));
  if (changes.some((e) => guestRejection(e, ctx))) for (const e of changes) refused.set(e.id, 'out_of_scope');
  return refused;
}
