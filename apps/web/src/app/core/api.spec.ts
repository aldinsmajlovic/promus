import { TestBed } from '@angular/core/testing';
import { ApiError, AuthError, NetworkError, newId } from '@promus/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient, FETCH } from './api';
import { PromusDb } from './db';
import { SYNC_API } from './sync.service';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const L = '0190a3b2-0000-7000-8000-000000000001';

const calls = (fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>) =>
  fetch.mock.calls.map(([url, init]) => [init?.method, url, init?.body && JSON.parse(init.body as string)]);

function setup(fetch: typeof globalThis.fetch) {
  TestBed.configureTestingModule({ providers: [{ provide: FETCH, useValue: fetch }] });
  return TestBed.inject(ApiClient);
}

describe('ApiClient', () => {
  it('maps network failures, 401 and server errors to typed errors', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(json(401, { error: 'unauthenticated' }))
      .mockResolvedValueOnce(json(500, { error: 'internal' }))
      .mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 502 }));
    const api = setup(fetch);
    await expect(api.pull(0, 500)).rejects.toBeInstanceOf(NetworkError);
    await expect(api.pull(0, 500)).rejects.toBeInstanceOf(AuthError);
    await expect(api.pull(0, 500)).rejects.toMatchObject({ name: 'ApiError', status: 500, code: 'internal' });
    const badGateway = await api.pull(0, 500).catch((err: unknown) => err);
    expect(badGateway).toBeInstanceOf(ApiError);
    expect(badGateway).toMatchObject({ status: 502, code: 'unknown' });
  });

  it('sends same-origin credentials', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json(200, { user: { id: 'u1', username: 'anna' }, householdId: 'h1' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json(200, { events: [], lastSeq: 7, hasMore: false, serverTime: 1 }));
    const api = setup(fetch);
    expect(await api.login('anna', 'secret')).toEqual({ user: { id: 'u1', username: 'anna' }, householdId: 'h1' });
    await api.logout();
    expect((await api.pull(7, 500)).lastSeq).toBe(7);
    expect(fetch.mock.calls.map(([url, init]) => [url, init?.method, init?.credentials])).toEqual([
      ['/api/auth/login', 'POST', 'same-origin'],
      ['/api/auth/logout', 'POST', 'same-origin'],
      ['/api/sync/pull?after=7&limit=500', 'GET', 'same-origin'],
    ]);
    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toEqual({ username: 'anna', password: 'secret' });
  });

  it('makes, ends and brings back links, and says whether a link was made', async () => {
    const share = { id: 's1', listId: L, token: 'tok', expiresAt: 1, createdBy: 'u1' };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json(201, share))
      .mockResolvedValueOnce(json(200, share))
      .mockResolvedValueOnce(json(200, { shares: [share], guests: [] }))
      .mockResolvedValue(new Response(null, { status: 204 }));
    const api = setup(fetch);
    expect(await api.createShare(L)).toEqual({ share, created: true });
    expect(await api.createShare(L)).toEqual({ share, created: false });
    expect(await api.shares()).toEqual({ shares: [share], guests: [] });
    await api.endShare('s1');
    await api.restoreShare('s1');
    expect(calls(fetch)).toEqual([
      ['POST', '/api/shares', { listId: L }],
      ['POST', '/api/shares', { listId: L }],
      ['GET', '/api/shares', undefined],
      ['DELETE', '/api/shares/s1', undefined],
      ['POST', '/api/shares/s1/restore', undefined],
    ]);
  });

  // the server logs every path
  it('a guest sends the link only in bodies', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(200, {}));
    const api = setup(fetch);
    await api.checkShare('tok');
    await api.joinShare('tok', 'Jonas');
    await api.joinShare('tok');
    await api.guestMe('s1');
    await api.renameGuest('s1', 'Jo');
    await api.guestSync('s1').push([]);
    await api.guestSync('s1').pull(7, 500);
    expect(calls(fetch)).toEqual([
      ['POST', '/api/guest/check', { token: 'tok' }],
      ['POST', '/api/guest/join', { token: 'tok', name: 'Jonas' }],
      ['POST', '/api/guest/join', { token: 'tok' }],
      ['GET', '/api/guest/s1/me', undefined],
      ['PUT', '/api/guest/s1/name', { name: 'Jo' }],
      ['POST', '/api/guest/s1/push', { events: [] }],
      ['GET', '/api/guest/s1/pull?after=7&limit=500', undefined],
    ]);
    expect(fetch.mock.calls.some(([url]) => String(url).includes('tok'))).toBe(false);
  });

  // through the service worker, no network is a 504 response rather than a failed fetch
  it('bypasses the service worker', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(json(200, { events: [], lastSeq: 0, hasMore: false, serverTime: 1 }));
    await setup(fetch).pull(0, 500);
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ 'ngsw-bypass': 'true' });
  });

  it('the household pull names the household in the session at the time of the call', async () => {
    const db = new PromusDb(`api-${newId()}`);
    await db.setMeta('session', { userId: 'u1', username: 'anna', householdId: 'h1' });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => json(200, { events: [], lastSeq: 0, hasMore: false, serverTime: 1 }));
    TestBed.configureTestingModule({
      providers: [
        { provide: PromusDb, useValue: db },
        { provide: FETCH, useValue: fetch },
      ],
    });
    const sync = TestBed.inject(SYNC_API);
    await sync.pull(3, 500);
    await db.setMeta('session', { userId: 'u1', username: 'anna', householdId: 'h2' });
    await sync.pull(3, 500);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/sync/pull?after=3&limit=500&household=h1',
      '/api/sync/pull?after=3&limit=500&household=h2',
    ]);
  });

  it('createHousehold says whether it made one', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json(201, { householdId: 'h1' }))
      .mockResolvedValueOnce(json(200, { householdId: 'h1' }));
    const api = setup(fetch);
    expect(await api.createHousehold('sv')).toEqual({ householdId: 'h1', created: true });
    expect(await api.createHousehold('en')).toEqual({ householdId: 'h1', created: false });
    expect(calls(fetch)).toEqual([
      ['POST', '/api/households', { locale: 'sv' }],
      ['POST', '/api/households', { locale: 'en' }],
    ]);
  });

  it('removes and restores a member', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response(null, { status: 204 }));
    const api = setup(fetch);
    await api.removeMember('h1', 'u 2');
    await api.restoreMember('h1', 'u 2');
    expect(calls(fetch)).toEqual([
      ['DELETE', '/api/households/h1/members/u%202', undefined],
      ['POST', '/api/households/h1/members/u%202/restore', undefined],
    ]);
  });
});
