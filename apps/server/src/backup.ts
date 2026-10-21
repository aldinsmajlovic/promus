import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export function backup(db: DatabaseSync, backupDir: string, now: number, keep = 14): string {
  mkdirSync(backupDir, { recursive: true });
  const date = new Date(now).toISOString().slice(0, 10);
  const tmp = join(backupDir, `.promus-${date}.db.tmp`);
  const target = join(backupDir, `promus-${date}.db`);
  rmSync(tmp, { force: true });
  db.prepare('VACUUM INTO ?').run(tmp);
  renameSync(tmp, target);
  const old = readdirSync(backupDir).filter((n) => /^promus-.*\.db$/.test(n)).sort().reverse().slice(keep);
  for (const name of old) rmSync(join(backupDir, name));
  return target;
}
