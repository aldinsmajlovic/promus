import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import type { AuthContext } from './auth/sessions.ts';
import type { Config } from './config.ts';
import type { Logger } from './log.ts';
import { csrf } from './middleware/csrf.ts';
import { security } from './middleware/security.ts';
import { authRoutes } from './routes/auth.ts';
import { healthRoutes } from './routes/health.ts';
import { serveWeb } from './static.ts';

export type AppDeps = {
  db: DatabaseSync;
  config: Config;
  logger: Logger;
  now: () => number;
  webRoot: string;
};

export type AppEnv = { Variables: { deps: AppDeps; auth: AuthContext } };

export const DEFAULT_WEB_ROOT = new URL('../../web/dist/browser/', import.meta.url);

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use(security);
  app.use(async (c, next) => {
    const start = deps.now();
    await next();
    deps.logger.info(
      { method: c.req.method, path: c.req.path, status: c.res.status, ms: deps.now() - start },
      'request',
    );
  });
  app.use(async (c, next) => {
    c.set('deps', deps);
    await next();
  });
  app.onError((err, c) => {
    deps.logger.error({ err }, 'unhandled error');
    return c.json({ error: 'internal' }, 500);
  });
  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.use('/api/*', csrf());
  app.route('/api', healthRoutes(deps));
  app.route('/api', authRoutes(deps));
  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));
  app.get('*', serveWeb(deps.webRoot));
  return app;
}
