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
import { SyncService, type SyncStatus } from './sync.service';

const session = { userId: newId(), username: 'anna', householdId: newId() };

/** The app's own routes, with the real pages. */
async function setup() {
  const db = new PromusDb(`guard-${newId()}`);
  const status = signal<SyncStatus>({ kind: 'idle', pending: 0, rejected: 0 });
  const fetch = vi.fn<typeof globalThis.fetch>();
  TestBed.configureTestingModule({
    providers: [
      { provide: PromusDb, useValue: db },
      { provide: FETCH, useValue: fetch },
      { provide: SyncService, useValue: { status, syncNow: async () => undefined, soon: () => undefined } },
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
    await db.setMeta('session', session);
    for (const url of ['/', '/add', '/settings']) expect(await visit(url)).toBe(url);
    // the cached session is enough: the app opens offline
    expect(fetch).not.toHaveBeenCalled();
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
});
