import { readFile } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';
import type { Context } from 'hono';
import { getMimeType } from 'hono/utils/mime';

const NO_CACHE = new Set(['index.html', 'ngsw.json']);

async function tryRead(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT' || (err as NodeJS.ErrnoException).code === 'EISDIR') return null;
    throw err;
  }
}

function respond(c: Context, rel: string, body: Buffer) {
  c.header('Content-Type', getMimeType(rel) ?? 'application/octet-stream');
  c.header(
    'Cache-Control',
    NO_CACHE.has(rel) ? 'no-cache' : 'public, max-age=31536000, immutable',
  );
  return c.body(new Uint8Array(body));
}

export function serveWeb(webRoot: string) {
  const root = normalize(webRoot);
  return async (c: Context) => {
    const rel = normalize(decodeURIComponent(c.req.path)).replace(/^[/\\]+/, '');
    const file = join(root, rel);
    if (rel !== '' && (file === root || file.startsWith(root + sep))) {
      const body = await tryRead(file);
      if (body) return respond(c, rel, body);
    }
    const index = await tryRead(join(root, 'index.html'));
    return index ? respond(c, 'index.html', index) : c.json({ error: 'not_found' }, 404);
  };
}
