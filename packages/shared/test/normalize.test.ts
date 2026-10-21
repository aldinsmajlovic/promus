import { describe, it, expect } from 'vitest';
import { cleanName, normalizeName } from '../src/normalize.ts';

describe('cleanName', () => {
  it('trims, collapses whitespace and composes to NFC', () => {
    expect(cleanName('  Visp   grädde \n')).toBe('Visp grädde');
    expect(cleanName('Mjölk')).toBe('Mjölk');
    expect(cleanName('Mjölk')).toBe('Mjölk');
  });
  it('removes zero-width characters', () => {
    expect(cleanName('Mj​ölk﻿')).toBe('Mjölk');
    expect(cleanName('​ ‍⁠')).toBe('');
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
