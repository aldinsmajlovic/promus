import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { LIMITS, hlcWall, parseEventInput } from '@promus/shared';
import type { EventInput, PullResponse, PushResponse } from '@promus/shared';
import type { AppDeps, AppEnv } from '../app.ts';
import { insertEvents, listEvents } from '../events-repo.ts';
import { requireAuth } from '../middleware/auth.ts';

/** First zod issue only (message and path), never the event body. */
const firstIssue = (pretty: string): string =>
  pretty.split(/\n(?=✖)/)[0]!.replace(/^✖ /, '').replace(/\s*\n\s*→ at /, ' at ').slice(0, 200);

const intParam = (v: string | undefined, def: number, min: number, max: number): number | null => {
  if (v === undefined) return def;
  const n = /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
};

export function syncRoutes({ db, now, logger }: Pick<AppDeps, 'db' | 'now' | 'logger'>) {
  return new Hono<AppEnv>()
    .post(
      '/sync/push',
      requireAuth('browser'),
      bodyLimit({ maxSize: LIMITS.pushMaxBytes, onError: (c) => c.json({ error: 'payload_too_large' }, 413) }),
      async (c) => {
        const body = (await c.req.json().catch(() => null)) as { events?: unknown } | null;
        const raw = body?.events;
        if (!Array.isArray(raw) || raw.length < 1 || raw.length > LIMITS.pushMaxEvents) {
          return c.json({ error: 'invalid_request' }, 400);
        }
        const auth = c.get('auth');
        const t = now();
        const accepted: string[] = [];
        const rejected: PushResponse['rejected'] = [];
        const valid: EventInput[] = [];
        for (const item of raw) {
          const parsed = parseEventInput(item);
          if (!parsed.ok) {
            rejected.push({ id: parsed.id, code: 'invalid', message: firstIssue(parsed.message) });
          } else if (!auth.householdIds.includes(parsed.event.householdId)) {
            rejected.push({ id: parsed.event.id, code: 'forbidden_household', message: 'not a member of this household' });
          } else if (hlcWall(parsed.event.hlc) > t + LIMITS.maxClockSkewMs) {
            rejected.push({ id: parsed.event.id, code: 'clock_skew', message: 'event is more than one hour in the future' });
          } else {
            valid.push(parsed.event);
            if (!accepted.includes(parsed.event.id)) accepted.push(parsed.event.id);
          }
        }
        for (const r of rejected) logger.warn({ eventId: r.id, code: r.code, userId: auth.userId }, 'event rejected');
        insertEvents(db, valid, auth, t);
        return c.json({ accepted, rejected, serverTime: t } satisfies PushResponse);
      },
    )
    .get('/sync/pull', requireAuth('browser'), (c) => {
      const after = intParam(c.req.query('after'), 0, 0, Number.MAX_SAFE_INTEGER);
      const limit = intParam(c.req.query('limit'), LIMITS.pullMaxLimit, 1, LIMITS.pullMaxLimit);
      if (after === null || limit === null) return c.json({ error: 'invalid_request' }, 400);
      const { events, hasMore } = listEvents(db, c.get('auth').householdIds, after, limit);
      return c.json({ events, lastSeq: events.at(-1)?.seq ?? after, hasMore, serverTime: now() } satisfies PullResponse);
    });
}
