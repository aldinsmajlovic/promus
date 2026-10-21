import { formatHlc, parseEventInput } from '@promus/shared';
import { describe, expect, it } from 'vitest';
import { verifyPassword } from '../src/auth/password.ts';
import { createSession, findSession } from '../src/auth/sessions.ts';
import { UserExistsError, createUser, setPassword } from '../src/users.ts';
import { T0, makeTestApp } from './helpers.ts';

const PW = 'correct horse';

describe('users', { timeout: 20_000 }, () => {
  it('creates user, household, membership and a default list event', async () => {
    const { db } = makeTestApp();
    const ids = await createUser(db, { username: ' Aldin ', password: PW, locale: 'sv', now: T0 });

    const user = db.prepare('SELECT * FROM users').get() as Record<string, unknown>;
    expect(user).toMatchObject({ id: ids.userId, username: 'Aldin', username_norm: 'aldin', created_at: T0, disabled_at: null });
    expect(await verifyPassword(PW, user.password_hash as string)).toBe(true);
    expect(db.prepare('SELECT * FROM households').all()).toEqual([{ id: ids.householdId, created_at: T0 }]);
    expect(db.prepare('SELECT * FROM household_members').all()).toEqual([
      { household_id: ids.householdId, user_id: ids.userId, role: 'owner' },
    ]);

    const ev = db.prepare('SELECT * FROM events').get() as Record<string, string | number | null>;
    expect(ev).toMatchObject({
      household_id: ids.householdId, user_id: ids.userId, session_id: 'cli', type: 'list.created', v: 1,
      hlc: formatHlc(T0, 0, 'server'), occurred_at: T0, received_at: T0, undo_of: null,
    });
    expect(JSON.parse(ev.payload as string)).toEqual({ listId: ids.listId, name: 'Inköpslista' });
    const parsed = parseEventInput({
      id: ev.id, householdId: ev.household_id, type: ev.type, v: ev.v, hlc: ev.hlc,
      occurredAt: ev.occurred_at, payload: JSON.parse(ev.payload as string),
    });
    expect(parsed.ok).toBe(true);

    const en = await createUser(db, { username: 'Bob', password: PW, locale: 'en', now: T0 });
    const enPayload = db.prepare('SELECT payload FROM events WHERE household_id = ?').get(en.householdId) as { payload: string };
    expect(JSON.parse(enPayload.payload).name).toBe('Shopping list');

    await expect(createUser(db, { username: 'Carl', password: '1234567', locale: 'sv', now: T0 })).rejects.toThrow(/at least 8/);
    await expect(createUser(db, { username: '  ', password: PW, locale: 'sv', now: T0 })).rejects.toThrow(/Username/);
  });

  it('treats usernames case-insensitively', async () => {
    const { db } = makeTestApp();
    await createUser(db, { username: 'Aldin', password: PW, locale: 'sv', now: T0 });
    const dup = createUser(db, { username: 'aldin', password: PW, locale: 'sv', now: T0 });
    await expect(dup).rejects.toBeInstanceOf(UserExistsError);
    await expect(dup).rejects.toThrow('User "aldin" already exists');
    expect(db.prepare('SELECT count(*) AS n FROM households').get()).toEqual({ n: 1 });
  });

  it('setPassword revokes existing sessions', async () => {
    const { db } = makeTestApp();
    const { userId } = await createUser(db, { username: 'Aldin', password: PW, locale: 'sv', now: T0 });
    const browser = createSession(db, { userId, kind: 'browser', name: null, scopes: [], now: T0 });
    const api = createSession(db, { userId, kind: 'api', name: 'Home Assistant', scopes: ['lists:read'], now: T0 });
    expect(findSession(db, browser.token, T0)).not.toBeNull();

    await setPassword(db, 'ALDIN', 'new password', T0 + 1);
    expect(findSession(db, browser.token, T0 + 1)).toBeNull();
    expect(findSession(db, api.token, T0 + 1)).toBeNull();
    const { password_hash } = db.prepare('SELECT password_hash FROM users').get() as { password_hash: string };
    expect(await verifyPassword('new password', password_hash)).toBe(true);

    await expect(setPassword(db, 'nobody', 'new password', T0)).rejects.toThrow('User "nobody" not found');
    await expect(setPassword(db, 'aldin', 'short', T0)).rejects.toThrow(/at least 8/);
  });
});
