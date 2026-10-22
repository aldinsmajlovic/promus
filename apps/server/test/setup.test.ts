import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import { createUser } from '../src/users.ts';
import { SAME_ORIGIN, T0, login, makeTestApp } from './helpers.ts';

// counts every hash, so a test can prove a refusal costs no scrypt
const hashes = vi.hoisted(() => ({ n: 0 }));
vi.mock('../src/auth/password.ts', async (load) => {
  const real = await load<typeof import('../src/auth/password.ts')>();
  return {
    ...real,
    hashPassword: (pw: string) => {
      hashes.n++;
      return real.hashPassword(pw);
    },
  };
});

const PW = 'correct horse';
const CODE = /^Setup code: ([A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4})$/;

type Line = { level: number; msg: string };

/** A test app whose log lines are kept, with the setup code it printed (if any). */
function app(base?: ReturnType<typeof makeTestApp>) {
  const lines: Line[] = [];
  const logger = pino({ level: 'info' }, { write: (line: string) => void lines.push(JSON.parse(line) as Line) });
  const t = base ?? makeTestApp({ logger });
  // a restart: a new app on the same database
  const restarted = base ? createApp({ db: t.db, config: t.config, logger, now: t.now, webRoot: t.webRoot }) : t.app;
  const code = lines.map((l) => CODE.exec(l.msg)?.[1]).find((c) => c !== undefined);
  const post = (body: unknown, headers: Record<string, string> = SAME_ORIGIN) =>
    restarted.request('/api/setup', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const needed = async () => ((await (await restarted.request('/api/setup')).json()) as { needed: boolean }).needed;
  return { ...t, app: restarted, lines, code, post, needed };
}

const account = (setupCode: string, extra: object = {}) => ({ setupCode, username: 'Anna', password: PW, locale: 'en', ...extra });

describe('setup', { timeout: 30_000 }, () => {
  it('is needed only while there are no users', async () => {
    const t = app();
    expect(await t.needed()).toBe(true);
    await createUser(t.db, { username: 'Anna', password: PW, locale: 'sv', now: T0 });
    expect(await t.needed()).toBe(false);
  });

  it('logs a setup code at warn on an empty database, and none once a user exists', async () => {
    const t = app();
    const line = t.lines.find((l) => CODE.test(l.msg));
    expect(line?.level).toBe(40);
    await createUser(t.db, { username: 'Anna', password: PW, locale: 'sv', now: T0 });
    expect(app(t).code).toBeUndefined();
  });

  it('creates the owner and a default list in the chosen language, then signs in normally', async () => {
    const t = app();
    const res = await t.post(account(` ${t.code!.toLowerCase().replace('-', '')} `));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({});
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(t.db.prepare('SELECT role FROM household_members').all()).toEqual([{ role: 'owner' }]);
    const ev = t.db.prepare("SELECT payload FROM events WHERE type = 'list.created'").get() as { payload: string };
    expect(JSON.parse(ev.payload).name).toBe('Shopping list');
    expect((await login(t.app, 'anna', PW)).status).toBe(200);
    expect(await t.needed()).toBe(false);
  });

  it('refuses a second setup, even with the same code', async () => {
    const t = app();
    expect((await t.post(account(t.code!))).status).toBe(201);
    const again = await t.post(account(t.code!, { username: 'Bo' }));
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'already_set_up' });
  });

  it('refuses a wrong code, and the code from before a restart, without hashing', async () => {
    const t = app();
    const before = hashes.n;
    const wrong = await t.post(account('AAAA-AAAA'));
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toEqual({ error: 'setup_code_invalid' });
    const restarted = app(t);
    expect(restarted.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect((await restarted.post(account(t.code!))).status).toBe(403);
    expect(hashes.n).toBe(before);
    expect((await restarted.post(account(restarted.code!))).status).toBe(201);
  });

  it('limits wrong codes to 10 per 15 minutes', async () => {
    const t = app();
    for (let i = 0; i < 10; i++) expect((await t.post(account('AAAA-AAAA'))).status).toBe(403);
    const blocked = await t.post(account(t.code!));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'rate_limited' });
    t.setNow(T0 + 15 * 60_000);
    expect((await t.post(account(t.code!))).status).toBe(201);
  });

  it('answers account problems with codes', async () => {
    const t = app();
    const short = await t.post(account(t.code!, { password: '1234567' }));
    expect(short.status).toBe(400);
    expect(await short.json()).toEqual({ error: 'password_too_short' });
    const blank = await t.post(account(t.code!, { username: '  ' }));
    expect(blank.status).toBe(400);
    expect(await blank.json()).toEqual({ error: 'username_invalid' });
    const bad = await t.post({ setupCode: t.code, username: 'Anna' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'invalid_request' });
  });

  it('lets exactly one of two simultaneous setups through', async () => {
    const t = app();
    const results = await Promise.all([t.post(account(t.code!)), t.post(account(t.code!, { username: 'Bo' }))]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 });
  });

  it('refuses a cross-site setup', async () => {
    const t = app();
    const res = await t.post(account(t.code!), { Host: 'promus.test', 'Sec-Fetch-Site': 'cross-site' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'csrf' });
  });
});
