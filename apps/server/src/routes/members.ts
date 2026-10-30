import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { householdCreateSchema } from '@promus/shared';
import type { AppDeps, AppEnv } from '../app.ts';
import { ensureHousehold, removeMember, restoreMember } from '../members.ts';
import { requireAuth } from '../middleware/auth.ts';

const small = bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: 'payload_too_large' }, 413) });

export function memberRoutes({ db, logger, now }: Pick<AppDeps, 'db' | 'logger' | 'now'>) {
  return new Hono<AppEnv>()
    .delete('/households/:householdId/members/:userId', requireAuth('browser'), small, (c) => {
      const { userId: actorId } = c.get('auth');
      const { householdId, userId: targetId } = c.req.param();
      const result = removeMember(db, { householdId, actorId, targetId, now: now() });
      if (result === 'not_found') return c.json({ error: 'not_found' }, 404);
      if (result === 'forbidden') return c.json({ error: 'forbidden' }, 403);
      logger.info({ householdId, userId: actorId, memberId: targetId }, 'member removed');
      return c.body(null, 204);
    })
    .post('/households/:householdId/members/:userId/restore', requireAuth('browser'), small, (c) => {
      const { userId: actorId } = c.get('auth');
      const { householdId, userId: targetId } = c.req.param();
      const result = restoreMember(db, { householdId, actorId, targetId, now: now() });
      if (result === 'not_found') return c.json({ error: 'not_found' }, 404);
      if (result === 'forbidden') return c.json({ error: 'forbidden' }, 403);
      if (result === 'moved') return c.json({ error: 'member_moved' }, 409);
      logger.info({ householdId, userId: actorId, memberId: targetId }, 'member restored');
      return c.body(null, 204);
    })
    .post('/households', requireAuth('browser'), small, async (c) => {
      const { userId, sessionId } = c.get('auth');
      const text = await c.req.text();
      const body = householdCreateSchema.safeParse(text === '' ? {} : await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: 'invalid_request' }, 400);
      const { householdId, created } = ensureHousehold(db, { userId, locale: body.data.locale ?? 'en', now: now(), sessionId });
      if (created) logger.info({ householdId, userId }, 'household created');
      return c.json({ householdId }, created ? 201 : 200);
    });
}
