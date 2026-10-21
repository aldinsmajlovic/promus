import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import { cleanName } from '@promus/shared';
import { loadConfig } from './config.ts';
import { MIGRATIONS_DIR, migrate, openDatabase } from './db.ts';
import { createUser, setPassword } from './users.ts';

const USAGE = 'Usage: cli.ts user:create <username> [--locale sv|en] | user:password <username>';

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    for await (const line of createInterface({ input: process.stdin })) return line;
    throw new Error('No password on stdin');
  }
  process.stderr.write('Password: ');
  const muted = new Writable({ write: (_chunk, _encoding, done) => done() });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  rl.on('SIGINT', () => process.exit(130));
  const password = await rl.question('');
  rl.close();
  process.stderr.write('\n');
  return password;
}

async function main(): Promise<string> {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { locale: { type: 'string' } } });
  const [command, username, ...extra] = positionals;
  if (!username || extra.length > 0) throw new Error(USAGE);
  const locale = values.locale ?? 'sv';
  if (locale !== 'sv' && locale !== 'en') throw new Error('--locale must be sv or en');
  if (command !== 'user:create' && command !== 'user:password') throw new Error(USAGE);

  const db = openDatabase(loadConfig(process.env).dbPath);
  try {
    migrate(db, MIGRATIONS_DIR);
    const password = await readPassword();
    if (command === 'user:create') {
      await createUser(db, { username, password, locale, now: Date.now() });
      return `Created user ${cleanName(username)}`;
    }
    await setPassword(db, username, password, Date.now());
    return `Changed password for ${cleanName(username)}`;
  } finally {
    db.close();
  }
}

main().then(
  (message) => process.stdout.write(`${message}\n`),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);
