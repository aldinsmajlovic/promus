import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { newId } from '@promus/shared';
import { hashPassword } from './auth/password.ts';
import { hashToken } from './auth/sessions.ts';
import { transaction } from './db.ts';
import { checkPassword, checkUsername, insertUser } from './users.ts';

export const INVITE_TTL_MS = 7 * 86_400_000;

/** Unknown, used, revoked or expired: one answer, so a link reveals nothing about why. */
export class InviteInvalidError extends Error {
  constructor() {
    super('Invite is unknown, used, revoked or expired');
    this.name = 'InviteInvalidError';
  }
}

type InviteRow = { id: string; household_id: string; expires_at: number };

export function findValidInvite(db: DatabaseSync, tokenHash: string, now: number): InviteRow | undefined {
  return db
    .prepare(
      `SELECT id, household_id, expires_at FROM invites
       WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at >= ?`,
    )
    .get(tokenHash, now) as InviteRow | undefined;
}

/** The token is returned once and only its hash is stored, as for sessions. */
export function createInvite(
  db: DatabaseSync,
  { householdId, userId, now }: { householdId: string; userId: string; now: number },
): { id: string; token: string; expiresAt: number } {
  const id = newId();
  const token = randomBytes(32).toString('base64url');
  const expiresAt = now + INVITE_TTL_MS;
  db.prepare(
    'INSERT INTO invites (id, household_id, token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, householdId, hashToken(token), userId, now, expiresAt);
  return { id, token, expiresAt };
}

/** False when no invite with that id belongs to one of `householdIds`. Revoking twice is fine. */
export function revokeInvite(db: DatabaseSync, id: string, householdIds: string[], now: number): boolean {
  const row = db.prepare('SELECT household_id FROM invites WHERE id = ?').get(id) as { household_id: string } | undefined;
  if (!row || !householdIds.includes(row.household_id)) return false;
  db.prepare('UPDATE invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(now, id);
  return true;
}

/**
 * A new account joins the invite's household as a member: no household or list of its own. Throws
 * AccountError, UserExistsError (the invite stays usable) or InviteInvalidError.
 */
export async function acceptInvite(
  db: DatabaseSync,
  opts: { tokenHash: string; username: string; password: string; now: number },
): Promise<{ userId: string; householdId: string }> {
  const username = checkUsername(opts.username);
  checkPassword(opts.password);
  const passwordHash = await hashPassword(opts.password);
  const userId = newId();
  return transaction(db, () => {
    // again: it may have been used or revoked while the password was hashed
    const invite = findValidInvite(db, opts.tokenHash, opts.now);
    if (!invite) throw new InviteInvalidError();
    insertUser(db, { userId, username, passwordHash, now: opts.now });
    db.prepare("INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'member')")
      .run(invite.household_id, userId);
    db.prepare('UPDATE invites SET used_at = ?, used_by = ? WHERE id = ?').run(opts.now, userId, invite.id);
    return { userId, householdId: invite.household_id };
  });
}
