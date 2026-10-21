import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import type { Config } from './config.ts';
import type { Logger } from './log.ts';
import { security } from './middleware/security.ts';
import { healthRoutes } from './routes/health.ts';
import { serveWeb } from './static.ts';

export type AppDeps = {
  db: DatabaseSync;
  config: Config;
  logger: Logger;
  now: () => number;
  webRoot: string;
};

export const DEFAULT_WEB_ROOT = new URL('../../web/dist/browser/', import.meta.url);

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.use(security);
  app.use(async (c, next) => {
    const start = deps.now();
    await next();
    deps.logger.info(
      { method: c.req.method, path: c.req.path, status: c.res.status, ms: deps.now() - start },
      'request',
    );
  });
  app.onError((err, c) => {
    deps.logger.error({ err }, 'unhandled error');
    return c.json({ error: 'internal' }, 500);
  });
  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.route('/api', healthRoutes(deps));
  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));
  app.get('*', serveWeb(deps.webRoot));
  return app;
}
