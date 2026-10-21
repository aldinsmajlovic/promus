import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);

export function openDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;
  `);
  return db;
}

export function migrate(db: DatabaseSync, dir: URL | string): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  let version = row.user_version;
  const files = readdirSync(dir)
    .flatMap((name) => {
      const m = /^(\d+)_.*\.sql$/.exec(name);
      return m ? [{ name, n: Number(m[1]) }] : [];
    })
    .sort((a, b) => a.n - b.n);
  for (const { name, n } of files) {
    if (n <= version) continue;
    const sql = readFileSync(join(dir instanceof URL ? fileURLToPath(dir) : dir, name), 'utf8');
    transaction(db, () => {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${n}`);
    });
    version = n;
  }
  return version;
}

/** Synchronous only: an async callback would COMMIT before its awaited work runs, so it doesn't compile. */
export function transaction<T>(db: DatabaseSync, fn: () => T extends PromiseLike<unknown> ? never : T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
