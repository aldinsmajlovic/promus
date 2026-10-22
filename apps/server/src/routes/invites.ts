import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { inviteAcceptSchema, inviteTokenSchema } from '@promus/shared';
import type { AppDeps, AppEnv } from '../app.ts';
import { hashToken } from '../auth/sessions.ts';
import { InviteInvalidError, acceptInvite, createInvite, findValidInvite, revokeInvite } from '../invites.ts';
import { requireAuth } from '../middleware/auth.ts';
import { AccountError, UserExistsError } from '../users.ts';

const small = bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: 'payload_too_large' }, 413) });

// Tokens travel only in request bodies: the request log records every path.
export function inviteRoutes({ db, logger, now }: Pick<AppDeps, 'db' | 'logger' | 'now'>) {
  return new Hono<AppEnv>()
    .post('/invites', requireAuth('browser'), (c) => {
      const { userId, householdIds } = c.get('auth');
      const householdId = householdIds[0];
      if (householdId === undefined) return c.json({ error: 'forbidden' }, 403);
      const created = createInvite(db, { householdId, userId, now: now() });
      logger.info({ inviteId: created.id, userId }, 'invite created');
      return c.json(created, 201);
    })
    .delete('/invites/:id', requireAuth('browser'), (c) => {
      const { userId, householdIds } = c.get('auth');
      const id = c.req.param('id');
      if (!revokeInvite(db, id, householdIds, now())) return c.json({ error: 'not_found' }, 404);
      logger.info({ inviteId: id, userId }, 'invite revoked');
      return c.body(null, 204);
    })
    .post('/invites/check', small, async (c) => {
      const body = inviteTokenSchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: 'invalid_request' }, 400);
      const invite = findValidInvite(db, hashToken(body.data.token), now());
      return invite ? c.json({ expiresAt: invite.expires_at }) : c.json({ error: 'invite_invalid' }, 404);
    })
    .post('/invites/accept', small, async (c) => {
      const body = inviteAcceptSchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: 'invalid_request' }, 400);
      const { token, username, password } = body.data;
      const tokenHash = hashToken(token);
      const t = now();
      // before the hash: a bad link costs no scrypt
      if (!findValidInvite(db, tokenHash, t)) return c.json({ error: 'invite_invalid' }, 404);
      try {
        const { userId, householdId } = await acceptInvite(db, { tokenHash, username, password, now: t });
        logger.info({ userId, householdId }, 'invite accepted');
      } catch (err) {
        if (err instanceof InviteInvalidError) return c.json({ error: 'invite_invalid' }, 404);
        if (err instanceof UserExistsError) return c.json({ error: err.code }, 409);
        if (err instanceof AccountError) return c.json({ error: err.code }, 400);
        throw err;
      }
      return c.json({}, 201);
    });
}
