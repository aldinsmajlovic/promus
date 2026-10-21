import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.ts';
import type { AppDeps } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { openDatabase, migrate, MIGRATIONS_DIR } from '../src/db.ts';
import { createLogger } from '../src/log.ts';

export function makeTestApp(overrides: Partial<AppDeps> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'promus-test-'));
  const webRoot = join(dir, 'web');
  mkdirSync(webRoot);
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>Promus</title>');
  const config = loadConfig({ DATA_DIR: dir, LOG_LEVEL: 'error' });
  const db = openDatabase(config.dbPath);
  migrate(db, MIGRATIONS_DIR);
  let now = 1_700_000_000_000;
  const app = createApp({
    db,
    config,
    logger: createLogger('silent'),
    now: () => now,
    webRoot,
    ...overrides,
  });
  return { app, db, webRoot, setNow: (ms: number) => { now = ms; } };
}
