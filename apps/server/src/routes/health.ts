import { Hono } from 'hono';
import pkg from '../../../../package.json' with { type: 'json' };
import type { AppDeps } from '../app.ts';

export function healthRoutes({ db }: Pick<AppDeps, 'db'>) {
  return new Hono().get('/health', (c) => {
    db.prepare('SELECT 1').get();
    return c.json({ status: 'ok', version: pkg.version });
  });
}
