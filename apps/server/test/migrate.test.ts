import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, migrate, openDatabase, transaction } from '../src/db.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'promus-mig-'));
const version = (db: DatabaseSync) =>
  (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
const tables = (db: DatabaseSync) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);

describe('migrate', () => {
  it('applies all migrations to a fresh database', () => {
    const db = openDatabase(join(tmp(), 'a.db'));
    expect(migrate(db, MIGRATIONS_DIR)).toBe(1);
    expect(version(db)).toBe(1);
    for (const t of ['users', 'households', 'household_members', 'sessions', 'events']) {
      expect(tables(db)).toContain(t);
    }
    expect((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode).toBe('wal');
    expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
  });

  it('is a no-op when up to date', () => {
    const db = openDatabase(join(tmp(), 'a.db'));
    migrate(db, MIGRATIONS_DIR);
    expect(migrate(db, MIGRATIONS_DIR)).toBe(1);
  });

  it('upgrades an older database and keeps its data', () => {
    const dir = tmp();
    writeFileSync(join(dir, '0001_a.sql'), 'CREATE TABLE a (x INTEGER);');
    const db = openDatabase(join(tmp(), 'a.db'));
    migrate(db, dir);
    db.exec('INSERT INTO a VALUES (7)');
    writeFileSync(join(dir, '0002_b.sql'), 'CREATE TABLE b (y INTEGER);');
    expect(migrate(db, dir)).toBe(2);
    expect(db.prepare('SELECT x FROM a').get()).toEqual({ x: 7 });
  });

  it('rolls back a failing migration', () => {
    const dir = tmp();
    writeFileSync(join(dir, '0001_a.sql'), 'CREATE TABLE a (x INTEGER);');
    writeFileSync(join(dir, '0002_bad.sql'), 'CREATE TABLE partial (y INTEGER); NOT VALID SQL;');
    const db = openDatabase(join(tmp(), 'a.db'));
    expect(() => migrate(db, dir)).toThrow();
    expect(version(db)).toBe(1);
    expect(tables(db)).not.toContain('partial');
  });
});

describe('transaction', () => {
  it('returns the callback result and refuses async callbacks at the type level', () => {
    const db = openDatabase(join(tmp(), 'a.db'));
    db.exec('CREATE TABLE t (x INTEGER)');
    expect(transaction(db, () => db.prepare('INSERT INTO t VALUES (1)').run().changes)).toBe(1);
    // @ts-expect-error an async callback would commit before its awaited work runs
    void (() => transaction(db, async () => {}));
  });
});
