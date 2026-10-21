import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../app.ts';
import { SESSION_TTL_MS, findSession, renewIfDue } from '../auth/sessions.ts';

const COOKIE = { prefix: 'host', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' } as const;

export const setSessionCookie = (c: Context, token: string): void =>
  setCookie(c, 'session', token, { ...COOKIE, maxAge: SESSION_TTL_MS / 1000 });

export const clearSessionCookie = (c: Context): void => setCookie(c, 'session', '', { ...COOKIE, maxAge: 0 });

export const bearerToken = (authorization: string | undefined): string | null =>
  /^Bearer +(\S+)$/i.exec(authorization ?? '')?.[1] ?? null;

export function requireAuth(kind: 'browser' | 'api' | 'any') {
  return createMiddleware<AppEnv>(async (c, next) => {
    const { db, now } = c.get('deps');
    const t = now();
    const bearer = bearerToken(c.req.header('Authorization'));
    // A Bearer header wins over the cookie: csrf() skips Bearer requests, so they must not ride on the cookie.
    const token = bearer ?? getCookie(c, 'session', 'host');
    const found = token ? findSession(db, token, t) : null;
    // Each token only works through its own channel: api tokens as Bearer, browser sessions as the cookie.
    if (!token || !found || found.kind !== (bearer ? 'api' : 'browser')) {
      return c.json({ error: 'unauthenticated' }, 401);
    }
    if (kind !== 'any' && found.kind !== kind) return c.json({ error: 'forbidden' }, 403);
    const renewed = renewIfDue(db, found, t);
    if (renewed !== null && found.kind === 'browser') setSessionCookie(c, token);
    c.set('auth', renewed === null ? found : { ...found, expiresAt: renewed });
    await next();
  });
}
