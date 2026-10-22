import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Runs after the server has started: it reads the build from disk per request, and the WAL database takes a second writer. */
export default function globalSetup(): () => void {
  const dataDir = process.env.PROMUS_E2E_DATA_DIR;
  if (!dataDir) throw new Error('PROMUS_E2E_DATA_DIR is not set; run through playwright.config.ts');
  execFileSync('npm', ['run', 'build', '-w', 'apps/web'], { cwd: root });
  const passwords: Record<string, string> = {};
  for (const username of ['e2e-a', 'e2e-b']) {
    const password = randomBytes(18).toString('base64url');
    execFileSync(process.execPath, ['apps/server/src/cli.ts', 'user:create', username, '--locale', 'sv'], {
      cwd: root,
      env: { ...process.env, DATA_DIR: dataDir },
      input: `${password}\n`,
    });
    passwords[username] = password;
  }
  writeFileSync(new URL('.auth.json', import.meta.url), JSON.stringify(passwords));
  // the server is killed after this, without closing the database
  return () => rmSync(dataDir, { recursive: true, force: true });
}
