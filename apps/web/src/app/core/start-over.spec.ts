import { importProvidersFrom, provideAppInitializer } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { newId } from '@promus/shared';
import { describe, expect, it, vi } from 'vitest';
import sv from '../../i18n/sv.json';
import { ROUTER_FEATURES, appConfig } from '../app.config';
import { routes } from '../app.routes';
import { FETCH } from './api';
import { PromusDb } from './db';
import { registerIcons } from './icons';
import { SessionService } from './session';
import { StartOver } from './start-over';
import { SyncService } from './sync.service';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Reply = (url: string) => Response | undefined;

async function setup(reply: Reply = () => undefined, full = false) {
  const db = new PromusDb(`start-over-${newId()}`);
  await db.setMeta('session', { userId: 'u2', username: 'bo', householdId: 'h1' });
  await db.setMeta('members', [
    { id: 'u1', username: 'anna', role: 'owner', former: false },
    { id: 'u2', username: 'bo', role: 'member', former: false },
  ]);
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const custom = reply(String(url));
    if (custom) return custom;
    if (url === '/api/households' && init?.method === 'POST') return json(201, { householdId: 'h2' });
    if (url === '/api/me') return json(200, { user: { id: 'u2', username: 'bo' }, households: [] });
    if (String(url).startsWith('/api/sync')) return json(200, { events: [], cursor: 0 });
    throw new Error(`unexpected ${String(url)}`);
  });
  TestBed.configureTestingModule({
    providers: [
      ...(full ? appConfig.providers.filter((p) => p !== appConfig.providers[0]) : [provideRouter(routes, ...ROUTER_FEATURES)]),
      { provide: PromusDb, useValue: db },
      { provide: FETCH, useValue: fetch },
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
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
  const session = TestBed.inject(SessionService);
  await session.load();
  const snack = () => document.querySelector('simple-snack-bar, .mat-mdc-snack-bar-container')?.textContent ?? '';
  return { db, fetch, session, snack, startOver: TestBed.inject(StartOver), router: TestBed.inject(Router) };
}

describe('StartOver', () => {
  it('removed: lands on a fresh list and says whose household it was', async () => {
    const t = await setup();
    await t.startOver.run('removed');
    expect(t.session.session()?.householdId).toBe('h2');
    expect(t.router.url).toBe('/');
    expect(t.snack()).toContain(sv.snack.removedYou.replace('{{owner}}', 'anna'));
    expect(t.snack()).toContain('OK');
    expect(TestBed.inject(MatSnackBar)._openedSnackBarRef?.containerInstance.snackBarConfig.duration).toBeFalsy();
  });

  it('removed, but the server answers with a household they have: no snackbar', async () => {
    const t = await setup((url) => (url === '/api/households' ? json(200, { householdId: 'h3' }) : undefined));
    await t.startOver.run('removed');
    expect(t.session.session()?.householdId).toBe('h3');
    expect(t.snack()).toBe('');
  });

  it('left: no snackbar', async () => {
    const t = await setup();
    await t.startOver.run('left');
    expect(t.session.session()?.householdId).toBe('h2');
    expect(t.snack()).toBe('');
  });

  it('offline: shows the failure and goes to sign-in', async () => {
    const t = await setup((url) => {
      if (url === '/api/households') throw new TypeError('offline');
      return undefined;
    });
    await t.startOver.run('removed');
    expect(t.session.session()).toBeNull();
    expect(t.router.url).toBe('/login');
    expect(t.snack()).toContain(sv.errors.actionFailed);
  });

  it('a 403 not_a_member during sync runs it', async () => {
    let pulled = false;
    const t = await setup((url) => {
      if (url.startsWith('/api/sync') && !pulled) {
        pulled = true;
        return json(403, { error: 'not_a_member' });
      }
      return undefined;
    }, true);
    TestBed.inject(SyncService).start();
    await vi.waitFor(() => expect(t.session.session()?.householdId).toBe('h2'));
  });
});
