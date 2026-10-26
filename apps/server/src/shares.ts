import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { SHARE_TTL_MS, newId } from '@promus/shared';
import type { Share, SharesResponse } from '@promus/shared';
import { hashToken } from './auth/sessions.ts';
import { transaction } from './db.ts';
import { lastSeq } from './events-repo.ts';

/** `sharedBy` is the creator's username. */
export type ShareRow = {
  id: string; householdId: string; listId: string; token: string; createdBy: string; sharedBy: string;
  createdAt: number; fromSeq: number; expiresAt: number; revokedAt: number | null;
};

type Row = {
  id: string; household_id: string; list_id: string; token: string; created_by: string; shared_by: string;
  created_at: number; from_seq: number; expires_at: number; revoked_at: number | null;
};

const SELECT = 'SELECT s.*, u.username AS shared_by FROM shares s JOIN users u ON u.id = s.created_by';
const LIVE = 's.revoked_at IS NULL AND s.expires_at > ?';

const toRow = (r: Row): ShareRow => ({
  id: r.id, householdId: r.household_id, listId: r.list_id, token: r.token, createdBy: r.created_by,
  sharedBy: r.shared_by, createdAt: r.created_at, fromSeq: r.from_seq, expiresAt: r.expires_at, revokedAt: r.revoked_at,
});

const toShare = (r: ShareRow): Share => ({
  id: r.id, listId: r.listId, token: r.token, expiresAt: r.expiresAt, createdBy: r.createdBy,
});

/** The newest live link of the list, or a new one that starts from the household's last event. */
export function createOrGetShare(
  db: DatabaseSync,
  { householdId, listId, userId, now }: { householdId: string; listId: string; userId: string; now: number },
): { share: Share; created: boolean } {
  return transaction(db, () => {
    const live = db
      .prepare(`${SELECT} WHERE s.household_id = ? AND s.list_id = ? AND ${LIVE} ORDER BY s.created_at DESC, s.rowid DESC LIMIT 1`)
      .get(householdId, listId, now) as Row | undefined;
    if (live) return { share: toShare(toRow(live)), created: false };
    const id = newId();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = now + SHARE_TTL_MS;
    db.prepare(
      `INSERT INTO shares (id, household_id, list_id, token, token_hash, created_by, created_at, from_seq, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, householdId, listId, token, hashToken(token), userId, now, lastSeq(db, householdId), expiresAt);
    return { share: { id, listId, token, expiresAt, createdBy: userId }, created: true };
  });
}

/** Live links, and every guest of every link the household has made, ended or not. */
export function listShares(db: DatabaseSync, householdId: string, now: number): SharesResponse {
  const shares = db
    .prepare(`${SELECT} WHERE s.household_id = ? AND ${LIVE} ORDER BY s.created_at, s.rowid`)
    .all(householdId, now) as Row[];
  const guests = db
    .prepare(
      `SELECT g.id, g.share_id AS shareId, g.name FROM guests g JOIN shares s ON s.id = g.share_id
       WHERE s.household_id = ? ORDER BY g.created_at, g.rowid`,
    )
    .all(householdId) as SharesResponse['guests'];
  return { shares: shares.map((r) => toShare(toRow(r))), guests };
}

/** False when no link with that id belongs to one of `householdIds`. Ending twice is fine. */
export function endShare(db: DatabaseSync, id: string, householdIds: string[], now: number): boolean {
  const row = db.prepare('SELECT household_id FROM shares WHERE id = ?').get(id) as { household_id: string } | undefined;
  if (!row || !householdIds.includes(row.household_id)) return false;
  db.prepare('UPDATE shares SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(now, id);
  return true;
}

export function restoreShare(
  db: DatabaseSync,
  id: string,
  householdIds: string[],
  now: number,
): 'ok' | 'not_found' | 'expired' {
  const row = db.prepare('SELECT household_id, expires_at FROM shares WHERE id = ?').get(id) as
    | { household_id: string; expires_at: number }
    | undefined;
  if (!row || !householdIds.includes(row.household_id)) return 'not_found';
  if (row.expires_at <= now) return 'expired';
  db.prepare('UPDATE shares SET revoked_at = NULL WHERE id = ?').run(id);
  return 'ok';
}

export function findShareByToken(db: DatabaseSync, token: string, now: number): ShareRow | undefined {
  const row = db.prepare(`${SELECT} WHERE s.token_hash = ? AND ${LIVE}`).get(hashToken(token), now) as Row | undefined;
  return row && toRow(row);
}
