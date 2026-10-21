import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { backup } from '../src/backup.ts';
import { openDatabase } from '../src/db.ts';
import { createUser } from '../src/users.ts';
import { DAY, T0, makeTestApp } from './helpers.ts';

const freshDir = () => join(mkdtempSync(join(tmpdir(), 'promus-backup-')), 'backups');

describe('backup', { timeout: 20_000 }, () => {
  it('writes a backup that opens and contains the events', async () => {
    const { db } = makeTestApp();
    await createUser(db, { username: 'aldin', password: 'correct horse', locale: 'en', now: T0 });
    const dir = freshDir();
    const path = backup(db, dir, T0);

    expect(path).toBe(join(dir, 'promus-2023-11-14.db'));
    expect(readdirSync(dir)).toEqual(['promus-2023-11-14.db']);
    const copy = openDatabase(path);
    expect((copy.prepare('SELECT count(*) AS n FROM events').get() as { n: number }).n).toBe(1);
    copy.close();
  });

  it("replaces the same day's backup", async () => {
    const { db } = makeTestApp();
    const dir = freshDir();
    backup(db, dir, T0);
    await createUser(db, { username: 'aldin', password: 'correct horse', locale: 'en', now: T0 });
    const path = backup(db, dir, T0 + 1000);

    expect(readdirSync(dir)).toEqual(['promus-2023-11-14.db']);
    const copy = openDatabase(path);
    expect((copy.prepare('SELECT count(*) AS n FROM events').get() as { n: number }).n).toBe(1);
    copy.close();
  });

  it('removes a stale tmp file from a crashed run', () => {
    const { db } = makeTestApp();
    const dir = freshDir();
    backup(db, dir, T0);
    writeFileSync(join(dir, '.promus-2023-11-15.db.tmp'), 'junk');
    backup(db, dir, T0 + DAY);
    expect(existsSync(join(dir, '.promus-2023-11-15.db.tmp'))).toBe(false);
    expect(readdirSync(dir).sort()).toEqual(['promus-2023-11-14.db', 'promus-2023-11-15.db']);
  });

  it('keeps only the 14 newest backups', () => {
    const { db } = makeTestApp();
    const dir = freshDir();
    for (let i = 0; i < 16; i++) backup(db, dir, T0 + i * DAY);
    writeFileSync(join(dir, 'notes.txt'), 'keep me');
    backup(db, dir, T0 + 15 * DAY);

    const files = readdirSync(dir).sort();
    expect(files).toHaveLength(15);
    expect(files).toContain('notes.txt');
    expect(files).not.toContain('promus-2023-11-14.db');
    expect(files).not.toContain('promus-2023-11-15.db');
    expect(files).toContain('promus-2023-11-16.db');
  });
});
