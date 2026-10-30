import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { createApp } from '../src/app.ts';
import type { AppDeps, AppEnv } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { openDatabase, migrate, MIGRATIONS_DIR } from '../src/db.ts';
import { createLogger } from '../src/log.ts';

export const T0 = 1_700_000_000_000;
export const DAY = 86_400_000;
export const SAME_ORIGIN = { Host: 'promus.test', 'Sec-Fetch-Site': 'same-origin' };

export function makeTestApp(overrides: Partial<AppDeps> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'promus-test-'));
  const webRoot = join(dir, 'web');
  mkdirSync(webRoot);
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>Promus</title>');
  const config = loadConfig({ DATA_DIR: dir, LOG_LEVEL: 'error' });
  const db = openDatabase(config.dbPath);
  migrate(db, MIGRATIONS_DIR);
  let now = T0;
  const app = createApp({
    db,
    config,
    logger: createLogger('silent'),
    now: () => now,
    webRoot,
    releases: async () => [],
    ...overrides,
  });
  return { app, db, config, webRoot, now: () => now, setNow: (ms: number) => { now = ms; } };
}

export function login(
  app: Hono<AppEnv>,
  username: string,
  password: string,
  headers: Record<string, string> = SAME_ORIGIN,
) {
  return app.request('/api/auth/login', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

/** The `name=value` part of the session Set-Cookie, ready for a Cookie header. */
export const cookieOf = (res: Response): string =>
  /^__Host-session=[^;]*/.exec(res.headers.get('set-cookie') ?? '')?.[0] ?? '';
