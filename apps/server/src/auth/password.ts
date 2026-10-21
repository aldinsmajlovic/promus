import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export const MIN_PASSWORD_LENGTH = 8;

const LOG_N = 17;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 256 * 1024 * 1024;
const FORMAT = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/;

function derive(pw: string, salt: Buffer, logN: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // NFKC: "ä" typed as one code point or as a + diaeresis is the same password
    scrypt(pw.normalize('NFKC'), salt, KEYLEN, { N: 2 ** logN, r, p, maxmem: MAXMEM }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(pw, salt, LOG_N, R, P);
  return `scrypt$${LOG_N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [, logN, r, p, salt, hash] = FORMAT.exec(stored) ?? [];
  if (salt === undefined || hash === undefined) throw new Error('unrecognized password hash');
  const actual = await derive(pw, Buffer.from(salt, 'base64'), Number(logN), Number(r), Number(p));
  // throws on a length mismatch, so a truncated stored hash can never verify
  return timingSafeEqual(actual, Buffer.from(hash, 'base64'));
}
