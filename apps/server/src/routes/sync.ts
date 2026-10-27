import { Hono } from 'hono';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { LIMITS, hlcWall, parseEventInput } from '@promus/shared';
import type { EventInput, PullResponse, PushResponse, RejectCode } from '@promus/shared';
import type { AppDeps, AppEnv } from '../app.ts';
import { insertEvents, listEvents } from '../events-repo.ts';
import { requireAuth } from '../middleware/auth.ts';

/** First zod issue only (message and path), never the event body. */
const firstIssue = (pretty: string): string =>
  pretty.split(/\n(?=✖)/)[0]!.replace(/^✖ /, '').replace(/\s*\n\s*→ at /, ' at ').slice(0, 200);

export const intParam = (v: string | undefined, def: number, min: number, max: number): number | null => {
  if (v === undefined) return def;
  const n = /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
};

type Refusal = { code: RejectCode; message: string };

type Pusher = {
  /** Whose events these are stored as. */
  who: { userId: string; sessionId: string };
  /** Refuses an event on its own, before the clock check. */
  refuse?: (e: EventInput) => Refusal | null;
  /** Refuses among the events that passed every other check, judged together, by event id. */
  judge?: (events: EventInput[]) => Map<string, Refusal>;
  /** Ids for the rejection log lines. */
  logged: Record<string, string>;
};

export const pushLimit = bodyLimit({ maxSize: LIMITS.pushMaxBytes, onError: (c) => c.json({ error: 'payload_too_large' }, 413) });

/** Stores each event that parses, that `refuse` lets through, that isn't more than an hour ahead and that `judge` lets through. */
export const pushHandler =
  ({ db, now, logger }: Pick<AppDeps, 'db' | 'now' | 'logger'>, pusher: (c: Context<AppEnv>) => Pusher) =>
  async (c: Context<AppEnv>) => {
    const body = (await c.req.json().catch(() => null)) as { events?: unknown } | null;
    const raw = body?.events;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > LIMITS.pushMaxEvents) {
      return c.json({ error: 'invalid_request' }, 400);
    }
    const { who, refuse, judge, logged } = pusher(c);
    const t = now();
    const rejected: PushResponse['rejected'] = [];
    const passed: EventInput[] = [];
    for (const item of raw) {
      const parsed = parseEventInput(item);
      if (!parsed.ok) {
        rejected.push({ id: parsed.id, code: 'invalid', message: firstIssue(parsed.message) });
        continue;
      }
      const e = parsed.event;
      const refusal: Refusal | null =
        refuse?.(e) ??
        (hlcWall(e.hlc) > t + LIMITS.maxClockSkewMs ? { code: 'clock_skew', message: 'event is more than one hour in the future' } : null);
      if (refusal) {
        rejected.push({ id: e.id, ...refusal });
        continue;
      }
      passed.push(e);
    }
    const judged = judge?.(passed);
    const accepted: string[] = [];
    const valid: EventInput[] = [];
    for (const e of passed) {
      const refusal = judged?.get(e.id);
      if (refusal) {
        rejected.push({ id: e.id, ...refusal });
        continue;
      }
      valid.push(e);
      if (!accepted.includes(e.id)) accepted.push(e.id);
    }
    for (const r of rejected) logger.warn({ eventId: r.id, code: r.code, ...logged }, 'event rejected');
    insertEvents(db, valid, who, t);
    return c.json({ accepted, rejected, serverTime: t } satisfies PushResponse);
  };

export function syncRoutes(deps: Pick<AppDeps, 'db' | 'now' | 'logger'>) {
  const { db, now } = deps;
  return new Hono<AppEnv>()
    .post(
      '/sync/push',
      requireAuth('browser'),
      pushLimit,
      pushHandler(deps, (c) => {
        const auth = c.get('auth');
        return {
          who: auth,
          refuse: (e) =>
            auth.householdIds.includes(e.householdId) ? null : { code: 'forbidden_household', message: 'not a member of this household' },
          logged: { userId: auth.userId },
        };
      }),
    )
    .get('/sync/pull', requireAuth('browser'), (c) => {
      const after = intParam(c.req.query('after'), 0, 0, Number.MAX_SAFE_INTEGER);
      const limit = intParam(c.req.query('limit'), LIMITS.pullMaxLimit, 1, LIMITS.pullMaxLimit);
      if (after === null || limit === null) return c.json({ error: 'invalid_request' }, 400);
      const { events, hasMore } = listEvents(db, c.get('auth').householdIds, after, limit);
      return c.json({ events, lastSeq: events.at(-1)?.seq ?? after, hasMore, serverTime: now() } satisfies PullResponse);
    });
}
