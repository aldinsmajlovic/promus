import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { shareCreateSchema } from '@promus/shared';
import type { AppDeps, AppEnv } from '../app.ts';
import { listState } from '../events-repo.ts';
import { requireAuth } from '../middleware/auth.ts';
import { createOrGetShare, endShare, listShares, restoreShare } from '../shares.ts';

const small = bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: 'payload_too_large' }, 413) });

// Tokens are only ever in response bodies: the request log records every path.
export function shareRoutes({ db, logger, now }: Pick<AppDeps, 'db' | 'logger' | 'now'>) {
  return new Hono<AppEnv>()
    .post('/shares', requireAuth('browser'), small, async (c) => {
      const { userId, householdIds } = c.get('auth');
      const householdId = householdIds[0];
      if (householdId === undefined) return c.json({ error: 'forbidden' }, 403);
      const body = shareCreateSchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: 'invalid_request' }, 400);
      const { listId } = body.data;
      const state = listState(db, householdId, listId);
      if (!state || state.deleted) return c.json({ error: 'not_found' }, 404);
      const { share, created } = createOrGetShare(db, { householdId, listId, userId, now: now() });
      if (created) logger.info({ shareId: share.id, listId, userId }, 'share created');
      return c.json(share, created ? 201 : 200);
    })
    .get('/shares', requireAuth('browser'), (c) => {
      const householdId = c.get('auth').householdIds[0];
      if (householdId === undefined) return c.json({ error: 'forbidden' }, 403);
      return c.json(listShares(db, householdId, now()));
    })
    .delete('/shares/:id', requireAuth('browser'), (c) => {
      const { userId, householdIds } = c.get('auth');
      const id = c.req.param('id');
      if (!endShare(db, id, householdIds, now())) return c.json({ error: 'not_found' }, 404);
      logger.info({ shareId: id, userId }, 'share ended');
      return c.body(null, 204);
    })
    .post('/shares/:id/restore', requireAuth('browser'), (c) => {
      const { userId, householdIds } = c.get('auth');
      const id = c.req.param('id');
      const result = restoreShare(db, id, householdIds, now());
      if (result === 'not_found') return c.json({ error: 'not_found' }, 404);
      if (result === 'expired') return c.json({ error: 'share_invalid' }, 404);
      logger.info({ shareId: id, userId }, 'share restored');
      return c.body(null, 204);
    });
}
