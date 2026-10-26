import type { Hono } from 'hono';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../src/app.ts';
import { createLoginLimiter } from '../src/auth/rate-limit.ts';
import { createSession } from '../src/auth/sessions.ts';
import { createUser } from '../src/users.ts';
import { DAY, SAME_ORIGIN, T0, cookieOf, login, makeTestApp } from './helpers.ts';

const PW = 'correct horse';
const MIN15 = 15 * 60_000;

async function setup() {
  const t = makeTestApp();
  const user = await createUser(t.db, { username: 'Anna', password: PW, locale: 'sv', now: T0 });
  return { ...t, user };
}

const me = (app: Hono<AppEnv>, headers: Record<string, string> = {}) => app.request('/api/me', { headers });
const logout = (app: Hono<AppEnv>, headers: Record<string, string>) =>
  app.request('/api/auth/logout', { method: 'POST', headers });

describe('auth', { timeout: 30_000 }, () => {
  it('login sets a __Host- cookie with the spec attributes', async () => {
    const { app, user } = await setup();
    const res = await login(app, 'anna', PW);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: { id: user.userId, username: 'Anna' }, householdId: user.householdId });
    expect(res.headers.get('set-cookie')).toMatch(
      /^__Host-session=[A-Za-z0-9_-]{43}; Max-Age=34560000; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
    );
  });

  it('wrong password and unknown user give the same 401', async () => {
    const { app, db } = await setup();
    const timed = async (username: string, password: string) => {
      const start = performance.now();
      const res = await login(app, username, password);
      return { res, ms: performance.now() - start };
    };
    const { res: wrong, ms: wrongMs } = await timed('anna', 'wrong password');
    const { res: unknown, ms: unknownMs } = await timed('nobody', PW);
    // an unknown user must cost a scrypt too (coarse bound: skipping it is 100x+ faster)
    expect(unknownMs).toBeGreaterThan(wrongMs / 10);
    db.prepare('UPDATE users SET disabled_at = ?').run(T0);
    const disabled = await login(app, 'anna', PW);
    for (const res of [wrong, unknown, disabled]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'invalid_credentials' });
      expect(res.headers.get('set-cookie')).toBeNull();
    }
  });

  it('blocks the 11th failed attempt within 15 minutes', async () => {
    const { app, setNow } = await setup();
    // sent in parallel: every guess must count, even ones still being verified
    const parallel = await Promise.all(Array.from({ length: 11 }, () => login(app, 'Anna', 'wrong password')));
    expect(parallel.map((r) => r.status).sort()).toEqual([...Array<number>(10).fill(401), 429]);
    const blocked = await login(app, 'anna', PW);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'rate_limited' });
    setNow(T0 + MIN15);
    expect((await login(app, 'anna', PW)).status).toBe(200);
  });

  it('logs failed and rate-limited logins at warn by normalized username, never the password', async () => {
    const lines: string[] = [];
    const { app, db } = makeTestApp({ logger: pino({ level: 'warn' }, { write: (line: string) => void lines.push(line) }) });
    await createUser(db, { username: 'Anna', password: PW, locale: 'sv', now: T0 });
    for (let i = 0; i < 11; i++) await login(app, ' ANNA ', 'wrong password');
    const logged = lines
      .map((line) => JSON.parse(line) as { level: number; msg: string; username: string })
      // an empty database also logs its setup code
      .filter((l) => l.msg.startsWith('login'));
    expect(logged.map(({ level, msg, username }) => ({ level, msg, username }))).toEqual([
      ...Array<object>(10).fill({ level: 40, msg: 'login failed', username: 'anna' }),
      { level: 40, msg: 'login rate limited', username: 'anna' },
    ]);
    expect(lines.join('')).not.toContain('wrong password');
  });

  it('limits failures per username and in total', () => {
    const limiter = createLoginLimiter();
    for (let i = 0; i < 9; i++) limiter.fail('a', T0);
    expect(limiter.blocked('a', T0)).toBe(false);
    limiter.fail('a', T0);
    expect(limiter.blocked('a', T0)).toBe(true);
    expect(limiter.blocked('b', T0)).toBe(false);
    limiter.reset('a');
    expect(limiter.blocked('a', T0)).toBe(false);
    for (let i = 0; i < 100; i++) limiter.fail(`user${i % 50}`, T0 + 1);
    expect(limiter.blocked('someone-else', T0 + 1)).toBe(true);
    expect(limiter.blocked('someone-else', T0 + 1 + MIN15)).toBe(false);
  });

  it('me requires a valid session', async () => {
    const { app, db, setNow, user } = await setup();
    const none = await me(app);
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({ error: 'unauthenticated' });
    expect((await me(app, { Cookie: '__Host-session=not-a-token' })).status).toBe(401);

    const revoked = cookieOf(await login(app, 'anna', PW));
    const ok = await me(app, { Cookie: revoked });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      user: { id: user.userId, username: 'Anna' },
      households: [{ id: user.householdId, role: 'owner', members: [{ id: user.userId, username: 'Anna', role: 'owner' }] }],
    });
    db.prepare('UPDATE sessions SET revoked_at = ?').run(T0);
    expect((await me(app, { Cookie: revoked })).status).toBe(401);

    const expired = cookieOf(await login(app, 'anna', PW));
    setNow(T0 + 401 * DAY);
    expect((await me(app, { Cookie: expired })).status).toBe(401);

    const disabled = cookieOf(await login(app, 'anna', PW));
    expect((await me(app, { Cookie: disabled })).status).toBe(200);
    db.prepare('UPDATE users SET disabled_at = ?').run(T0 + 401 * DAY);
    expect((await me(app, { Cookie: disabled })).status).toBe(401);
  });

  it('api tokens only work as Bearer and are forbidden on browser routes', async () => {
    const { app, db, user } = await setup();
    const { token } = createSession(db, { userId: user.userId, kind: 'api', name: 'Home Assistant', scopes: ['lists:read'], now: T0 });
    const bearer = { Authorization: `Bearer ${token}` };
    expect((await me(app, bearer)).status).toBe(200);
    const res = await logout(app, bearer);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect((await me(app, { Cookie: `__Host-session=${token}` })).status).toBe(401);
    const browser = cookieOf(await login(app, 'anna', PW)).replace('__Host-session=', '');
    expect((await me(app, { Authorization: `Bearer ${browser}` })).status).toBe(401);
  });

  it('renews the session cookie after a day', async () => {
    const { app, db, setNow } = await setup();
    const cookie = cookieOf(await login(app, 'anna', PW));
    setNow(T0 + DAY);
    expect((await me(app, { Cookie: cookie })).headers.get('set-cookie')).toBeNull();
    setNow(T0 + 2 * DAY);
    const res = await me(app, { Cookie: cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/; Max-Age=34560000; /);
    expect(cookieOf(res)).toBe(cookie);
    expect(db.prepare('SELECT expires_at, last_seen_at FROM sessions').get()).toEqual({
      expires_at: T0 + 2 * DAY + 400 * DAY,
      last_seen_at: T0 + 2 * DAY,
    });
  });

  it('rejects cross-site writes', async () => {
    const { app } = await setup();
    const cookie = cookieOf(await login(app, 'anna', PW));
    const attempts: Record<string, string>[] = [
      { Host: 'promus.test', 'Sec-Fetch-Site': 'cross-site' },
      { Host: 'promus.test', Origin: 'https://evil.example' },
      { Host: 'promus.test', 'Sec-Fetch-Site': 'same-site', Origin: 'https://promus.test' },
      { Host: 'promus.test' },
      { Host: 'promus.test', Origin: 'null' },
      { Origin: 'null' },
      { Host: 'promus.test', Origin: 'https://promus.test:8443' },
      // only a real Bearer token skips the check, not any Authorization header
      { Host: 'promus.test', 'Sec-Fetch-Site': 'cross-site', Authorization: 'Basic eDp5' },
    ];
    for (const headers of attempts) {
      const res = await logout(app, { ...headers, Cookie: cookie });
      expect(res.status, JSON.stringify(headers)).toBe(403);
      expect(await res.json()).toEqual({ error: 'csrf' });
    }
    expect((await me(app, { Cookie: cookie })).status).toBe(200);
  });

  it('accepts same-origin writes', async () => {
    const { app } = await setup();
    const a = cookieOf(await login(app, 'anna', PW));
    expect((await logout(app, { ...SAME_ORIGIN, Cookie: a })).status).toBe(204);
    const b = cookieOf(await login(app, 'anna', PW, { Host: 'promus.test', Origin: 'https://promus.test' }));
    expect((await logout(app, { Host: 'promus.test', Origin: 'https://promus.test', Cookie: b })).status).toBe(204);
  });

  it('login is CSRF-checked too', async () => {
    const { app } = await setup();
    const res = await login(app, 'anna', PW, { Host: 'promus.test', 'Sec-Fetch-Site': 'cross-site' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'csrf' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('logout revokes the session', async () => {
    const { app, db } = await setup();
    const cookie = cookieOf(await login(app, 'anna', PW));
    const res = await logout(app, { ...SAME_ORIGIN, Cookie: cookie });
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toBe('__Host-session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax');
    expect(db.prepare('SELECT revoked_at FROM sessions').get()).toEqual({ revoked_at: T0 });
    expect((await me(app, { Cookie: cookie })).status).toBe(401);
  });
});
