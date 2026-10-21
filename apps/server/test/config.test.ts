import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

describe('loadConfig', () => {
  it('uses the spec defaults', () => {
    const c = loadConfig({});
    expect(c.port).toBe(8080);
    expect(c.host).toBe('127.0.0.1');
    expect(c.dataDir).toBe('./data');
    expect(c.logLevel).toBe('info');
    expect(c.dbPath).toMatch(/data[\\/]promus\.db$/);
    expect(c.backupDir).toMatch(/data[\\/]backups$/);
  });

  it('rejects a non-numeric PORT with a message naming PORT', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
  });
});
