import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { tokenCreateSchema } from '@promus/shared';
import type { TokenCreated } from '@promus/shared';
import type { AppDeps, AppEnv } from '../app.ts';
import { API_SCOPES, createSession, listApiTokens, restoreApiToken, revokeApiToken } from '../auth/sessions.ts';
import { requireAuth } from '../middleware/auth.ts';

const small = bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: 'payload_too_large' }, 413) });

export function tokenRoutes({ db, logger, now }: Pick<AppDeps, 'db' | 'logger' | 'now'>) {
  return new Hono<AppEnv>()
    .get('/tokens', requireAuth('browser'), (c) => c.json({ tokens: listApiTokens(db, c.get('auth').userId, now()) }))
    .post('/tokens', requireAuth('browser'), small, async (c) => {
      const { userId } = c.get('auth');
      const body = tokenCreateSchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: 'invalid_request' }, 400);
      const { id, token } = createSession(db, { userId, kind: 'api', name: body.data.name, scopes: [...API_SCOPES], now: now() });
      logger.info({ tokenId: id, userId }, 'token made');
      const created: TokenCreated = { id, token };
      return c.json(created, 201);
    })
    .delete('/tokens/:id', requireAuth('browser'), (c) => {
      const { userId } = c.get('auth');
      const id = c.req.param('id');
      if (!revokeApiToken(db, userId, id, now())) return c.json({ error: 'not_found' }, 404);
      logger.info({ tokenId: id, userId }, 'token revoked');
      return c.body(null, 204);
    })
    .post('/tokens/:id/restore', requireAuth('browser'), (c) => {
      const { userId } = c.get('auth');
      const id = c.req.param('id');
      if (!restoreApiToken(db, userId, id, now())) return c.json({ error: 'not_found' }, 404);
      logger.info({ tokenId: id, userId }, 'token restored');
      return c.body(null, 204);
    });
}
