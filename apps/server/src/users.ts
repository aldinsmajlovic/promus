import type { DatabaseSync } from 'node:sqlite';
import { LIMITS, cleanName, formatHlc, makeEvent, newId, normalizeName } from '@promus/shared';
import { MIN_PASSWORD_LENGTH, hashPassword } from './auth/password.ts';
import { transaction } from './db.ts';

export type Locale = 'sv' | 'en';

const DEFAULT_LIST_NAME: Record<Locale, string> = { sv: 'Inköpslista', en: 'Shopping list' };

export class UserExistsError extends Error {
  constructor(username: string) {
    super(`User "${username}" already exists`);
    this.name = 'UserExistsError';
  }
}

function checkPassword(password: string): void {
  if ([...password].length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
}

export async function createUser(
  db: DatabaseSync,
  opts: { username: string; password: string; locale: Locale; now: number },
): Promise<{ userId: string; householdId: string; listId: string }> {
  const username = cleanName(opts.username);
  if (username === '' || username.length > LIMITS.nameMax) {
    throw new Error(`Username must be 1 to ${LIMITS.nameMax} characters`);
  }
  checkPassword(opts.password);
  const passwordHash = await hashPassword(opts.password);
  const { now } = opts;
  const userId = newId();
  const householdId = newId();
  const listId = newId();
  const event = makeEvent(
    'list.created',
    { listId, name: DEFAULT_LIST_NAME[opts.locale] },
    { householdId, hlc: formatHlc(now, 0, 'server'), occurredAt: now },
  );
  transaction(db, () => {
    const norm = normalizeName(username);
    if (db.prepare('SELECT 1 FROM users WHERE username_norm = ?').get(norm)) throw new UserExistsError(username);
    db.prepare('INSERT INTO users (id, username, username_norm, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, username, norm, passwordHash, now);
    db.prepare('INSERT INTO households (id, created_at) VALUES (?, ?)').run(householdId, now);
    db.prepare("INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'owner')").run(householdId, userId);
    db.prepare(
      `INSERT INTO events (id, household_id, user_id, session_id, type, v, hlc, occurred_at, received_at, payload)
       VALUES (?, ?, ?, 'cli', ?, ?, ?, ?, ?, ?)`,
    ).run(event.id, householdId, userId, event.type, event.v, event.hlc, event.occurredAt, now, JSON.stringify(event.payload));
  });
  return { userId, householdId, listId };
}

export async function setPassword(db: DatabaseSync, username: string, password: string, now: number): Promise<void> {
  checkPassword(password);
  const passwordHash = await hashPassword(password);
  transaction(db, () => {
    const user = db.prepare('SELECT id FROM users WHERE username_norm = ?').get(normalizeName(username)) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`User "${cleanName(username)}" not found`);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, user.id);
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now, user.id);
  });
}
