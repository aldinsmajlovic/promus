import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { bearerToken } from './auth.ts';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function sameOrigin(c: Context): boolean {
  const site = c.req.header('Sec-Fetch-Site');
  if (site !== undefined) return site === 'same-origin';
  const origin = URL.parse(c.req.header('Origin') ?? '');
  return origin !== null && origin.host === c.req.header('Host');
}

/** Cookie-authenticated writes must come from our own origin. Bearer requests can't be forged cross-site. */
export function csrf() {
  return createMiddleware(async (c, next) => {
    const exempt = !UNSAFE.has(c.req.method) || bearerToken(c.req.header('Authorization')) !== null;
    if (!exempt && !sameOrigin(c)) return c.json({ error: 'csrf' }, 403);
    await next();
  });
}
