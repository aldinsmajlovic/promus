import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { newId } from '@promus/shared';
import { hashPassword } from './auth/password.ts';
import { hashToken } from './auth/sessions.ts';
import { transaction } from './db.ts';
import { type Locale, checkPassword, checkUsername, insertHousehold, insertUser } from './users.ts';

export const INVITE_TTL_MS = 7 * 86_400_000;

/** Unknown, used, revoked or expired: one answer, so a link reveals nothing about why. */
export class InviteInvalidError extends Error {
  constructor() {
    super('Invite is unknown, used, revoked or expired');
    this.name = 'InviteInvalidError';
  }
}

type InviteRow = { id: string; household_id: string; expires_at: number; invited_by: string; own_household: number };

export function findValidInvite(db: DatabaseSync, tokenHash: string, now: number): InviteRow | undefined {
  return db
    .prepare(
      `SELECT i.id, i.household_id, i.expires_at, i.own_household, u.username AS invited_by
       FROM invites i JOIN users u ON u.id = i.created_by
       JOIN household_members m ON m.household_id = i.household_id AND m.user_id = i.created_by AND m.removed_at IS NULL
       WHERE i.token_hash = ? AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at >= ?`,
    )
    .get(tokenHash, now) as InviteRow | undefined;
}

/** The token is returned once and only its hash is stored, as for sessions. */
export function createInvite(
  db: DatabaseSync,
  { householdId, userId, ownHousehold, now }: { householdId: string; userId: string; ownHousehold: boolean; now: number },
): { id: string; token: string; expiresAt: number } {
  const id = newId();
  const token = randomBytes(32).toString('base64url');
  const expiresAt = now + INVITE_TTL_MS;
  db.prepare(
    'INSERT INTO invites (id, household_id, token_hash, created_by, created_at, expires_at, own_household) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, householdId, hashToken(token), userId, now, expiresAt, ownHousehold ? 1 : 0);
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
 * A new account joins the invite's household as a member, with no household or list of its own; or, for an
 * own-household invite, gets a household and default list of its own, as from the CLI. Throws AccountError,
 * UserExistsError (the invite stays usable) or InviteInvalidError.
 */
export async function acceptInvite(
  db: DatabaseSync,
  opts: { tokenHash: string; username: string; password: string; locale: Locale; now: number },
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
    let householdId = invite.household_id;
    if (invite.own_household) {
      householdId = insertHousehold(db, { userId, locale: opts.locale, now: opts.now, sessionId: 'invite' }).householdId;
    } else {
      db.prepare("INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'member')")
        .run(householdId, userId);
    }
    db.prepare('UPDATE invites SET used_at = ?, used_by = ? WHERE id = ?').run(opts.now, userId, invite.id);
    return { userId, householdId };
  });
}
