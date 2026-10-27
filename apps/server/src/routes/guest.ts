import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie } from 'hono/cookie';
import { GUEST_NAME_MAX, cleanGuestName, guestNameSchema, sharedEvents, shareJoinSchema, shareTokenSchema } from '@promus/shared';
import type { GuestMe, PullResponse, ShareCheck, ShareJoined } from '@promus/shared';
import type { AppDeps, AppEnv } from '../app.ts';
import { householdEvents, lastSeq, listState } from '../events-repo.ts';
import {
  addGuest, findGuest, guestAccepted, guestCookieName, guestPushContext, guestRejection, peopleOnList, renameGuest, shareScope,
} from '../guests.ts';
import { requireGuest, setGuestCookie } from '../middleware/guest.ts';
import { findShareByToken } from '../shares.ts';
import { intParam, pushHandler, pushLimit } from './sync.ts';

const small = bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: 'payload_too_large' }, 413) });

const tooLong = (name: string | null): boolean => name !== null && name.length > GUEST_NAME_MAX;

// Tokens travel only in request bodies: the request log records every path. Guest names are never logged.
export function guestRoutes(deps: Pick<AppDeps, 'db' | 'logger' | 'now'>) {
  const { db, logger, now } = deps;
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
    })
    // ponytail: folds the household's whole log on each pull with something new, and on each push: fine while a
    // household's log is small. Upgrade path: cache the fold by the household's last seq.
    .get('/guest/:shareId/pull', requireGuest(), (c) => {
      // ponytail: no paging, so `limit` is ignored: a shared list's scope is small. Upgrade path: page by seq as
      // /sync/pull does, with the scope's earlier item events on the page where their item enters.
      const after = intParam(c.req.query('after'), 0, 0, Number.MAX_SAFE_INTEGER);
      if (after === null) return c.json({ error: 'invalid_request' }, 400);
      const { share } = c.get('guest');
      const last = lastSeq(db, share.householdId);
      const events = after >= last ? [] : sharedEvents(householdEvents(db, share.householdId), shareScope(share), after);
      return c.json({ events, lastSeq: Math.max(after, last), hasMore: false, serverTime: now() } satisfies PullResponse);
    })
    .post(
      '/guest/:shareId/push',
      requireGuest(),
      pushLimit,
      pushHandler(deps, (c) => {
        const guest = c.get('guest');
        const ctx = guestPushContext(db, guest);
        return {
          who: { userId: guest.guestId, sessionId: guest.guestId },
          refuse: (e) => {
            const code = guestRejection(e, ctx);
            if (code === null) return null;
            return { code, message: code === 'out_of_scope' ? 'not on the shared list' : "not the shared list's household" };
          },
          onAccepted: (e) => guestAccepted(ctx, e),
          logged: { guestId: guest.guestId },
        };
      }),
    );
}
