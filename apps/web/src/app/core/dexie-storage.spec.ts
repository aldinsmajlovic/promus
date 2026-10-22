import { formatHlc, makeEvent, newId } from '@promus/shared';
import type { EventInput, StoredEvent } from '@promus/shared';
import { syncStorageContract } from '@promus/shared/testing';
import { describe, expect, it } from 'vitest';
import { PromusDb, type Session } from './db';
import { DexieSyncStorage, StaleSyncError } from './dexie-storage';

syncStorageContract('dexie', async () => new DexieSyncStorage(new PromusDb(`contract-${newId()}`)));

describe('DexieSyncStorage for one sync run', () => {
  const session = (username: string): Session => ({ userId: newId(), username, householdId: newId() });
  const event = (householdId: string): EventInput =>
    makeEvent('item.created', { itemId: newId(), name: 'Mjölk' }, {
      householdId,
      hlc: formatHlc(Date.now(), 0, 'test'),
      occurredAt: Date.now(),
    });
  const stored = (e: EventInput, seq: number): StoredEvent => ({ ...e, seq, userId: newId(), receivedAt: e.occurredAt });

  async function setup() {
    const db = new PromusDb(`run-${newId()}`);
    const anna = session('anna');
    await db.setMeta('session', anna);
    const run = new DexieSyncStorage(db, anna);
    await run.getCursor();
    return { db, anna, run };
  }

  it('writes nothing once another user has signed in', async () => {
    const { db, anna, run } = await setup();
    const mine = event(anna.householdId);
    await run.append([mine]);
    await db.setMeta('session', session('bea'));

    await expect(run.applyPulled([stored(event(anna.householdId), 1)], 1)).rejects.toBeInstanceOf(StaleSyncError);
    await expect(run.markPushed([mine.id])).rejects.toBeInstanceOf(StaleSyncError);
    await expect(run.reject([{ event: mine, code: 'invalid', message: 'x' }])).rejects.toBeInstanceOf(StaleSyncError);
    await expect(run.restamp([mine.id], 0)).rejects.toBeInstanceOf(StaleSyncError);
    expect(await db.events.count()).toBe(0);
    expect(await db.getMeta('cursor')).toBeUndefined();
    expect(await run.pendingEvents(500)).toEqual([mine]);
    expect(await db.rejected.count()).toBe(0);
  });

  it('writes nothing once the same user has signed out and in again', async () => {
    const { db, anna, run } = await setup();
    await run.applyPulled([stored(event(anna.householdId), 1)], 1);
    // signing out wipes the local copy; signing in again brings back an equal session
    await db.wipe();
    await db.setMeta('session', { ...anna });

    await expect(run.applyPulled([stored(event(anna.householdId), 2)], 2)).rejects.toBeInstanceOf(StaleSyncError);
    expect(await db.events.count()).toBe(0);
    expect(await db.getMeta('cursor')).toBeUndefined();
  });
});
