import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { loginRequestSchema, normalizeName } from '@promus/shared';
import type { AppDeps, AppEnv } from '../app.ts';
import { hashPassword, verifyPassword } from '../auth/password.ts';
import { createLoginLimiter } from '../auth/rate-limit.ts';
import { createSession, revokeSession } from '../auth/sessions.ts';
import { clearSessionCookie, requireAuth, setSessionCookie } from '../middleware/auth.ts';

type UserRow = { id: string; username: string; password_hash: string; disabled_at: number | null };

export function authRoutes({ db, logger, now }: Pick<AppDeps, 'db' | 'logger' | 'now'>) {
  const loginLimiter = createLoginLimiter();
  return new Hono<AppEnv>()
    .post(
      '/auth/login',
      bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: 'payload_too_large' }, 413) }),
      async (c) => {
        const body = loginRequestSchema.safeParse(await c.req.json().catch(() => null));
        if (!body.success) return c.json({ error: 'invalid_request' }, 400);
        const { username, password } = body.data;
        const key = normalizeName(username);
        const t = now();
        if (loginLimiter.blocked(key, t)) {
          logger.warn({ username: key }, 'login rate limited');
          return c.json({ error: 'rate_limited' }, 429);
        }
        // Counted before the slow verify so parallel guesses can't slip past the limit; cleared on success.
        loginLimiter.fail(key, t);
        const user = db
          .prepare('SELECT id, username, password_hash, disabled_at FROM users WHERE username_norm = ?')
          .get(key) as UserRow | undefined;
        // Unknown users still cost one scrypt, so response time doesn't reveal which usernames exist.
        const ok = user ? await verifyPassword(password, user.password_hash) : (await hashPassword(password), false);
        if (!user || !ok || user.disabled_at !== null) {
          logger.warn({ username: key }, 'login failed');
          return c.json({ error: 'invalid_credentials' }, 401);
        }
        loginLimiter.reset(key);
        const { token, context } = createSession(db, { userId: user.id, kind: 'browser', name: null, scopes: [], now: t });
        setSessionCookie(c, token);
        return c.json({ user: { id: user.id, username: user.username }, householdId: context.householdIds[0] ?? null });
      },
    )
    .post('/auth/logout', requireAuth('browser'), (c) => {
      revokeSession(db, c.get('auth').sessionId, now());
      clearSessionCookie(c);
      return c.body(null, 204);
    })
    .get('/me', requireAuth('any'), (c) => {
      const { userId, username } = c.get('auth');
      const households = db
        .prepare('SELECT household_id AS id, role FROM household_members WHERE user_id = ? ORDER BY household_id')
        .all(userId);
      return c.json({ user: { id: userId, username }, households });
    });
}
