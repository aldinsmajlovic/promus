import { TestBed } from '@angular/core/testing';
import { formatHlc, makeEvent, newId } from '@promus/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from './api';
import { PromusDb } from './db';
import { DexieSyncStorage } from './dexie-storage';
import { SessionService } from './session';

function setup() {
  const db = new PromusDb(`session-${newId()}`);
  const api = { login: vi.fn<ApiClient['login']>(), logout: vi.fn(async () => undefined) };
  TestBed.configureTestingModule({
    providers: [
      { provide: PromusDb, useValue: db },
      { provide: ApiClient, useValue: api },
    ],
  });
  return { db, api, sessions: TestBed.inject(SessionService) };
}

describe('SessionService', () => {
  it('login as another user wipes local data, the same user keeps it', async () => {
    const { db, api, sessions } = setup();
    api.login.mockResolvedValue({ user: { id: 'u1', username: 'anna' }, householdId: newId() });
    await sessions.login('anna', 'pw');
    await db.setMeta('cursor', 42);
    await sessions.login('anna', 'pw');
    expect(await db.getMeta('cursor')).toBe(42);

    api.login.mockResolvedValue({ user: { id: 'u2', username: 'bo' }, householdId: newId() });
    await sessions.login('bo', 'pw');
    expect(await db.getMeta('cursor')).toBeUndefined();
    expect(sessions.session()).toMatchObject({ userId: 'u2', username: 'bo' });
    expect(await db.getMeta('session')).toEqual(sessions.session());
  });

  it('logout refuses while changes are unsynced, then wipes local data', async () => {
    const { db, api, sessions } = setup();
    const householdId = newId();
    api.login.mockResolvedValue({ user: { id: 'u1', username: 'anna' }, householdId });
    await sessions.login('anna', 'pw');
    const storage = new DexieSyncStorage(db);
    const event = makeEvent('list.created', { listId: newId(), name: 'Inköpslista' }, {
      householdId,
      hlc: formatHlc(Date.now(), 0, 'test'),
      occurredAt: Date.now(),
    });
    await storage.append([event]);
    await expect(sessions.logout()).rejects.toThrow('unsynced');
    expect(api.logout).not.toHaveBeenCalled();

    await storage.markPushed([event.id]);
    await sessions.logout();
    expect(api.logout).toHaveBeenCalledOnce();
    expect(sessions.session()).toBeNull();
    expect(await db.outbox.count()).toBe(0);
    expect(await db.getMeta('session')).toBeUndefined();
  });
});
