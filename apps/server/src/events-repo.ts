import type { DatabaseSync } from 'node:sqlite';
import type { EventInput, StoredEvent } from '@promus/shared';
import type { AuthContext } from './auth/sessions.ts';
import { transaction } from './db.ts';

type Row = {
  seq: number; id: string; household_id: string; user_id: string; type: string; v: number;
  hlc: string; occurred_at: number; received_at: number; undo_of: string | null; payload: string;
};

/** Idempotent: ids already stored are skipped, so a retried push can't duplicate. All or nothing. */
export function insertEvents(db: DatabaseSync, events: EventInput[], ctx: AuthContext, now: number): void {
  if (events.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO events (id, household_id, user_id, session_id, type, v, hlc, occurred_at, received_at, undo_of, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
  );
  transaction(db, () => {
    for (const e of events) {
      stmt.run(e.id, e.householdId, ctx.userId, ctx.sessionId, e.type, e.v, e.hlc, e.occurredAt, now, e.undoOf ?? null, JSON.stringify(e.payload));
    }
  });
}

export function listEvents(
  db: DatabaseSync,
  householdIds: string[],
  after: number,
  limit: number,
): { events: StoredEvent[]; hasMore: boolean } {
  if (householdIds.length === 0) return { events: [], hasMore: false };
  const marks = householdIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT seq, id, household_id, user_id, type, v, hlc, occurred_at, received_at, undo_of, payload
       FROM events WHERE household_id IN (${marks}) AND seq > ? ORDER BY seq LIMIT ?`,
    )
    .all(...householdIds, after, limit + 1) as Row[];
  const events = rows.slice(0, limit).map(
    (r) =>
      ({
        seq: r.seq,
        id: r.id,
        householdId: r.household_id,
        userId: r.user_id,
        type: r.type,
        v: r.v,
        hlc: r.hlc,
        occurredAt: r.occurred_at,
        receivedAt: r.received_at,
        ...(r.undo_of === null ? {} : { undoOf: r.undo_of }),
        payload: JSON.parse(r.payload),
      }) as StoredEvent,
  );
  return { events, hasMore: rows.length > limit };
}
