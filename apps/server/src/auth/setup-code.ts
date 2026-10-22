import { randomInt, timingSafeEqual } from 'node:crypto';

// no 0/O and no 1/I/L: read off a terminal, typed on a phone
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** 8 characters, about 40 bits, shown as XXXX-XXXX. */
export function makeSetupCode(): string {
  const chars = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

const bare = (code: string): Buffer => Buffer.from(code.toUpperCase().replace(/[\s-]/g, ''));

/** Ignores case, spaces and dashes; constant time for codes of the right length. */
export function sameSetupCode(given: string, code: string): boolean {
  const a = bare(given);
  const b = bare(code);
  return a.length === b.length && timingSafeEqual(a, b);
}
