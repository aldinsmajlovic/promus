import { readFile } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
import type { Context } from 'hono';
import { getMimeType } from 'hono/utils/mime';

const NOT_FOUND_CODES = new Set([
  'ENOENT',
  'EISDIR',
  'ENOTDIR',
  'ENAMETOOLONG',
  'ELOOP',
  'ERR_INVALID_ARG_VALUE',
]);
// Angular stamps an 8-character content hash into bundled file names
// (main-4FBLEPWP.js, media/roboto-latin-400-normal-LOX3CHMS.woff2). Only those never change.
const HASHED = /-[A-Z0-9]{8}\.[a-z0-9]+$/;

async function tryRead(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (err) {
    if (NOT_FOUND_CODES.has((err as NodeJS.ErrnoException).code ?? '')) return null;
    throw err;
  }
}

function respond(c: Context, rel: string, body: Buffer) {
  c.header('Content-Type', getMimeType(rel) ?? 'application/octet-stream');
  c.header(
    'Cache-Control',
    HASHED.test(rel) ? 'public, max-age=31536000, immutable' : 'no-cache',
  );
  return c.body(new Uint8Array(body));
}

export function serveWeb(webRoot: string) {
  const root = resolve(webRoot);
  return async (c: Context) => {
    const rel = normalize(c.req.path).replace(/^[/\\]+/, '');
    const file = join(root, rel);
    if (!rel.includes('\0') && rel !== '' && (file === root || file.startsWith(root + sep))) {
      const body = await tryRead(file);
      if (body) return respond(c, rel, body);
    }
    const index = await tryRead(join(root, 'index.html'));
    return index ? respond(c, 'index.html', index) : c.json({ error: 'not_found' }, 404);
  };
}
