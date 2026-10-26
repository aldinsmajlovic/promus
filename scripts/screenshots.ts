import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { chromium, devices, type Page } from '@playwright/test';
import { DEFAULT_WEB_ROOT, createApp } from '../apps/server/src/app.ts';
import { loadConfig } from '../apps/server/src/config.ts';
import { MIGRATIONS_DIR, migrate, openDatabase } from '../apps/server/src/db.ts';
import { createLogger } from '../apps/server/src/log.ts';
import { createUser } from '../apps/server/src/users.ts';

// The README screenshots, light and dark: a fresh build against a throwaway database, filled
// through the UI with made-up items. A directory as the first argument takes them instead.
const OUT = process.argv[2] ?? 'docs/images';
const ITEMS: [name: string, note?: string][] = [
  ['Bananas'],
  ['Bread'],
  ['Coffee', 'dark roast'],
  ['Eggs', '12'],
  ['Milk', 'lactose free'],
  ['Tomatoes'],
  ['Butter'],
  ['Yogurt'],
];
const CHECKED = ['Butter', 'Yogurt'];

async function fill(page: Page, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill('demo');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('link', { name: 'Add or find' }).click();
  const field = page.getByPlaceholder('Add or find');
  for (const [name] of ITEMS) {
    await field.fill(name);
    await field.press('Enter');
    await page.getByText(`${name} added`).waitFor();
  }
  await page.getByRole('button', { name: 'Close' }).click();

  for (const [name, note] of ITEMS) {
    if (!note) continue;
    await page.getByRole('checkbox', { name }).click({ button: 'right' });
    await page.getByLabel('Note').fill(note);
    await page.getByLabel('Note').press('Enter');
  }
  for (const name of CHECKED) await page.getByRole('checkbox', { name }).tap();

  // nothing transient in the picture: no snackbar, no sync badge
  await page.waitForFunction(() => !document.querySelector('mat-snack-bar-container'), undefined, {
    timeout: 15_000,
  });
  await page.getByRole('link', { name: 'Settings for demo', exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // the last click leaves a hover state on whatever moved under the pointer
  await page.mouse.move(0, 0);
}

execFileSync('npm', ['run', 'build', '-w', 'apps/web'], { stdio: 'inherit' });

const dataDir = mkdtempSync(join(tmpdir(), 'promus-screenshots-'));
const config = loadConfig({ DATA_DIR: dataDir, LOG_LEVEL: 'warn' });
const db = openDatabase(config.dbPath);
migrate(db, MIGRATIONS_DIR);
const password = randomBytes(18).toString('base64url');
await createUser(db, { username: 'demo', password, locale: 'en', now: Date.now() });
const app = createApp({
  db,
  config,
  logger: createLogger(config.logLevel),
  now: Date.now,
  webRoot: fileURLToPath(DEFAULT_WEB_ROOT),
});
// any free port: only main.ts reads config.port
const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
await once(server, 'listening');
const { port } = server.address() as AddressInfo;

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({
    ...devices['Pixel 7'],
    deviceScaleFactor: 2,
    // cropped to the list: tall enough for it, short enough to keep Add or find close
    viewport: { width: 412, height: 640 },
    locale: 'en-US',
    // `localhost` is a secure context, so Chrome keeps the Secure `__Host-` session cookie over http
    baseURL: `http://localhost:${port}`,
  });
  await fill(page, password);
  mkdirSync(OUT, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: join(OUT, `list-${scheme}.png`), animations: 'disabled' });
  }
} finally {
  await browser.close();
  server.close();
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
}
