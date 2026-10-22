import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatInputHarness } from '@angular/material/input/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { ApiError, formatHlc, makeEvent, newId } from '@promus/shared';
import { describe, expect, it, vi } from 'vitest';
import sv from '../../../i18n/sv.json';
import { FETCH } from '../../core/api';
import { PromusDb, type Session } from '../../core/db';
import { DexieSyncStorage } from '../../core/dexie-storage';
import { SyncService, type SyncStatus } from '../../core/sync.service';
import { LoginPage } from './login.page';

@Component({ template: '' })
class Home {}

const anna: Session = { userId: 'u1', username: 'anna', householdId: newId() };
const bo = { user: { id: 'u2', username: 'bo' }, householdId: newId() };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function setup(cached?: Session) {
  const db = new PromusDb(`login-${newId()}`);
  if (cached) await db.setMeta('session', cached);
  const fetch = vi.fn<typeof globalThis.fetch>();
  const status = signal<SyncStatus>({ kind: 'idle', pending: 0, rejected: 0 });
  // where the app was when sync started
  const syncedAt: string[] = [];
  const sync = { status, soon: () => undefined, syncNow: vi.fn(async () => void syncedAt.push(router.url)) };
  TestBed.configureTestingModule({
    providers: [
      { provide: PromusDb, useValue: db },
      { provide: FETCH, useValue: fetch },
      { provide: SyncService, useValue: sync },
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      provideRouter([
        { path: '', component: Home },
        { path: 'login', component: LoginPage },
      ]),
      importProvidersFrom(
        TranslocoTestingModule.forRoot({
          langs: { sv },
          translocoConfig: { availableLangs: ['sv'], defaultLang: 'sv' },
          preloadLangs: true,
        }),
      ),
    ],
  });
  const router = TestBed.inject(Router);
  const harness = await RouterTestingHarness.create('/login');
  const loader = TestbedHarnessEnvironment.documentRootLoader(harness.fixture);
  const el: HTMLElement = harness.fixture.nativeElement;
  const signIn = async (username: string, password: string) => {
    await (await loader.getHarness(MatInputHarness.with({ selector: '[autocomplete="username"]' }))).setValue(username);
    const pw = await loader.getHarness(MatInputHarness.with({ selector: '[autocomplete="current-password"]' }));
    expect(await pw.getType()).toBe('password');
    await pw.setValue(password);
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Logga in' }))).click();
  };
  const message = () => el.querySelector('[role="alert"]')?.textContent?.trim();
  return { db, fetch, sync, syncedAt, router, el, signIn, message };
}

/** A change of anna's, queued as the Store writes it; `pushed` once the server has it. */
async function annasChange(db: PromusDb, pushed: boolean) {
  const storage = new DexieSyncStorage(db);
  const event = makeEvent('list.created', { listId: newId(), name: 'Inköpslista' }, {
    householdId: anna.householdId,
    hlc: formatHlc(Date.now(), 0, 'test'),
    occurredAt: Date.now(),
  });
  await storage.append([event]);
  if (pushed) await storage.markPushed([event.id]);
}

describe('LoginPage', () => {
  it('login shows the right message for each error', async () => {
    const t = await setup();
    const outcomes: [() => Promise<Response>, string][] = [
      [async () => json(401, { error: 'invalid_credentials' }), 'Fel användarnamn eller lösenord'],
      [async () => json(429, { error: 'rate_limited' }), 'För många försök. Försök igen senare'],
      [() => Promise.reject(new TypeError('Failed to fetch')), 'Kan inte nå servern'],
    ];
    for (const [respond, text] of outcomes) {
      t.fetch.mockImplementationOnce(respond);
      await t.signIn('anna', 'fel');
      await vi.waitFor(() => expect(t.message()).toBe(text));
    }

    // anything else is logged, with a message that names no cause it doesn't know
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    t.fetch.mockResolvedValueOnce(json(500, { error: 'internal' }));
    await t.signIn('anna', 'pw');
    await vi.waitFor(() => expect(t.message()).toBe('Ändringen kunde inte sparas'));
    expect(log).toHaveBeenCalledWith('login failed', expect.any(ApiError));
    log.mockRestore();

    expect(t.fetch).toHaveBeenCalledTimes(4);
    expect(t.router.url).toBe('/login');
    expect(t.sync.syncNow).not.toHaveBeenCalled();
  });

  it('signs in once however often the form is submitted', async () => {
    const t = await setup();
    let answer = (_: Response): void => undefined;
    t.fetch.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await t.signIn('bo', 'pw');
    t.el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await vi.waitFor(() => expect(t.fetch).toHaveBeenCalledOnce());
    answer(json(200, bo));
    await vi.waitFor(() => expect(t.router.url).toBe('/'));
    expect(t.fetch).toHaveBeenCalledOnce();
  });

  it("login with a different user wipes the previous user's local data", async () => {
    const t = await setup(anna);
    await annasChange(t.db, true);
    await t.db.setMeta('cursor', 42);
    // the device's own settings stay
    await t.db.setMeta('theme', 'dark');
    t.fetch.mockResolvedValueOnce(json(200, bo));
    await t.signIn('bo', 'pw');
    await vi.waitFor(() => expect(t.router.url).toBe('/'));
    const [url, init] = t.fetch.mock.calls[0]!;
    expect(url).toBe('/api/auth/login');
    expect(JSON.parse(init!.body as string)).toEqual({ username: 'bo', password: 'pw' });
    expect(await t.db.getMeta('session')).toEqual({ userId: 'u2', username: 'bo', householdId: bo.householdId });
    expect(await t.db.outbox.count()).toBe(0);
    expect(await t.db.getMeta('cursor')).toBeUndefined();
    expect(await t.db.getMeta('theme')).toBe('dark');
    // home first, then the first sync
    expect(t.syncedAt).toEqual(['/']);
  });

  it("login as another user is refused while the previous user's changes are unsynced", async () => {
    const t = await setup(anna);
    await annasChange(t.db, false);
    await t.signIn('bo', 'pw');
    await vi.waitFor(() => expect(t.message()).toBe('Synka eller logga in som anna först'));
    expect(t.fetch).not.toHaveBeenCalled();
    expect(await t.db.outbox.count()).toBe(1);
    expect(await t.db.getMeta('session')).toEqual(anna);
    expect(t.router.url).toBe('/login');
  });
});
