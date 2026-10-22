import { Injectable, inject } from '@angular/core';
import { compareEvents, hlcNow, hlcReceive, newId, parseHlc } from '@promus/shared';
import type { EventInput, HlcState, RejectedEvent, StoredEvent, SyncStorage } from '@promus/shared';
import { PromusDb, type Session } from './db';

/** Who a sync run works for: the session it started in. */
export type SyncOwner = Pick<Session, 'userId' | 'householdId'>;

/**
 * A sync run's write found another session than the one it started in (signed out, another user, or the
 * same user signed in again over a wiped copy), or a cursor another run had moved. It wrote nothing.
 */
export class StaleSyncError extends Error {
  constructor() {
    super('the session or cursor changed during the sync');
    this.name = 'StaleSyncError';
  }
}

const ZERO: HlcState = { wall: 0, counter: 0 };

const maxHlc = (rows: Iterable<{ hlc: string }>): string | null => {
  let max: string | null = null;
  for (const { hlc } of rows) if (max === null || hlc > max) max = hlc;
  return max;
};

const stateOf = (hlc: string): HlcState => {
  const { wall, counter } = parseHlc(hlc);
  return { wall, counter };
};

/**
 * SyncStorage over IndexedDB, mirroring MemorySyncStorage. The hlc state, the server offset and the
 * node id (`deviceId`) live in `meta`, so tabs share one clock and every change to it is transactional.
 *
 * With an `owner`, it is one sync run's: `applyPulled`, `markPushed`, `reject` and `restamp` throw
 * StaleSyncError, in the transaction and before writing, once `meta.session` is no longer the owner's,
 * and `applyPulled` also once the cursor is no longer the one this run last read or wrote.
 */
@Injectable({ providedIn: 'root', useFactory: () => new DexieSyncStorage(inject(PromusDb)) })
export class DexieSyncStorage implements SyncStorage {
  private readonly db: PromusDb;
  private readonly owner: SyncOwner | null;
  private cursor: number | null = null;

  constructor(db: PromusDb, owner?: SyncOwner) {
    this.db = db;
    this.owner = owner ?? null;
  }

  /**
   * The source of new hlcs: now + server offset, with `deviceId` as the node. Use it inside a rw
   * transaction over `meta` and call `save()` in that same transaction.
   */
  async clock(start?: HlcState): Promise<{ next: () => string; save: () => Promise<void> }> {
    const db = this.db;
    const [stored, offset, node] = await Promise.all([db.getMeta('hlc'), db.getMeta('serverOffset'), this.deviceId()]);
    let state = start ?? stored ?? ZERO;
    return {
      next: () => {
        const next = hlcNow(state, Date.now() + (offset ?? 0), node);
        state = next.state;
        return next.hlc;
      },
      save: () => db.setMeta('hlc', state),
    };
  }

  /** Raises the stored hlc state to at least the highest of these hlcs; never lowers it. */
  async seed(rows: Iterable<{ hlc: string }>): Promise<void> {
    const top = maxHlc(rows);
    if (top === null) return;
    const db = this.db;
    await db.transaction('rw', db.meta, async () => {
      const current = (await db.getMeta('hlc')) ?? ZERO;
      const seen = stateOf(top);
      if (seen.wall > current.wall || (seen.wall === current.wall && seen.counter > current.counter)) {
        await db.setMeta('hlc', seen);
      }
    });
  }

  async append(events: EventInput[]): Promise<void> {
    await this.db.outbox.bulkPut(events.map((event) => ({ id: event.id, hlc: event.hlc, pushed: 0, event })));
  }

  pendingCount(): Promise<number> {
    return this.db.outbox.where('pushed').equals(0).count();
  }

  async pendingEvents(limit: number): Promise<EventInput[]> {
    const rows = await this.db.outbox.where('pushed').equals(0).toArray();
    return rows.map((r) => r.event).sort(compareEvents).slice(0, limit);
  }

  async markPushed(ids: string[]): Promise<void> {
    const db = this.db;
    await db.transaction('rw', db.outbox, db.meta, async () => {
      await this.checkOwner();
      await db.outbox.where('id').anyOf(ids).modify({ pushed: 1 });
    });
  }

  async reject(items: RejectedEvent[]): Promise<void> {
    const db = this.db;
    await db.transaction('rw', db.outbox, db.rejected, db.meta, async () => {
      await this.checkOwner();
      await db.outbox.bulkDelete(items.map((i) => i.event.id));
      await db.rejected.bulkPut(items.map((i) => ({ id: i.event.id, ...i })));
    });
  }

  async restamp(ids: string[], serverOffsetMs: number): Promise<void> {
    const db = this.db;
    await db.transaction('rw', db.events, db.outbox, db.meta, async () => {
      await this.checkOwner();
      await db.setMeta('serverOffset', serverOffsetMs);
      // lower the clock past the bad future values: only events others may have seen count
      const [pulled, pushed, targets] = await Promise.all([
        db.events.toArray(),
        db.outbox.where('pushed').equals(1).toArray(),
        db.outbox.bulkGet(ids),
      ]);
      const top = maxHlc([...pulled, ...pushed]);
      const clock = await this.clock(top === null ? ZERO : stateOf(top));
      const rows = targets.filter((r) => r !== undefined).sort((x, y) => compareEvents(x.event, y.event));
      await db.outbox.bulkPut(
        rows.map((row) => {
          const hlc = clock.next();
          return { ...row, hlc, event: { ...row.event, hlc } };
        }),
      );
      await clock.save();
    });
  }

  async getCursor(): Promise<number> {
    const cursor = (await this.db.getMeta('cursor')) ?? 0;
    this.cursor = cursor;
    return cursor;
  }

  async applyPulled(events: StoredEvent[], lastSeq: number): Promise<void> {
    const db = this.db;
    await db.transaction('rw', db.events, db.outbox, db.meta, async () => {
      await this.checkOwner();
      // a wipe resets the cursor: these events would continue a log the database no longer holds
      if (this.owner && this.cursor !== null && ((await db.getMeta('cursor')) ?? 0) !== this.cursor) {
        throw new StaleSyncError();
      }
      await db.events.bulkPut(events);
      await db.outbox.bulkDelete(events.map((e) => e.id));
      await db.setMeta('cursor', lastSeq);
      const top = maxHlc(events);
      if (top === null) return;
      const [hlc, offset] = await Promise.all([db.getMeta('hlc'), db.getMeta('serverOffset')]);
      await db.setMeta('hlc', hlcReceive(hlc ?? ZERO, top, Date.now() + (offset ?? 0)));
    });
    this.cursor = lastSeq;
  }

  // not owner-checked: the offset is the server's clock, the same for every session
  async setServerOffset(ms: number): Promise<void> {
    await this.db.setMeta('serverOffset', ms);
  }

  // called inside the caller's rw transaction over `meta`, so no sign-out or sign-in lands between check and write
  private async checkOwner(): Promise<void> {
    const owner = this.owner;
    if (!owner) return;
    const session = await this.db.getMeta('session');
    if (session?.userId !== owner.userId || session.householdId !== owner.householdId) throw new StaleSyncError();
  }

  // made on first use; called inside the caller's rw transaction over `meta`, so tabs agree on it
  private async deviceId(): Promise<string> {
    const existing = await this.db.getMeta('deviceId');
    if (existing) return existing;
    const id = newId();
    await this.db.setMeta('deviceId', id);
    return id;
  }
}
