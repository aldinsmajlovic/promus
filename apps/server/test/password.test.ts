import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/password.ts';

describe('password', { timeout: 20_000 }, () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const stored = await hashPassword('correct horse');
    expect(await verifyPassword('correct horse', stored)).toBe(true);
    expect(await verifyPassword('correct horsf', stored)).toBe(false);
    // "ä" typed as one code point verifies against "ä" typed as a + combining diaeresis
    expect(await verifyPassword('gr\u00e4dde12', await hashPassword('gra\u0308dde12'))).toBe(true);
  });

  it('uses the scrypt$ format', async () => {
    const a = await hashPassword('correct horse');
    expect(a).toMatch(/^scrypt\$17\$8\$1\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{86}==$/);
    expect(await hashPassword('correct horse')).not.toBe(a);
    for (const broken of [a.replace(/[^$]+$/, ''), a.replace(/[^$]+$/, 'AAAA'), 'plain']) {
      await expect(verifyPassword('correct horse', broken)).rejects.toThrow();
    }
  });
});
