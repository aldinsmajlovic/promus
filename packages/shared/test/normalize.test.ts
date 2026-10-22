import { describe, it, expect } from 'vitest';
import { cleanName, normalizeName } from '../src/normalize.ts';

describe('cleanName', () => {
  it('trims, collapses whitespace and composes to NFC', () => {
    expect(cleanName('  Visp   grädde \n')).toBe('Visp grädde');
    expect(cleanName('Mjölk')).toBe('Mjölk');
    expect(cleanName('Mjo\u0308lk')).toBe('Mjölk');
  });
  it('removes zero-width characters', () => {
    expect(cleanName('Mj\u200Bölk\uFEFF')).toBe('Mjölk');
    expect(cleanName('\u200B \u200D\u2060')).toBe('');
  });
  it('is idempotent, even with a zero-width character before a combining mark', () => {
    const tricky = ' Cafe\u200B\u0301 ';
    expect(cleanName(tricky)).toBe('Caf\u00E9');
    expect(cleanName(cleanName(tricky))).toBe(cleanName(tricky));
  });
  it('keeps emoji and case', () => {
    expect(cleanName('Kaffe ☕')).toBe('Kaffe ☕');
  });
});

describe('normalizeName', () => {
  it('lowercases and keeps å ä ö distinct from a o', () => {
    expect(normalizeName('  ÄGG ')).toBe('ägg');
    expect(normalizeName('Mjölk')).toBe(normalizeName(' mjölk'));
    expect(normalizeName('Mjölk')).not.toBe(normalizeName('Mjolk'));
  });
});
