import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// a new database per run: the server creates the dir and global-setup, which reads it from here,
// removes it. Only a name: a load that runs nothing (a worker, --list) leaves nothing behind
const dataDir = join(tmpdir(), `promus-e2e-${randomUUID()}`);

export default defineConfig({
  globalSetup: './global-setup.ts',
  // the tests share two users
  workers: 1,
  timeout: 90_000,
  projects: [
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
        channel: 'chrome',
        // the UI language follows the browser's
        locale: 'sv-SE',
        // `localhost` is a secure context, so Chrome keeps the Secure `__Host-` session cookie over http
        baseURL: 'http://localhost:8181',
      },
    },
  ],
  webServer: {
    command: 'node apps/server/src/main.ts',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: 'http://localhost:8181/api/health',
    env: { PORT: '8181', HOST: '127.0.0.1', DATA_DIR: dataDir, LOG_LEVEL: 'warn' },
  },
});
