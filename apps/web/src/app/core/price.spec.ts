import { describe, expect, it } from 'vitest';
import { formatPrice, parsePrice, priceText } from './price';
import { ValidationError } from './store';

describe('parsePrice', () => {
  it('reads kronor with a comma or a point, spaces and "kr", into öre', () => {
    const typed: [string, number][] = [
      ['14,90', 1490],
      ['14.9', 1490],
      ['14', 1400],
      ['14 kr', 1400],
      ['14KR', 1400],
      ['1 299,50 kr', 129950],
      ['0,1', 10],
      ['0', 0],
      ['99999,99', 9_999_999],
    ];
    for (const [text, ore] of typed) expect(parsePrice(text), text).toBe(ore);
  });

  it('reads nothing as no price', () => {
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('  ')).toBeNull();
  });

  it('refuses what is not a price', () => {
    for (const text of ['14,999', '-1', 'abc', '1e3', '100000', '14,', ',5']) {
      expect(() => parsePrice(text), text).toThrow(ValidationError);
    }
  });
});

describe('formatPrice', () => {
  it('shows kronor in the language', () => {
    // Intl puts no-break spaces in: compare with plain ones
    const plain = (s: string) => s.replace(/\s/g, ' ');
    expect(plain(formatPrice(4470, 'sv'))).toBe('44,70 kr');
    expect(plain(formatPrice(4470, 'en'))).toBe('SEK 44.70');
    expect(plain(formatPrice(4470, 'sv', { whole: true }))).toBe('45 kr');
    expect(plain(formatPrice(4440, 'en', { whole: true }))).toBe('SEK 44');
  });
});

describe('priceText', () => {
  it('is what the field starts with, and reads back as the same price', () => {
    expect(priceText(null, 'sv')).toBe('');
    expect(priceText(1490, 'sv')).toBe('14,90');
    expect(priceText(129950, 'en')).toBe('1299.50');
    for (const lang of ['sv', 'en']) expect(parsePrice(priceText(129950, lang))).toBe(129950);
  });
});
