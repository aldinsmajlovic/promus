import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie } from 'hono/cookie';
import { GUEST_NAME_MAX, cleanGuestName, guestNameSchema, shareJoinSchema, shareTokenSchema } from '@promus/shared';
import type { GuestMe, ShareCheck, ShareJoined } from '@promus/shared';
import type { AppDeps, AppEnv } from '../app.ts';
import { listState } from '../events-repo.ts';
import { addGuest, findGuest, guestCookieName, peopleOnList, renameGuest } from '../guests.ts';
import { requireGuest, setGuestCookie } from '../middleware/guest.ts';
import { findShareByToken } from '../shares.ts';

const small = bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: 'payload_too_large' }, 413) });

const tooLong = (name: string | null): boolean => name !== null && name.length > GUEST_NAME_MAX;

// Tokens travel only in request bodies: the request log records every path. Guest names are never logged.
export function guestRoutes({ db, logger, now }: Pick<AppDeps, 'db' | 'logger' | 'now'>) {
  return new Hono<AppEnv>()
    .post('/guest/check', small, async (c) => {
      const body = shareTokenSchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: 'invalid_request' }, 400);
      const share = findShareByToken(db, body.data.token, now());
      const state = share && listState(db, share.householdId, share.listId);
      if (!share || !state || state.deleted) return c.json({ error: 'share_invalid' }, 404);
      const cookie = getCookie(c, guestCookieName(share.id), 'host');
      const check: ShareCheck = {
        shareId: share.id, listName: state.name, sharedBy: share.sharedBy, expiresAt: share.expiresAt,
        joined: cookie !== undefined && findGuest(db, share.id, cookie) !== undefined,
      };
      return c.json(check);
    })
    .post('/guest/join', small, async (c) => {
      const body = shareJoinSchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: 'invalid_request' }, 400);
      const t = now();
      const share = findShareByToken(db, body.data.token, t);
      const state = share && listState(db, share.householdId, share.listId);
      if (!share || !state || state.deleted) return c.json({ error: 'share_invalid' }, 404);
      const name = cleanGuestName(body.data.name);
      if (tooLong(name)) return c.json({ error: 'name_too_long' }, 400);
      const guest = addGuest(db, { shareId: share.id, name, now: t });
      if (!guest) return c.json({ error: 'share_full' }, 409);
      setGuestCookie(c, share, guest.token, t);
      logger.info({ guestId: guest.id, shareId: share.id }, 'guest joined');
      const joined: ShareJoined = { shareId: share.id, guest: { id: guest.id, name } };
      return c.json(joined, 201);
    })
    .get('/guest/:shareId/me', requireGuest(), (c) => {
      const { guestId, name, share } = c.get('guest');
      const me: GuestMe = {
        guest: { id: guestId, name },
        share: { id: share.id, householdId: share.householdId, listId: share.listId, expiresAt: share.expiresAt, sharedBy: share.sharedBy },
        people: peopleOnList(db, share),
      };
      return c.json(me);
    })
    .put('/guest/:shareId/name', requireGuest(), small, async (c) => {
      const body = guestNameSchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: 'invalid_request' }, 400);
      const name = cleanGuestName(body.data.name);
      if (tooLong(name)) return c.json({ error: 'name_too_long' }, 400);
      const { guestId, share } = c.get('guest');
      renameGuest(db, guestId, name);
      logger.info({ guestId, shareId: share.id }, 'guest renamed');
      return c.body(null, 204);
    });
}
