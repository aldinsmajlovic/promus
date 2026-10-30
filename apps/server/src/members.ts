import type { DatabaseSync } from 'node:sqlite';
import { transaction } from './db.ts';
import { insertHousehold } from './users.ts';
import type { Locale } from './users.ts';

type Row = { role: string; removed_by: string | null };
type Ids = { householdId: string; actorId: string; targetId: string; now: number };

const rowOf = (db: DatabaseSync, householdId: string, userId: string, live: boolean) =>
  db
    .prepare(
      `SELECT role, removed_by FROM household_members
       WHERE household_id = ? AND user_id = ? AND removed_at IS ${live ? '' : 'NOT '}NULL`,
    )
    .get(householdId, userId) as Row | undefined;

const isLiveOwner = (db: DatabaseSync, householdId: string, userId: string) => rowOf(db, householdId, userId, true)?.role === 'owner';

/** A mark, not a delete: the row stays, so history keeps its author and the owner can restore. */
export function removeMember(db: DatabaseSync, { householdId, actorId, targetId, now }: Ids): 'ok' | 'not_found' | 'forbidden' {
  return transaction(db, () => {
    const target = rowOf(db, householdId, targetId, true);
    if (!target) return 'not_found';
    if (target.role === 'owner') return 'forbidden';
    if (actorId !== targetId && !isLiveOwner(db, householdId, actorId)) return 'forbidden';
    db.prepare('UPDATE household_members SET removed_at = ?, removed_by = ? WHERE household_id = ? AND user_id = ?')
      .run(now, actorId, householdId, targetId);
    return 'ok';
  });
}

/**
 * Undo a removal. Someone the owner removed can't put themself back. If they have a household of their own by now,
 * it is retired when untouched (one event, one live member); otherwise they have moved on.
 */
export function restoreMember(db: DatabaseSync, { householdId, actorId, targetId, now }: Ids): 'ok' | 'not_found' | 'forbidden' | 'moved' {
  return transaction(db, () => {
    const target = rowOf(db, householdId, targetId, false);
    if (!target) return 'not_found';
    const own = actorId === targetId && target.removed_by === targetId;
    if (!own && !isLiveOwner(db, householdId, actorId)) return 'forbidden';
    const elsewhere = db
      .prepare('SELECT household_id AS id FROM household_members WHERE user_id = ? AND removed_at IS NULL')
      .all(targetId) as { id: string }[];
    const count = (sql: string, id: string) => (db.prepare(sql).get(id) as { n: number }).n;
    const untouched = (id: string) =>
      count('SELECT COUNT(*) AS n FROM events WHERE household_id = ?', id) === 1 &&
      count('SELECT COUNT(*) AS n FROM household_members WHERE household_id = ? AND removed_at IS NULL', id) === 1;
    if (!elsewhere.every(({ id }) => untouched(id))) return 'moved';
    for (const { id } of elsewhere) {
      db.prepare('UPDATE household_members SET removed_at = ?, removed_by = ? WHERE household_id = ? AND user_id = ?')
        .run(now, targetId, id, targetId);
    }
    db.prepare('UPDATE household_members SET removed_at = NULL, removed_by = NULL WHERE household_id = ? AND user_id = ?')
      .run(householdId, targetId);
    return 'ok';
  });
}

/** Their live household, or a new one with a default list; one transaction, so two requests make one. */
export function ensureHousehold(
  db: DatabaseSync,
  { userId, locale, now, sessionId }: { userId: string; locale: Locale; now: number; sessionId: string },
): { householdId: string; created: boolean } {
  return transaction(db, () => {
    const live = db
      .prepare('SELECT household_id AS householdId FROM household_members WHERE user_id = ? AND removed_at IS NULL LIMIT 1')
      .get(userId) as { householdId: string } | undefined;
    if (live) return { householdId: live.householdId, created: false };
    return { householdId: insertHousehold(db, { userId, locale, now, sessionId }).householdId, created: true };
  });
}
