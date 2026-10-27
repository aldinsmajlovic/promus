import { LIMITS } from '@promus/shared';
import { ValidationError } from './store';

const KRONOR = /^(\d+)(?:[.,](\d{1,2}))?$/;

/** Öre from what was typed: "14,90", "14.9" or "1 299 kr". Empty is no price. Throws ValidationError. */
export function parsePrice(text: string): number | null {
  const bare = text.replace(/\s/g, '').replace(/kr$/i, '');
  if (bare === '') return null;
  const m = KRONOR.exec(bare);
  // from the digits, never through a float
  const ore = m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')) : NaN;
  if (!(ore <= LIMITS.priceMax)) throw new ValidationError('price_invalid');
  return ore;
}

/** "44,70 kr", or "SEK 44.70" in English. */
export const formatPrice = (ore: number, lang: string): string =>
  new Intl.NumberFormat(lang, { style: 'currency', currency: 'SEK' }).format(ore / 100);

/** What a Price field starts with: "14,90", without "kr" or grouping, so `parsePrice` reads it back. */
export const priceText = (ore: number | null, lang: string): string =>
  ore === null ? '' : new Intl.NumberFormat(lang, { minimumFractionDigits: 2, useGrouping: false }).format(ore / 100);
