import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../app.ts';
import { findGuest, guestCookieName, shareIsLive } from '../guests.ts';
import { bearerToken } from './auth.ts';
import { findShareById } from '../shares.ts';
import type { ShareRow } from '../shares.ts';

export const setGuestCookie = (c: Context, share: ShareRow, token: string, now: number): void =>
  setCookie(c, guestCookieName(share.id), token, {
    prefix: 'host', path: '/', secure: true, httpOnly: true, sameSite: 'Lax',
    maxAge: Math.floor((share.expiresAt - now) / 1000),
  });

export function requireGuest() {
  return createMiddleware<AppEnv>(async (c, next) => {
    // csrf() skips Bearer requests, so they must not ride on the cookie.
    if (bearerToken(c.req.header('Authorization')) !== null) return c.json({ error: 'unauthenticated' }, 401);
    const { db, now } = c.get('deps');
    const shareId = c.req.param('shareId') ?? '';
    const token = getCookie(c, guestCookieName(shareId), 'host');
    const share = token ? findShareById(db, shareId) : undefined;
    const guest = share && token ? findGuest(db, shareId, token) : undefined;
    if (!share || !guest) return c.json({ error: 'unauthenticated' }, 401);
    if (!shareIsLive(db, share, now())) return c.json({ error: 'share_ended' }, 401);
    c.set('guest', { guestId: guest.id, name: guest.name, share });
    await next();
  });
}
