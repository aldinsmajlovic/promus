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
import en from '../../../i18n/en.json';
import sv from '../../../i18n/sv.json';
import { FETCH } from '../../core/api';
import { PromusDb, type Session } from '../../core/db';
import { DexieSyncStorage } from '../../core/dexie-storage';
import { SessionService } from '../../core/session';
import { SECURE_CONTEXT } from '../../core/platform';
import { SyncService, type SyncStatus } from '../../core/sync.service';
import { LoginPage } from './login.page';

@Component({ template: '' })
class Home {}

const anna: Session = { userId: 'u1', username: 'anna', householdId: newId() };
const bo = { user: { id: 'u2', username: 'bo' }, householdId: newId() };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
// what /api/me answers right after a sign-in, when the browser kept the cookie
const meOf = ({ user }: { user: { id: string; username: string } }) => json(200, { user, households: [] });

/** `home` guards the way to `/`, so a test can hold the navigation after signing in. */
async function setup(cached?: Session, home: () => Promise<boolean> | boolean = () => true, secure = true) {
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
      { provide: SECURE_CONTEXT, useValue: secure },
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      provideRouter([
        { path: '', component: Home, canActivate: [home] },
        { path: 'login', component: LoginPage },
      ]),
      importProvidersFrom(
        TranslocoTestingModule.forRoot({
          langs: { sv, en },
          translocoConfig: { availableLangs: ['sv', 'en'], defaultLang: 'sv', reRenderOnLangChange: true },
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
  return { db, fetch, sync, syncedAt, router, el, signIn, message, loader };
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
  it('the language switch translates the page', async () => {
    const t = await setup();
    await (await t.loader.getHarness(MatButtonHarness.with({ text: 'English' }))).click();
    await vi.waitFor(() => expect(t.el.querySelector('button[type="submit"]')?.textContent).toContain('Sign in'));
  });

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
    await vi.waitFor(() => expect(t.message()).toBe('Inloggningen misslyckades'));
    expect(log.mock.calls).toEqual([['login failed', expect.objectContaining({ code: 'internal' })]]);
    expect(log.mock.calls.every(([, err]) => err instanceof ApiError)).toBe(true);
    log.mockRestore();

    expect(t.fetch).toHaveBeenCalledTimes(4);
    expect(t.router.url).toBe('/login');
    expect(t.sync.syncNow).not.toHaveBeenCalled();
  });

  it('signs in once however often the form is submitted, until the page is left', async () => {
    let arrive = (_: boolean): void => undefined;
    const t = await setup(undefined, () => new Promise<boolean>((resolve) => (arrive = resolve)));
    // a submit that gets through calls login at once
    const login = vi.spyOn(TestBed.inject(SessionService), 'login');
    const submit = () => t.el.querySelector('form')!.dispatchEvent(new Event('submit'));
    let answer = (_: Response): void => undefined;
    const pending = new Promise<Response>((resolve) => (answer = resolve));
    t.fetch.mockImplementation(async (url) => (url === '/api/me' ? meOf(bo) : pending));
    const logins = () => t.fetch.mock.calls.filter(([url]) => url === '/api/auth/login');
    await t.signIn('bo', 'pw');
    // while the request runs
    submit();
    expect(login).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(logins()).toHaveLength(1));
    answer(json(200, bo));
    // signed in, and on the way home
    await vi.waitFor(async () => expect(await t.db.getMeta('session')).toMatchObject({ username: 'bo' }));
    await vi.waitFor(() => expect(t.router.currentNavigation()).not.toBeNull());
    submit();
    expect(login).toHaveBeenCalledOnce();
    arrive(true);
    await vi.waitFor(() => expect(t.router.url).toBe('/'));
    expect(logins()).toHaveLength(1);
  });

  it("login with a different user wipes the previous user's local data", async () => {
    const t = await setup(anna);
    await annasChange(t.db, true);
    await t.db.setMeta('cursor', 42);
    // the device's own settings stay
    await t.db.setMeta('theme', 'dark');
    t.fetch.mockResolvedValueOnce(json(200, bo)).mockResolvedValueOnce(meOf(bo));
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

  it('over plain HTTP, shows what to do instead of a form', async () => {
    const t = await setup(undefined, () => true, false);
    expect(t.el.textContent).toContain(sv.https.needed);
    expect(t.el.querySelector('form')).toBeNull();
  });

  it('a session cookie the browser dropped shows the HTTPS notice', async () => {
    const t = await setup();
    t.fetch.mockResolvedValueOnce(json(200, bo)).mockResolvedValueOnce(json(401, { error: 'unauthenticated' }));
    await t.signIn('bo', 'pw');
    await vi.waitFor(() => expect(t.el.textContent).toContain(sv.https.cookie));
    expect(t.el.querySelector('form')).toBeNull();
    expect(t.router.url).toBe('/login');
  });
});
