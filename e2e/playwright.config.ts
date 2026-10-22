import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// one database per run, shared by the server and global-setup. Workers load this file again and
// inherit the variable, so they agree on it. Not DATA_DIR itself: a shell's own must not be used.
process.env.PROMUS_E2E_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'promus-e2e-'));

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
    env: { PORT: '8181', HOST: '127.0.0.1', DATA_DIR: process.env.PROMUS_E2E_DATA_DIR, LOG_LEVEL: 'warn' },
  },
});
