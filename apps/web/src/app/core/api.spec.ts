import { TestBed } from '@angular/core/testing';
import { ApiError, AuthError, NetworkError } from '@promus/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient, FETCH } from './api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

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
});
