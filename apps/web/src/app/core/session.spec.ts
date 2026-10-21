import { TestBed } from '@angular/core/testing';
import { formatHlc, makeEvent, newId } from '@promus/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from './api';
import { PendingChangesError, PromusDb } from './db';
import { DexieSyncStorage } from './dexie-storage';
import { PendingOtherUserError, SessionService } from './session';
import { Store } from './store';

const anna = { user: { id: 'u1', username: 'anna' }, householdId: newId() };
const bo = { user: { id: 'u2', username: 'bo' }, householdId: newId() };

async function setup() {
  const db = new PromusDb(`session-${newId()}`);
  const api = { login: vi.fn<ApiClient['login']>(), logout: vi.fn<ApiClient['logout']>(async () => undefined) };
  TestBed.configureTestingModule({
    providers: [
      { provide: PromusDb, useValue: db },
      { provide: ApiClient, useValue: api },
    ],
  });
  const sessions = TestBed.inject(SessionService);
  api.login.mockResolvedValue(anna);
  await sessions.login('anna', 'pw');
  const storage = new DexieSyncStorage(db);
  // a queued change of anna's, as the Store would write it
  const queue = async () => {
    const event = makeEvent('list.created', { listId: newId(), name: 'Inköpslista' }, {
      householdId: anna.householdId,
      hlc: formatHlc(Date.now(), 0, 'test'),
      occurredAt: Date.now(),
    });
    await storage.append([event]);
    return event;
  };
  return { db, api, sessions, storage, queue };
}

describe('SessionService', () => {
  it('the same user signing in again keeps everything, pending changes included', async () => {
    const { db, api, sessions, queue } = await setup();
    await db.setMeta('cursor', 42);
    await queue();
    await sessions.login('anna', 'pw');
    expect(await db.getMeta('cursor')).toBe(42);
    expect(await db.outbox.count()).toBe(1);
    expect(api.logout).not.toHaveBeenCalled();
  });

  it('signing in as another user is refused while changes are pending, and wipes synced data', async () => {
    const { db, api, sessions, storage, queue } = await setup();
    await db.setMeta('cursor', 42);
    const pending = await queue();
    api.login.mockResolvedValue(bo);
    const refused = await sessions.login('bo', 'pw').catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(PendingOtherUserError);
    expect(refused).toMatchObject({ messageKey: 'login.pendingOtherUser', params: { username: 'anna' } });
    expect(api.logout).toHaveBeenCalledOnce();
    expect(await db.outbox.count()).toBe(1);
    expect(await db.getMeta('session')).toMatchObject({ userId: 'u1' });
    expect(sessions.session()).toMatchObject({ userId: 'u1' });

    await storage.markPushed([pending.id]);
    await sessions.login('bo', 'pw');
    expect(await db.getMeta('cursor')).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
    expect(sessions.session()).toMatchObject({ userId: 'u2', username: 'bo' });
    expect(await db.getMeta('session')).toEqual(sessions.session());
  });

  it('logout refuses while changes are unsynced, and nothing can be queued while it signs out', async () => {
    const { db, api, sessions, storage, queue } = await setup();
    const pending = await queue();
    await expect(sessions.logout()).rejects.toBeInstanceOf(PendingChangesError);
    expect(api.logout).not.toHaveBeenCalled();
    expect(await db.outbox.count()).toBe(1);
    expect(sessions.session()).toMatchObject({ userId: 'u1' });

    await storage.markPushed([pending.id]);
    const store = TestBed.inject(Store);
    await store.load();
    let release = (): void => undefined;
    api.logout.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
    const signingOut = sessions.logout();
    await vi.waitFor(() => expect(api.logout).toHaveBeenCalledOnce());
    // an action during the server call is refused, not queued and then wiped
    await expect(store.createList('Ny lista')).rejects.toThrow();
    release();
    await signingOut;
    expect(sessions.session()).toBeNull();
    expect(await db.getMeta('session')).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });
});
