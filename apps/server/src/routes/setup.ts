import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { setupRequestSchema } from '@promus/shared';
import type { AppDeps, AppEnv } from '../app.ts';
import { createLoginLimiter } from '../auth/rate-limit.ts';
import { makeSetupCode, sameSetupCode } from '../auth/setup-code.ts';
import { AccountError, AlreadySetUpError, createUser } from '../users.ts';

/**
 * The first account, from the browser. A server with no users prints a one-time code to its log: whoever
 * reaches a fresh public server first must not be able to claim it.
 */
export function setupRoutes({ db, logger, now }: Pick<AppDeps, 'db' | 'logger' | 'now'>) {
  const noUsers = () => db.prepare('SELECT 1 FROM users LIMIT 1').get() === undefined;
  // in memory only: a restart prints a new one
  let code = noUsers() ? makeSetupCode() : null;
  // warn: an unclaimed server needs its owner, and the line must show at any LOG_LEVEL but error
  if (code) logger.warn(`Setup code: ${code}`);
  const limiter = createLoginLimiter();
  return new Hono<AppEnv>()
    .get('/setup', (c) => c.json({ needed: noUsers() }))
    .post(
      '/setup',
      bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: 'payload_too_large' }, 413) }),
      async (c) => {
        const body = setupRequestSchema.safeParse(await c.req.json().catch(() => null));
        if (!body.success) return c.json({ error: 'invalid_request' }, 400);
        const t = now();
        // every refusal before the hash, so guessing costs no scrypt
        if (limiter.blocked('setup', t)) return c.json({ error: 'rate_limited' }, 429);
        if (code === null || !noUsers()) return c.json({ error: 'already_set_up' }, 409);
        if (!sameSetupCode(body.data.setupCode, code)) {
          limiter.fail('setup', t);
          logger.warn('setup code refused');
          return c.json({ error: 'setup_code_invalid' }, 403);
        }
        const { username, password, locale } = body.data;
        try {
          await createUser(db, { username, password, locale, now: t, assertNoUsers: true, sessionId: 'setup' });
        } catch (err) {
          if (err instanceof AlreadySetUpError) return c.json({ error: 'already_set_up' }, 409);
          if (err instanceof AccountError) return c.json({ error: err.code }, 400);
          throw err;
        }
        code = null;
        logger.info({ username }, 'setup completed');
        return c.json({}, 201);
      },
    );
}
