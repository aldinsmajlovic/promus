import type { Page } from '@playwright/test';
import { expect, login, test } from './fixtures.ts';

/** Adds through the add view, as typed, and goes back to the list. */
async function add(page: Page, name: string): Promise<void> {
  await page.getByRole('link', { name: 'Lägg till' }).click();
  const field = page.getByPlaceholder('Lägg till vara');
  await field.fill(name);
  await field.press('Enter');
  await expect(page.getByText(`${name} tillagd`)).toBeVisible();
  // while the snackbar shows (5 s): it must leave Close uncovered
  await page.getByRole('button', { name: 'Stäng' }).click({ timeout: 2_000 });
}

// the sync indicator while changes wait, named for the count its badge shows
const unsynced = (page: Page) => page.getByRole('button', { name: /osynkade? ändring/ });

test('the secure session cookie works on localhost', async ({ page, context }) => {
  await login(page, 'e2e-a');
  const cookie = (await context.cookies()).find((c) => c.name === '__Host-session');
  expect(cookie).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Lax', path: '/' });
  expect((await page.request.get('/api/me')).status()).toBe(200);
});

test('add, check off and undo', async ({ page }) => {
  await login(page, 'e2e-a');
  await add(page, 'mjölk');
  await page.getByRole('checkbox', { name: 'mjölk' }).click();
  await page.getByRole('button', { name: 'Klart (1)' }).click();
  await expect(page.getByRole('checkbox', { name: 'mjölk', checked: true })).toBeVisible();

  // the add's snackbar gives way to the check's, so its Undo is the only one left
  await expect(page.getByText('mjölk avbockad')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ångra' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Ångra' }).click();
  await expect(page.getByRole('checkbox', { name: 'mjölk', checked: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Klart/ })).toBeHidden();
  // 5 s, plus the animations
  await expect(page.getByText('mjölk tillbaka på listan')).toBeHidden({ timeout: 8_000 });
});

test('works offline and syncs later', async ({ page, context, device }) => {
  await login(page, 'e2e-a');
  await page.evaluate(() => navigator.serviceWorker.ready);
  // a navigation through the worker waits for it to have cached the whole app
  await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await context.setOffline(true);
  expect((await page.reload())?.fromServiceWorker()).toBe(true);
  await expect(page.getByRole('link', { name: 'Lägg till' })).toBeVisible();
  await add(page, 'Bröd');
  await expect(page.getByRole('checkbox', { name: 'Bröd' })).toBeVisible();
  // the count is of events: a new item is item.created and entry.added
  const waiting = page.getByRole('button', { name: 'Offline, 2 osynkade ändringar' });
  await expect(waiting).toHaveText('2');
  // 5 s, plus the animations, also after leaving the add view
  await expect(page.getByText('Bröd tillagd')).toBeHidden({ timeout: 8_000 });

  await context.setOffline(false);
  // `online` is a sync trigger, but Playwright fires none in a page loaded offline; the 60 s timer would catch it too
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(unsynced(page)).toBeHidden({ timeout: 70_000 });

  const other = await device();
  await login(other, 'e2e-a');
  await expect(other.getByRole('checkbox', { name: 'Bröd' })).toBeVisible();
});

test('two devices adding the same item offline end up with one', async ({ page, context, device }) => {
  const other = await device();
  await login(page, 'e2e-b');
  await login(other, 'e2e-b');
  await context.setOffline(true);
  await other.context().setOffline(true);
  // each adds one more item, which shows when it has the other's changes
  await add(page, 'Ägg');
  await add(page, 'Ost');
  await add(other, 'Ägg');
  await add(other, 'Smör');

  await context.setOffline(false);
  await expect(unsynced(page)).toBeHidden({ timeout: 70_000 });
  // pushes its own and pulls the first's
  await other.context().setOffline(false);
  await expect(other.getByRole('checkbox', { name: 'Ost' })).toBeVisible({ timeout: 70_000 });
  await expect(unsynced(other)).toBeHidden();
  // opening the app again syncs
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Smör' })).toBeVisible();

  for (const p of [page, other]) await expect(p.getByRole('checkbox', { name: 'Ägg' })).toHaveCount(1);
});

test('two tabs stay in step', async ({ page, context }) => {
  await login(page, 'e2e-b');
  const tab = await context.newPage();
  await tab.goto('/');
  await expect(tab.getByRole('link', { name: 'Lägg till' })).toBeVisible();

  await add(page, 'Kaffe');
  await expect(tab.getByRole('checkbox', { name: 'Kaffe' })).toBeVisible({ timeout: 3_000 });
  await tab.getByRole('checkbox', { name: 'Kaffe' }).click();
  await expect(page.getByRole('checkbox', { name: 'Kaffe', checked: false })).toBeHidden({ timeout: 3_000 });
  // the first tab is behind the second: its snackbar still goes
  await expect(page.getByText('Kaffe tillagd')).toBeHidden({ timeout: 8_000 });
});
