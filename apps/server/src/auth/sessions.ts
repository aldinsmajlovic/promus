import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { newId } from '@promus/shared';
import type { ApiToken } from '@promus/shared';

export const SESSION_TTL_MS = 400 * 86_400_000;
export const RENEW_AFTER_MS = 86_400_000;

export const API_SCOPES = ['lists:read', 'lists:write'] as const;
export type Scope = (typeof API_SCOPES)[number];

export type SessionKind = 'browser' | 'api';

export type AuthContext = {
  sessionId: string;
  userId: string;
  username: string;
  householdIds: string[];
  kind: SessionKind;
  scopes: string[];
  expiresAt: number;
};

type SessionRow = { id: string; user_id: string; username: string; kind: SessionKind; scopes: string; expires_at: number };

// Only the hash is stored, for sessions and invites alike. Lookups go by hash, so a timing difference in the index reveals nothing about a token.
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export function findSession(db: DatabaseSync, token: string, now: number): AuthContext | null {
  const row = db
    .prepare(
      `SELECT s.id, s.user_id, u.username, s.kind, s.scopes, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.disabled_at IS NULL`,
    )
    .get(hashToken(token), now) as SessionRow | undefined;
  if (!row) return null;
  const households = db
    .prepare('SELECT household_id FROM household_members WHERE user_id = ? AND removed_at IS NULL ORDER BY household_id')
    .all(row.user_id) as { household_id: string }[];
  return {
    sessionId: row.id,
    userId: row.user_id,
    username: row.username,
    householdIds: households.map((h) => h.household_id),
    kind: row.kind,
    scopes: JSON.parse(row.scopes) as string[],
    expiresAt: row.expires_at,
  };
}

export function createSession(
  db: DatabaseSync,
  opts: { userId: string; kind: SessionKind; name: string | null; scopes: string[]; now: number },
): { id: string; token: string; context: AuthContext } {
  const id = newId();
  const token = (opts.kind === 'api' ? 'pr_' : '') + randomBytes(32).toString('base64url');
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, kind, name, scopes, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, opts.userId, hashToken(token), opts.kind, opts.name, JSON.stringify(opts.scopes), opts.now, opts.now, opts.now + SESSION_TTL_MS);
  const context = findSession(db, token, opts.now);
  if (!context) throw new Error(`user ${opts.userId} is disabled`);
  return { id, token, context };
}

/** Extends the session at most once per RENEW_AFTER_MS; the last renewal is expiresAt - SESSION_TTL_MS. */
export function renewIfDue(db: DatabaseSync, ctx: AuthContext, now: number): number | null {
  if (now - (ctx.expiresAt - SESSION_TTL_MS) <= RENEW_AFTER_MS) return null;
  const expiresAt = now + SESSION_TTL_MS;
  db.prepare('UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?').run(expiresAt, now, ctx.sessionId);
  return expiresAt;
}

export function revokeSession(db: DatabaseSync, sessionId: string, now: number): void {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(now, sessionId);
}

/** Records a token's use: at once the first time, then at most hourly. */
export function touchApiToken(db: DatabaseSync, sessionId: string, now: number): void {
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ? AND (last_seen_at = created_at OR last_seen_at < ?)').run(
    now,
    sessionId,
    now - 3_600_000,
  );
}

export function listApiTokens(db: DatabaseSync, userId: string, now: number): ApiToken[] {
  const rows = db
    .prepare(
      `SELECT id, name, created_at, last_seen_at FROM sessions
       WHERE user_id = ? AND kind = 'api' AND revoked_at IS NULL AND expires_at > ?
       ORDER BY created_at, id`,
    )
    .all(userId, now) as { id: string; name: string; created_at: number; last_seen_at: number }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    lastUsedAt: r.last_seen_at === r.created_at ? null : r.last_seen_at,
  }));
}

export function revokeApiToken(db: DatabaseSync, userId: string, id: string, now: number): boolean {
  const res = db
    .prepare("UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND kind = 'api' AND revoked_at IS NULL")
    .run(now, id, userId);
  return res.changes > 0;
}

export function restoreApiToken(db: DatabaseSync, userId: string, id: string, now: number): boolean {
  const res = db
    .prepare(
      "UPDATE sessions SET revoked_at = NULL WHERE id = ? AND user_id = ? AND kind = 'api' AND revoked_at IS NOT NULL AND expires_at > ?",
    )
    .run(id, userId, now);
  return res.changes > 0;
}
