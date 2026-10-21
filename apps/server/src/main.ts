import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { DEFAULT_WEB_ROOT, createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { MIGRATIONS_DIR, migrate, openDatabase } from './db.ts';
import { createLogger } from './log.ts';

const config = loadConfig(process.env);
const logger = createLogger(config.logLevel);
const db = openDatabase(config.dbPath);
migrate(db, MIGRATIONS_DIR);

const app = createApp({
  db,
  config,
  logger,
  now: Date.now,
  webRoot: fileURLToPath(DEFAULT_WEB_ROOT),
});
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  logger.info({ port: info.port, host: config.host }, 'listening');
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
