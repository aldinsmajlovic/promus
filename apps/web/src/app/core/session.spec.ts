import { TestBed } from '@angular/core/testing';
import { ApiError, AuthError, formatHlc, makeEvent, newId } from '@promus/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from './api';
import { PendingChangesError, PromusDb } from './db';
import { DexieSyncStorage } from './dexie-storage';
import { CookieRejectedError, PendingOtherUserError, SessionService } from './session';
import { SessionError, Store } from './store';

const anna = { user: { id: 'u1', username: 'anna' }, householdId: newId() };
const bo = { user: { id: 'u2', username: 'bo' }, householdId: newId() };

async function setup() {
  const db = new PromusDb(`session-${newId()}`);
  const api = {
    login: vi.fn<ApiClient['login']>(),
    logout: vi.fn<ApiClient['logout']>(async () => undefined),
    me: vi.fn<ApiClient['me']>(async () => ({ user: anna.user, households: [] })),
  };
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
  it('a session cookie the browser dropped is reported, and nothing local changes', async () => {
    const { db, api, sessions, queue } = await setup();
    await queue();
    api.login.mockResolvedValue(bo);
    api.me.mockRejectedValueOnce(new AuthError());
    const refused = await sessions.login('anna', 'pw').catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(CookieRejectedError);
    expect(refused).toMatchObject({ messageKey: 'https.cookie' });
    expect(await db.getMeta('session')).toMatchObject({ userId: anna.user.id });
    expect(await db.outbox.count()).toBe(1);
    expect(sessions.session()?.userId).toBe(anna.user.id);
  });

  it('assertCanSignIn refuses another user while changes are pending', async () => {
    const { sessions, queue } = await setup();
    await expect(sessions.assertCanSignIn('bo')).resolves.toBeUndefined();
    await queue();
    await expect(sessions.assertCanSignIn(' ANNA ')).resolves.toBeUndefined();
    await expect(sessions.assertCanSignIn('bo')).rejects.toBeInstanceOf(PendingOtherUserError);
  });

  it('the same user signing in again keeps everything, pending changes included', async () => {
    const { db, api, sessions, queue } = await setup();
    await db.setMeta('cursor', 42);
    await queue();
    await sessions.login(' ANNA ', 'pw');
    expect(api.login).toHaveBeenCalledTimes(2);
    expect(await db.getMeta('cursor')).toBe(42);
    expect(await db.outbox.count()).toBe(1);
    expect(api.logout).not.toHaveBeenCalled();
  });

  it('signing in as another user while changes are pending is refused before contacting the server', async () => {
    const { db, api, sessions, queue } = await setup();
    await queue();
    api.login.mockClear();
    const refused = await sessions.login('Bo', 'pw').catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(PendingOtherUserError);
    expect(refused).toMatchObject({ messageKey: 'login.pendingOtherUser', params: { username: 'anna' } });
    expect(api.login).not.toHaveBeenCalled();
    expect(api.logout).not.toHaveBeenCalled();
    expect(await db.outbox.count()).toBe(1);
    expect(await db.getMeta('session')).toMatchObject({ userId: 'u1' });
    expect(sessions.session()).toMatchObject({ userId: 'u1' });
  });

  it('another account behind the same name is refused while changes are pending; once synced, it wipes', async () => {
    const { db, api, sessions, storage, queue } = await setup();
    await db.setMeta('cursor', 42);
    const pending = await queue();
    // only the server can tell, say for an account deleted and made again under the same name
    api.login.mockResolvedValue({ user: { id: 'u3', username: 'anna' }, householdId: newId() });
    const boom = new ApiError(500, 'internal');
    api.logout.mockRejectedValue(boom);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const refused = await sessions.login('anna', 'pw').catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(PendingOtherUserError);
    expect(refused).toMatchObject({ messageKey: 'login.pendingOtherAccount', params: { username: 'anna' } });
    expect(log).toHaveBeenCalledWith('server logout failed', boom);
    log.mockRestore();
    expect(api.logout).toHaveBeenCalledOnce();
    expect(await db.outbox.count()).toBe(1);
    expect(await db.getMeta('session')).toMatchObject({ userId: 'u1' });
    expect(sessions.session()).toMatchObject({ userId: 'u1' });

    await storage.markPushed([pending.id]);
    api.login.mockResolvedValue(bo);
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
    const boom = new ApiError(500, 'internal');
    let fail = (): void => undefined;
    api.logout.mockImplementation(() => new Promise<void>((_, reject) => (fail = () => reject(boom))));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const signingOut = sessions.logout();
    await vi.waitFor(() => expect(api.logout).toHaveBeenCalledOnce());
    // an action during the server call is refused, not queued and then wiped
    await expect(store.createList('Ny lista')).rejects.toBeInstanceOf(SessionError);
    fail();
    // the local sign-out has happened: a failing server call is logged, not thrown
    await signingOut;
    expect(log).toHaveBeenCalledWith('server logout failed', boom);
    log.mockRestore();
    expect(sessions.session()).toBeNull();
    expect(await db.getMeta('session')).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });
});
