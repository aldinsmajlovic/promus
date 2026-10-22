import { TestBed } from '@angular/core/testing';
import { ApiError, AuthError, NetworkError, newId } from '@promus/shared';
import type { EventInput, PullResponse, PushResponse, SyncApi } from '@promus/shared';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { ApiClient } from './api';
import { PromusDb } from './db';
import { Store } from './store';
import { SyncService } from './sync.service';

const pullNothing = async (after: number): Promise<PullResponse> => ({
  events: [],
  lastSeq: after,
  hasMore: false,
  serverTime: Date.now(),
});
const accepted = (events: EventInput[]): PushResponse => ({
  accepted: events.map((e) => e.id),
  rejected: [],
  serverTime: Date.now(),
});

async function setup(push: SyncApi['push']) {
  const db = new PromusDb(`sync-${newId()}`);
  await db.setMeta('session', { userId: newId(), username: 'anna', householdId: newId() });
  const api = { push: vi.fn(push), pull: vi.fn(pullNothing) };
  TestBed.configureTestingModule({
    providers: [
      { provide: PromusDb, useValue: db },
      { provide: ApiClient, useValue: api },
    ],
  });
  const store = TestBed.inject(Store);
  await store.load();
  const { listId } = await store.createList('Inköpslista');
  return { api, db, store, listId, sync: TestBed.inject(SyncService) };
}

describe('SyncService', () => {
  it('reports offline and keeps the pending count when the network fails', async () => {
    const { db, sync } = await setup(async () => {
      throw new NetworkError();
    });
    await sync.syncNow();
    expect(sync.status()).toEqual({ kind: 'offline', pending: 1, rejected: 0 });
    expect(await db.outbox.count()).toBe(1);
  });

  it('reports auth when the server has ended the session', async () => {
    const { db, sync } = await setup(async () => {
      throw new AuthError();
    });
    await sync.syncNow();
    expect(sync.status()).toEqual({ kind: 'auth', pending: 1, rejected: 0 });
    expect(await db.outbox.count()).toBe(1);
  });

  it('signed out, stays off the network and idle: only a 401 asks to sign in', async () => {
    const { api, db, sync } = await setup(async (events) => accepted(events));
    await db.meta.delete('session');
    await sync.syncNow();
    expect(api.push).not.toHaveBeenCalled();
    expect(api.pull).not.toHaveBeenCalled();
    expect(sync.status().kind).toBe('idle');
  });

  it('runs one sync at a time', async () => {
    let release = (): void => undefined;
    const { api, sync } = await setup(
      (events) => new Promise<PushResponse>((resolve) => (release = () => resolve(accepted(events)))),
    );
    const first = sync.syncNow();
    const second = sync.syncNow();
    await vi.waitFor(() => expect(api.push).toHaveBeenCalled());
    expect(sync.status().kind).toBe('syncing');
    release();
    await Promise.all([first, second]);
    expect(api.push).toHaveBeenCalledOnce();
    expect(sync.status()).toEqual({ kind: 'idle', pending: 0, rejected: 0 });
  });

  it('reports refused events and unexpected failures as errors', async () => {
    const { api, store, listId, sync } = await setup(async (events) => ({
      accepted: [],
      rejected: events.map((e) => ({ id: e.id, code: 'invalid' as const, message: 'name must be clean' })),
      serverTime: Date.now(),
    }));
    await sync.syncNow();
    expect(sync.status()).toEqual({ kind: 'error', messageKey: 'sync.rejected', pending: 0, rejected: 1 });

    const boom = new ApiError(500, 'internal');
    api.push.mockRejectedValue(boom);
    await store.addByName(listId, 'Mjölk');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await sync.syncNow();
    expect(log).toHaveBeenCalledWith('sync failed', boom);
    log.mockRestore();
    expect(sync.status()).toEqual({ kind: 'error', messageKey: 'sync.failed', pending: 2, rejected: 1 });
  });

  it('reports a refusal until the next clean sync, and keeps counting it', async () => {
    const { sync } = await setup(async (events) => ({
      accepted: [],
      rejected: events.map((e) => ({ id: e.id, code: 'invalid' as const, message: 'name must be clean' })),
      serverTime: Date.now(),
    }));
    await sync.syncNow();
    expect(sync.status()).toEqual({ kind: 'error', messageKey: 'sync.rejected', pending: 0, rejected: 1 });
    await sync.syncNow();
    expect(sync.status()).toEqual({ kind: 'idle', pending: 0, rejected: 1 });
  });

  it('reports a refusal even when the pull then fails', async () => {
    const { api, sync } = await setup(async (events) => ({
      accepted: [],
      rejected: events.map((e) => ({ id: e.id, code: 'invalid' as const, message: 'name must be clean' })),
      serverTime: Date.now(),
    }));
    api.pull.mockRejectedValue(new NetworkError());
    await sync.syncNow();
    expect(sync.status()).toEqual({ kind: 'error', messageKey: 'sync.rejected', pending: 0, rejected: 1 });
  });

  it('syncs once more when soon() fires during a sync', async () => {
    const { api, store, listId, sync } = await setup(async (events) => accepted(events));
    let release = (): void => undefined;
    api.pull.mockImplementationOnce(
      (after) =>
        new Promise<PullResponse>((resolve) => {
          release = () => resolve({ events: [], lastSeq: after, hasMore: false, serverTime: Date.now() });
        }),
    );
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    onTestFinished(() => {
      sync.stop();
      vi.useRealTimers();
    });
    sync.start();
    // the first sync has pushed and now waits on its pull: an action made now is past its push
    await vi.waitFor(() => expect(api.pull).toHaveBeenCalledOnce());
    await store.addByName(listId, 'Mjölk');
    vi.advanceTimersByTime(2000);
    release();
    await vi.waitFor(() => expect(api.push).toHaveBeenCalledTimes(2));
    expect(api.push.mock.calls[1]?.[0].map((e) => e.type)).toEqual(['item.created', 'entry.added']);
    await vi.waitFor(() => expect(sync.status()).toMatchObject({ kind: 'idle', pending: 0 }));
  });

  it('syncs on start, when visible, when online, every 60 s while visible and 2 s after soon()', async () => {
    const { sync } = await setup(async (events) => accepted(events));
    const syncNow = vi.spyOn(sync, 'syncNow').mockResolvedValue();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    onTestFinished(() => {
      sync.stop();
      vi.useRealTimers();
    });
    sync.soon();
    vi.advanceTimersByTime(2000);
    expect(syncNow).not.toHaveBeenCalled();

    sync.start();
    expect(syncNow).toHaveBeenCalledTimes(1);
    sync.soon();
    vi.advanceTimersByTime(1000);
    sync.soon();
    vi.advanceTimersByTime(1999);
    expect(syncNow).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(syncNow).toHaveBeenCalledTimes(2);

    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(syncNow).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(57_000);
    expect(syncNow).toHaveBeenCalledTimes(5);

    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(60_000);
    hidden.mockRestore();
    expect(syncNow).toHaveBeenCalledTimes(5);

    sync.stop();
    window.dispatchEvent(new Event('online'));
    sync.soon();
    vi.advanceTimersByTime(60_000);
    expect(syncNow).toHaveBeenCalledTimes(5);
  });
});
