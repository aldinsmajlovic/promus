import type { TokenCreated } from '@promus/shared';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { setPassword, createUser } from '../src/users.ts';
import { SAME_ORIGIN, T0, cookieOf, login, makeTestApp } from './helpers.ts';

const PW = 'correct horse';
const HOUR = 3_600_000;

async function setup() {
  const lines: string[] = [];
  const t = makeTestApp({ logger: pino({ level: 'info' }, { write: (line: string) => void lines.push(line) }) });
  await createUser(t.db, { username: 'Anna', password: PW, locale: 'sv', now: T0 });
  await createUser(t.db, { username: 'Bo', password: PW, locale: 'sv', now: T0 });
  const cookieA = cookieOf(await login(t.app, 'anna', PW));
  const cookieB = cookieOf(await login(t.app, 'bo', PW));
  const send = (method: string, path: string, body?: unknown, cookie = '') =>
    t.app.request(path, {
      method,
      headers: { ...SAME_ORIGIN, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const make = async (cookie = cookieA) => (await (await send('POST', '/api/tokens', { name: 'HA' }, cookie)).json()) as TokenCreated;
  const bearer = (token: string, method = 'GET', path = '/api/me') =>
    t.app.request(path, { method, headers: { Authorization: `Bearer ${token}` } });
  const listed = async (cookie = cookieA) =>
    ((await (await send('GET', '/api/tokens', undefined, cookie)).json()) as { tokens: { id: string; lastUsedAt: number | null }[] }).tokens;
  return { ...t, lines, cookieA, cookieB, send, make, bearer, listed };
}

describe('api tokens', { timeout: 30_000 }, () => {
  it('makes a pr_ token, stores only its hash and lists it as never used', async () => {
    const { send, db, lines, cookieA } = await setup();
    const res = await send('POST', '/api/tokens', { name: '  Home Assistant ' }, cookieA);
    expect(res.status).toBe(201);
    const { id, token } = (await res.json()) as TokenCreated;
    expect(token).toMatch(/^pr_[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(db.prepare('SELECT * FROM sessions').all())).not.toContain(token);
    expect(lines.join('')).not.toContain(token);
    expect(db.prepare('SELECT kind, name, scopes FROM sessions WHERE id = ?').get(id)).toEqual({
      kind: 'api',
      name: 'Home Assistant',
      scopes: '["lists:read","lists:write"]',
    });
    expect(await (await send('GET', '/api/tokens', undefined, cookieA)).json()).toEqual({
      tokens: [{ id, name: 'Home Assistant', createdAt: T0, lastUsedAt: null }],
    });
  });

  it('refuses an empty name and one over 50 characters', async () => {
    const { send, cookieA } = await setup();
    expect((await send('POST', '/api/tokens', { name: '   ' }, cookieA)).status).toBe(400);
    expect((await send('POST', '/api/tokens', { name: 'x'.repeat(51) }, cookieA)).status).toBe(400);
  });

  it('records the first use at once, and later uses at most hourly', async () => {
    const { make, bearer, listed, setNow } = await setup();
    const { token, id } = await make();
    const lastUsed = async () => (await listed()).find((x) => x.id === id)?.lastUsedAt;
    setNow(T0 + 1000);
    expect((await bearer(token)).status).toBe(200);
    expect(await lastUsed()).toBe(T0 + 1000);
    setNow(T0 + HOUR / 2);
    await bearer(token);
    expect(await lastUsed()).toBe(T0 + 1000);
    setNow(T0 + 2 * HOUR);
    await bearer(token);
    expect(await lastUsed()).toBe(T0 + 2 * HOUR);
  });

  it('a revoked token answers 401 and Undo brings it back', async () => {
    const { make, bearer, send, cookieA } = await setup();
    const { token, id } = await make();
    expect((await send('DELETE', `/api/tokens/${id}`, undefined, cookieA)).status).toBe(204);
    expect((await bearer(token)).status).toBe(401);
    expect((await send('DELETE', `/api/tokens/${id}`, undefined, cookieA)).status).toBe(404);
    expect((await send('POST', `/api/tokens/${id}/restore`, undefined, cookieA)).status).toBe(204);
    expect((await bearer(token)).status).toBe(200);
  });

  it('another user cannot list, revoke or restore your token', async () => {
    const { make, send, listed, cookieA, cookieB } = await setup();
    const { id } = await make();
    expect(await listed(cookieB)).toEqual([]);
    expect((await send('DELETE', `/api/tokens/${id}`, undefined, cookieB)).status).toBe(404);
    await send('DELETE', `/api/tokens/${id}`, undefined, cookieA);
    expect((await send('POST', `/api/tokens/${id}/restore`, undefined, cookieB)).status).toBe(404);
  });

  it('a token cannot manage tokens, and a browser session id is not a token', async () => {
    const { make, bearer, send, db, cookieA } = await setup();
    const { token } = await make();
    expect((await bearer(token, 'POST', '/api/tokens')).status).toBe(403);
    const browser = db.prepare("SELECT id FROM sessions WHERE kind = 'browser' LIMIT 1").get() as { id: string };
    expect((await send('DELETE', `/api/tokens/${browser.id}`, undefined, cookieA)).status).toBe(404);
  });

  it('a password change disconnects every token', async () => {
    const { make, bearer, listed, db, app } = await setup();
    const { token } = await make();
    await setPassword(db, 'anna', 'another horse', T0 + 1);
    expect((await bearer(token)).status).toBe(401);
    const fresh = cookieOf(await login(app, 'anna', 'another horse'));
    expect(await listed(fresh)).toEqual([]);
  });
});
