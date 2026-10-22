import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
// beside the suite's own server on 8181
const BASE = 'http://localhost:8182';

/** A server of its own on an empty database, as a new install starts: with the setup code in its log. */
async function freshServer(): Promise<{ code: string; stop: () => void }> {
  const dataDir = join(tmpdir(), `promus-e2e-setup-${randomUUID()}`);
  const server: ChildProcessWithoutNullStreams = spawn(process.execPath, ['apps/server/src/main.ts'], {
    cwd: root,
    env: { ...process.env, PORT: '8182', HOST: '127.0.0.1', DATA_DIR: dataDir, LOG_LEVEL: 'warn' },
  });
  const stop = () => {
    server.kill();
    rmSync(dataDir, { recursive: true, force: true });
  };
  const code = await new Promise<string>((resolve, reject) => {
    let out = '';
    server.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      const found = /Setup code: (\w{4}-\w{4})/.exec(out)?.[1];
      if (found) resolve(found);
    });
    server.on('exit', (status) => reject(new Error(`server exited with ${status}: ${out}`)));
  });
  await expect.poll(() => fetch(`${BASE}/api/health`).then((r) => r.ok, () => false)).toBe(true);
  return { code, stop };
}

test('a new server: setup wizard, then an invite joins a second phone to the same list', async ({ page, device }) => {
  const { code, stop } = await freshServer();
  try {
    const password = randomBytes(12).toString('base64url');
    await page.goto(`${BASE}/login`);
    await expect(page).toHaveURL(`${BASE}/setup`);
    await page.getByText('Svenska').click();
    await page.getByRole('button', { name: 'Nästa' }).click();
    // as read off a terminal: lower case, no dash
    await page.getByLabel('Installationskod').fill(code.toLowerCase().replace('-', ''));
    await page.getByLabel('Användarnamn').fill('ägare');
    await page.getByLabel('Lösenord', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Skapa konto' }).click();
    await expect(page.getByRole('heading', { name: 'Få in den i mobilen' })).toBeVisible();
    await expect(page.getByRole('img', { name: BASE })).toHaveCount(0);
    await page.getByRole('button', { name: 'Klar' }).click();
    await expect(page.getByRole('link', { name: 'Lägg till' })).toBeVisible();

    await page.goto(`${BASE}/settings`);
    await page.getByRole('button', { name: 'Bjud in någon' }).click();
    const link = (await page.locator('app-invite-sheet .url').textContent())!.trim();
    expect(link).toMatch(new RegExp(`^${BASE}/join#[\\w-]{43}$`));

    const partner = await device();
    await partner.goto(link);
    await expect(partner.getByText('Du har bjudits in')).toBeVisible();
    await partner.getByLabel('Användarnamn').fill('partner');
    await partner.getByLabel('Lösenord', { exact: true }).fill(password);
    await partner.getByRole('button', { name: 'Gå med' }).click();
    await partner.getByRole('button', { name: 'Klar' }).click();
    await partner.getByRole('link', { name: 'Lägg till' }).click();
    await partner.getByPlaceholder('Lägg till vara').fill('mjölk');
    await partner.getByPlaceholder('Lägg till vara').press('Enter');
    await expect(partner.getByText('mjölk tillagd')).toBeVisible();

    // the owner's list, opened again once the partner's change has gone out (2 s after it), has the item
    await expect(async () => {
      await page.goto(BASE);
      await expect(page.getByRole('checkbox', { name: 'mjölk' })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    // and the used link is spent
    const late = await device();
    await late.goto(link);
    await expect(late.getByText('Länken har gått ut eller redan använts')).toBeVisible();
  } finally {
    stop();
  }
});
