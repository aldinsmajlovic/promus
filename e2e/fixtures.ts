import { readFileSync } from 'node:fs';
import { type BrowserContext, type Page, test as base, expect } from '@playwright/test';

export { expect };

export type User = 'e2e-a' | 'e2e-b';

// what a page may never do: violate the CSP or throw
function watch(context: BrowserContext, problems: string[]): void {
  context.on('console', (m) => {
    // Angular's ErrorHandler logs what nothing caught, its global listeners included, as `ERROR <error>`
    const uncaught = m.type() === 'error' && m.text().startsWith('ERROR');
    if (uncaught || m.text().includes('Content Security Policy')) problems.push(`console: ${m.text()}`);
  });
  // before Angular runs
  context.on('weberror', (e) => problems.push(`page error: ${e.error().stack ?? e.error().message}`));
}

export const test = base.extend<{ problems: string[]; device: () => Promise<Page> }>({
  problems: async ({}, use) => {
    const problems: string[] = [];
    await use(problems);
    expect(problems).toEqual([]);
  },
  // every page of the test's own context, the first tab and any other
  context: async ({ context, problems }, use) => {
    watch(context, problems);
    await use(context);
  },
  /** Another phone: a context of its own, so its own cookies and IndexedDB, with the project's settings. */
  device: async ({ browser, problems }, use, testInfo) => {
    const contexts: BrowserContext[] = [];
    await use(async () => {
      const context = await browser.newContext(testInfo.project.use);
      contexts.push(context);
      watch(context, problems);
      return context.newPage();
    });
    await Promise.all(contexts.map((c) => c.close()));
  },
});

/** Signs in through the form and waits for the list. */
export async function login(page: Page, user: User): Promise<void> {
  // read here, not on import: global-setup writes it after the test files are loaded
  const passwords = JSON.parse(readFileSync(new URL('.auth.json', import.meta.url), 'utf8')) as Record<User, string>;
  await page.goto('/login');
  await page.getByLabel('Användarnamn').fill(user);
  await page.getByLabel('Lösenord').fill(passwords[user]);
  await page.getByRole('button', { name: 'Logga in' }).click();
  await expect(page.getByRole('link', { name: 'Lägg till eller hitta' })).toBeVisible();
}
