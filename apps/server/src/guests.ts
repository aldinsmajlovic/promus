import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { SHARE_MAX_GUESTS, newId, sharedEvents } from '@promus/shared';
import type { Person } from '@promus/shared';
import { hashToken } from './auth/sessions.ts';
import { transaction } from './db.ts';
import { householdEvents, listState } from './events-repo.ts';
import type { ShareRow } from './shares.ts';

export const guestCookieName = (shareId: string): string => `guest-${shareId}`;

export type GuestContext = { guestId: string; name: string | null; share: ShareRow };

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
  const scope = { listId: share.listId, fromSeq: share.fromSeq, madeAt: share.createdAt };
  const authors = new Set(sharedEvents(householdEvents(db, share.householdId), scope, 0).map((e) => e.userId));
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
