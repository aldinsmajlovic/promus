import { importProvidersFrom, provideAppInitializer, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { newId } from '@promus/shared';
import { describe, expect, it, vi } from 'vitest';
import sv from '../../i18n/sv.json';
import { routes } from '../app.routes';
import { FETCH } from './api';
import { PromusDb } from './db';
import { registerIcons } from './icons';
import { SECURE_CONTEXT } from './platform';
import { SyncService, type SyncStatus } from './sync.service';

const session = { userId: newId(), username: 'anna', householdId: newId() };

/** The app's own routes, with the real pages; `realSync` keeps the real SyncService, never started. */
async function setup(realSync = false) {
  const db = new PromusDb(`guard-${newId()}`);
  const status = signal<SyncStatus>({ kind: 'idle', pending: 0, rejected: 0 });
  const fetch = vi.fn<typeof globalThis.fetch>();
  const sync = { status, syncNow: async () => undefined, soon: () => undefined };
  TestBed.configureTestingModule({
    providers: [
      { provide: PromusDb, useValue: db },
      { provide: FETCH, useValue: fetch },
      // jsdom has no isSecureContext
      { provide: SECURE_CONTEXT, useValue: true },
      realSync ? [] : { provide: SyncService, useValue: sync },
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      provideRouter(routes),
      provideAppInitializer(registerIcons),
      importProvidersFrom(
        TranslocoTestingModule.forRoot({
          langs: { sv },
          translocoConfig: { availableLangs: ['sv'], defaultLang: 'sv' },
          preloadLangs: true,
        }),
      ),
    ],
  });
  const harness = await RouterTestingHarness.create();
  const router = TestBed.inject(Router);
  const visit = async (url: string) => {
    await harness.navigateByUrl(url);
    return router.url;
  };
  return { db, status, fetch, visit };
}

describe('route guards', () => {
  it('guard allows a cached session and redirects without one', async () => {
    const { db, fetch, visit } = await setup();
    for (const url of ['/', '/add', '/settings']) expect(await visit(url)).toBe('/login');
    // the way to /login asks whether the server needs its first account
    fetch.mockClear();
    await db.setMeta('session', session);
    for (const url of ['/', '/add', '/settings']) expect(await visit(url)).toBe(url);
    // the cached session is enough: the app opens offline (Settings asks only who's in the household)
    expect(fetch.mock.calls.map(([url]) => url).filter((url) => url !== '/api/me')).toEqual([]);
  });

  it('login sends a cached session home, unless its sign-in expired', async () => {
    const { db, status, visit } = await setup();
    expect(await visit('/login')).toBe('/login');
    await db.setMeta('session', session);
    expect(await visit('/settings')).toBe('/settings');
    expect(await visit('/login')).toBe('/');
    // the sync status asks to sign in again
    status.set({ kind: 'auth', pending: 1, rejected: 0 });
    expect(await visit('/login')).toBe('/login');
  });

  it('a 401 from the server opens login again, with the session still cached', async () => {
    const { db, fetch, visit } = await setup(true);
    fetch.mockImplementation(async () => new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401 }));
    await db.setMeta('session', session);
    expect(await visit('/settings')).toBe('/settings');
    expect(await visit('/login')).toBe('/');
    const sync = TestBed.inject(SyncService);
    await sync.syncNow();
    expect(sync.status().kind).toBe('auth');
    expect(await visit('/login')).toBe('/login');
  });

  it('login sends a server without accounts to the setup wizard, and stays when offline', async () => {
    const { fetch, visit } = await setup();
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    fetch.mockResolvedValueOnce(json({ needed: true })).mockResolvedValueOnce(json({ needed: true }));
    expect(await visit('/login')).toBe('/setup');
    fetch.mockResolvedValueOnce(json({ needed: false }));
    expect(await visit('/login')).toBe('/login');
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await visit('/login')).toBe('/login');
  });

  it('setup sends you to sign in once the server has an account', async () => {
    const { fetch, visit } = await setup();
    fetch.mockResolvedValue(new Response(JSON.stringify({ needed: false }), { status: 200 }));
    expect(await visit('/setup')).toBe('/login');
  });
});
