import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures.ts';

// WebKit, like Safari, drops a Secure cookie on http://localhost, so it can't stay signed in here: the
// signed-in flows run in Chrome. What WebKit can check is that the app says why, instead of failing silently.
test('signing in over plain HTTP says the browser needs HTTPS', async ({ page }) => {
  const passwords = JSON.parse(readFileSync(new URL('.auth.json', import.meta.url), 'utf8')) as Record<string, string>;
  await page.goto('/login');
  await page.getByLabel('Användarnamn').fill('e2e-a');
  await page.getByLabel('Lösenord').fill(passwords['e2e-a']!);
  await page.getByRole('button', { name: 'Logga in' }).click();
  await expect(page.getByRole('heading', { name: 'Promus behöver HTTPS' })).toBeVisible();
  await expect(page.getByText('webbläsaren sparade inte sessionen')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Så sätter du upp HTTPS' })).toHaveAttribute(
    'href',
    /\/docs\/self-hosting\.md#put-https-in-front$/,
  );
});
