import type { Page } from '@playwright/test';
import { expect, login, test } from './fixtures.ts';

/** The share sheet of the current list, from the list menu: its link. */
async function openShare(page: Page, list: string): Promise<string> {
  await page.locator('app-list-menu .trigger').click();
  await page.getByRole('menuitem', { name: `Dela ${list}` }).click();
  return (await page.locator('app-share-sheet .url').textContent())!.trim();
}

const databases = (page: Page) => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));

test('a friend opens a shared list, adds to it, and the link ends', async ({ page, device }) => {
  await login(page, 'e2e-a');
  // a list of its own, so the other tests' items stay off it
  await page.locator('app-list-menu .trigger').click();
  await page.getByRole('menuitem', { name: 'Ny lista' }).click();
  await page.getByPlaceholder('Namnge den nya listan').fill('Tacokväll');
  await page.getByPlaceholder('Namnge den nya listan').press('Enter');
  await expect(page.locator('app-list-menu .trigger')).toHaveText(/Tacokväll/);

  const link = await openShare(page, 'Tacokväll');
  expect(link).toMatch(/^http:\/\/localhost:8181\/share#[\w-]{43}$/);
  await expect(page.getByText('Länken skapad')).toBeVisible();
  await page.keyboard.press('Escape');

  const friend = await device();
  await friend.goto(link);
  await expect(friend.getByRole('heading', { name: 'e2e-a delade Tacokväll' })).toBeVisible();
  await friend.getByLabel('Ditt namn').fill('Jonas');
  await friend.getByRole('button', { name: 'Öppna listan' }).click();
  await expect(friend).toHaveURL(/\/s\/[\w-]+$/);
  const shareId = new URL(friend.url()).pathname.split('/')[2];
  expect(await databases(friend)).toContain(`promus-guest-${shareId}`);

  await friend.getByRole('link', { name: 'Lägg till eller hitta' }).click();
  await friend.getByPlaceholder('Lägg till eller hitta').fill('Chorizo');
  await friend.getByPlaceholder('Lägg till eller hitta').press('Enter');
  await expect(friend.getByText('Chorizo tillagd')).toBeVisible();
  await friend.getByRole('button', { name: 'Stäng' }).click({ timeout: 2_000 });

  // the guest pushes 2 s after the add, and the household's page pulls every 15 s while on screen
  const row = page.getByRole('checkbox', { name: 'Chorizo' });
  await expect(row.locator('app-face.guest')).toHaveText('J', { timeout: 20_000 });
  await expect(row).toHaveAccessibleDescription('Tillagd av Jonas');

  // one live link per list: the menu opens the same one
  expect(await openShare(page, 'Tacokväll')).toBe(link);
  await page.getByRole('button', { name: 'Avsluta länken' }).click();
  await expect(page.getByText('Länken avslutad')).toBeVisible();

  // coming back to the app syncs, instead of waiting for the 15 s timer
  await friend.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(friend.getByRole('heading', { name: 'Länken har slutat gälla' })).toBeVisible({ timeout: 20_000 });
  await expect(friend.getByText('Be e2e-a om en ny.')).toBeVisible();
  await expect(friend.getByText('Chorizo')).toHaveCount(0);
  await expect.poll(() => databases(friend)).not.toContain(`promus-guest-${shareId}`);
});
