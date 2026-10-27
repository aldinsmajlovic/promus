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

// The docs' screenshots, light and dark: a fresh build against a throwaway database, filled
// through the UI with made-up items and guests. A directory as the first argument takes them instead.
const OUT = process.argv[2] ?? 'docs/images';
// two without a price, so the total says so
const ITEMS: [name: string, set?: { note?: string; price?: string; quantity?: number }][] = [
  ['Bananas', { price: '24.90' }],
  ['Bread', { price: '32' }],
  ['Coffee', { note: 'dark roast', price: '54.90' }],
  ['Eggs', { note: '12', price: '39' }],
  ['Milk', { note: 'lactose free', price: '14.90', quantity: 3 }],
  ['Tomatoes'],
  ['Butter', { price: '62' }],
  ['Yogurt'],
];
const CHECKED = ['Butter', 'Yogurt'];
// a second list, which two guests join
const SHARED = 'Taco night';
const SHARED_ITEMS = ['Tortillas', 'Ground beef', 'Cheese'];

/** Each name through Add or find, then back to the list. */
async function add(page: Page, names: string[]): Promise<void> {
  await page.getByRole('link', { name: 'Add or find' }).click();
  const field = page.getByPlaceholder('Add or find');
  for (const name of names) {
    await field.fill(name);
    await field.press('Enter');
    await page.getByText(`${name} added`).waitFor();
  }
  await page.getByRole('button', { name: 'Close' }).click();
}

/** Nothing transient in the picture: no snackbar, no sync badge on the initial labelled `profile`. */
async function settle(page: Page, profile: string): Promise<void> {
  await page.waitForFunction(() => !document.querySelector('mat-snack-bar-container'), undefined, {
    timeout: 15_000,
  });
  await page.getByLabel(profile, { exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // the last click leaves a hover state on whatever moved under the pointer
  await page.mouse.move(0, 0);
  // checking items scrolls the page; the picture starts at the band
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function shoot(page: Page, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: join(OUT, `${name}-${scheme}.png`), animations: 'disabled' });
  }
}

async function fill(page: Page, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill('demo');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await add(page, ITEMS.map(([name]) => name));
  for (const [name, set] of ITEMS) {
    if (!set) continue;
    await page.getByRole('checkbox', { name }).click({ button: 'right' });
    if (set.note) await page.getByLabel('Note').fill(set.note);
    for (let q = 1; q < (set.quantity ?? 1); q++) await page.getByRole('button', { name: 'More', exact: true }).click();
    if (set.price) await page.getByLabel('Price').fill(set.price);
    await page.getByLabel('Price').press('Enter');
  }
  for (const name of CHECKED) await page.getByRole('checkbox', { name }).tap();
  await settle(page, 'Settings for demo');
}

/** A second list, shared: its share sheet stays open, and the link is returned. */
async function share(page: Page): Promise<string> {
  await page.locator('app-list-menu .trigger').click();
  await page.getByRole('menuitem', { name: 'New list' }).click();
  await page.getByPlaceholder('Name the new list').fill(SHARED);
  await page.getByPlaceholder('Name the new list').press('Enter');
  await add(page, SHARED_ITEMS);
  await page.locator('app-list-menu .trigger').click();
  await page.getByRole('menuitem', { name: `Share ${SHARED}` }).click();
  const link = (await page.locator('app-share-sheet .url').textContent())!.trim();
  await settle(page, 'Settings for demo');
  return link;
}

/** A friend's phone on the link, after adding `items`. */
async function joinAs(friend: Page, link: string, name: string, items: string[]): Promise<void> {
  await friend.goto(link);
  await friend.getByLabel('Your name').fill(name);
  await friend.getByRole('button', { name: 'Open list' }).click();
  await friend.waitForURL(/\/s\/[\w-]+$/);
  await add(friend, items);
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
  // each its own browser, as on separate phones
  const phone = () =>
    browser.newPage({
      ...devices['Pixel 7'],
      deviceScaleFactor: 2,
      // cropped to the list: tall enough for it, short enough to keep Add or find close
      viewport: { width: 412, height: 720 },
      locale: 'en-US',
      // `localhost` is a secure context, so Chrome keeps the Secure `__Host-` session cookie over http
      baseURL: `http://localhost:${port}`,
    });
  const page = await phone();
  // a phone's share sheet has Share beside Copy; Chrome on Linux has no Web Share
  await page.addInitScript(() => {
    navigator.share ??= () => Promise.resolve();
  });
  mkdirSync(OUT, { recursive: true });
  await fill(page, password);
  // prices and notes give most rows a second line: taller, so Done fits above Add or find
  await page.setViewportSize({ width: 412, height: 860 });
  await shoot(page, 'list');
  await page.setViewportSize({ width: 412, height: 720 });
  const link = await share(page);
  await shoot(page, 'share-sheet');

  await joinAs(await phone(), link, 'Sam', ['Limes', 'Cilantro']);
  const alex = await phone();
  await joinAs(alex, link, 'Alex', ['Sour cream']);
  // Sam's adds, with Sam's face: coming back to the app syncs, instead of waiting for the 15 s timer
  await alex.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await alex.getByRole('checkbox', { name: 'Limes' }).locator('app-face.guest').waitFor({ timeout: 20_000 });
  await settle(alex, 'Alex: your name and language');
  await shoot(alex, 'guest-list');
} finally {
  await browser.close();
  server.close();
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
}
