import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../app.ts';
import { requireAuth } from '../middleware/auth.ts';

export function releaseRoutes({ releases }: Pick<AppDeps, 'releases'>) {
  return new Hono<AppEnv>().get('/releases', requireAuth('browser'), async (c) => c.json({ releases: await releases() }));
}
