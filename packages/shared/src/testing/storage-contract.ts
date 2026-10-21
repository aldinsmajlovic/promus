import { describe, expect, it } from 'vitest';
import { formatHlc, hlcWall, makeEvent, newId } from '../index.ts';
import type { EventInput, StoredEvent, SyncStorage } from '../index.ts';

/**
 * A storage under test. `append` seeds the outbox, the way the app's own write path does.
 *
 * What the contract can't see through the interface, and each implementation must still do:
 * - `make` wires the real `Date.now()` clock: the restamp tests compare new hlcs against it.
 * - `applyPulled` is checked only as an end state. An IndexedDB storage must write the events, the outbox
 *   deletes and the cursor in one transaction, and its review must check that by hand.
 * - `restamp` recomputes the hlc state from pulled and pushed rows only, leaving out ALL still-pending rows.
 */
export type ContractStorage = SyncStorage & {
  pendingCount(): Promise<number> | number;
  append(events: EventInput[]): Promise<void> | void;
};

const MIN = 60_000;
const HOUR = 60 * MIN;

/** The reusable SyncStorage suite; see `ContractStorage` for what it relies on. */
export function syncStorageContract(name: string, make: () => Promise<ContractStorage>): void {
  describe(`SyncStorage contract: ${name}`, () => {
    const householdId = newId();
    const ev = (wall: number, counter: number): EventInput =>
      makeEvent('item.created', { itemId: newId(), name: 'Mjölk' }, {
        householdId,
        hlc: formatHlc(wall, counter, 'contract'),
        occurredAt: wall,
      });
    const stored = (e: EventInput, seq: number): StoredEvent => ({ ...e, seq, userId: newId(), receivedAt: e.occurredAt });
    const ids = (events: EventInput[]) => events.map((e) => e.id);
    const pendingIds = async (s: SyncStorage) => ids(await s.pendingEvents(500));

    it('pendingEvents excludes pushed events', async () => {
      const s = await make();
      const now = Date.now();
      const [a, b, c] = [ev(now, 2), ev(now, 0), ev(now, 1)];
      await s.append([a, b, c]);
      expect(await pendingIds(s)).toEqual(ids([b, c, a]));
      expect(ids(await s.pendingEvents(2))).toEqual(ids([b, c]));
      await s.markPushed([c.id]);
      expect(await pendingIds(s)).toEqual(ids([b, a]));
      expect(await s.pendingCount()).toBe(2);
    });

    it('applyPulled removes outbox rows with the same ids and sets the cursor in one step', async () => {
      const s = await make();
      const now = Date.now();
      const [mine, other, theirs] = [ev(now, 0), ev(now, 1), ev(now, 2)];
      await s.append([mine, other]);
      expect(await s.getCursor()).toBe(0);
      await s.applyPulled([stored(mine, 41), stored(theirs, 42)], 42);
      expect(await s.getCursor()).toBe(42);
      expect(await pendingIds(s)).toEqual([other.id]);
      expect(await s.pendingCount()).toBe(1);
    });

    it('restamp changes only the given ids', async () => {
      const s = await make();
      const future = Date.now() + 2 * HOUR;
      const [a, b, c] = [ev(future, 0), ev(future, 1), ev(future, 2)];
      await s.append([a, b, c]);
      await s.restamp([c.id, a.id], -HOUR);
      const after = new Map((await s.pendingEvents(500)).map((e) => [e.id, e]));
      expect(after.get(b.id)).toEqual(b);
      const [a2, c2] = [after.get(a.id)!, after.get(c.id)!];
      expect({ ...a2, hlc: a.hlc }).toEqual(a);
      expect({ ...c2, hlc: c.hlc }).toEqual(c);
      for (const e of [a2, c2]) expect(Math.abs(hlcWall(e.hlc) - (Date.now() - HOUR))).toBeLessThan(5000);
      // re-stamped in their original order
      expect(a2.hlc < c2.hlc).toBe(true);
    });

    it('restamp lands after every pulled and pushed event', async () => {
      const s = await make();
      const now = Date.now();
      const [pulled, pushed, pending] = [ev(now + 30 * MIN, 0), ev(now + 40 * MIN, 0), ev(now + 2 * HOUR, 0)];
      await s.applyPulled([stored(pulled, 1)], 1);
      await s.append([pushed, pending]);
      await s.markPushed([pushed.id]);
      await s.restamp([pending.id], 0);
      const [restamped] = await s.pendingEvents(500);
      expect(restamped?.id).toBe(pending.id);
      expect(restamped!.hlc > pulled.hlc && restamped!.hlc > pushed.hlc).toBe(true);
      // lowered from +2h to just after the pushed event
      expect(hlcWall(restamped!.hlc)).toBe(now + 40 * MIN);
    });

    it('reject moves events out of the pending set', async () => {
      const s = await make();
      const now = Date.now();
      const [a, b] = [ev(now, 0), ev(now, 1)];
      await s.append([a, b]);
      await s.reject([{ event: a, code: 'invalid', message: 'name must be clean' }]);
      expect(await pendingIds(s)).toEqual([b.id]);
      expect(await s.pendingCount()).toBe(1);
    });
  });
}
