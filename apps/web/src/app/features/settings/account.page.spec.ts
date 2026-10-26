import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, importProvidersFrom, provideAppInitializer, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { formatHlc, makeEvent, newId } from '@promus/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../../i18n/en.json';
import sv from '../../../i18n/sv.json';
import { FETCH } from '../../core/api';
import { PendingChangesError, PromusDb } from '../../core/db';
import { DexieSyncStorage } from '../../core/dexie-storage';
import { registerIcons } from '../../core/icons';
import { ORIGIN } from '../../core/platform';
import { SessionService } from '../../core/session';
import { Store } from '../../core/store';
import { type SyncStatus, SyncService } from '../../core/sync.service';
import { AccountPage } from './account.page';

@Component({ template: '' })
class Blank {}

const html = document.documentElement;

async function setup() {
  const db = new PromusDb(`account-${newId()}`);
  await db.setMeta('session', { userId: newId(), username: 'anna', householdId: newId() });
  const fetch = vi.fn<typeof globalThis.fetch>(async (url) =>
    url === '/api/me'
      ? new Response(JSON.stringify({ user: { id: 'u1', username: 'anna' }, households: [] }), { status: 200 })
      : new Response(null, { status: 204 }),
  );
  const status = signal<SyncStatus>({ kind: 'idle', pending: 0, rejected: 0 });
  const sync = { status, syncNow: vi.fn(async () => undefined), soon: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: SyncService, useValue: sync },
      { provide: PromusDb, useValue: db },
      { provide: FETCH, useValue: fetch },
      { provide: ORIGIN, useValue: 'https://promus.example' },
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      provideRouter([
        { path: '', component: Blank },
        { path: 'settings/account', component: AccountPage },
        { path: 'login', component: Blank },
      ]),
      provideAppInitializer(registerIcons),
      importProvidersFrom(
        TranslocoTestingModule.forRoot({
          langs: { sv, en },
          translocoConfig: { availableLangs: ['sv', 'en'], defaultLang: 'sv', reRenderOnLangChange: true },
          preloadLangs: true,
        }),
      ),
    ],
  });
  const store = TestBed.inject(Store);
  await store.load();
  await TestBed.inject(SessionService).load();
  const harness = await RouterTestingHarness.create('/settings/account');
  const el: HTMLElement = harness.fixture.nativeElement;
  const loader = TestbedHarnessEnvironment.documentRootLoader(harness.fixture);
  const text = (selector: string) => el.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
  const signOut = () => loader.getHarness(MatButtonHarness.with({ text: 'Logga ut' }));
  return { db, store, fetch, sync, harness, el, loader, text, signOut, router: TestBed.inject(Router) };
}

/** Marks every queued change as accepted by the server. */
async function synced(db: PromusDb) {
  const ids = (await db.outbox.toArray()).map((r) => r.id);
  await new DexieSyncStorage(db).markPushed(ids);
}

afterEach(() => {
  html.style.colorScheme = '';
  html.lang = '';
});

describe('AccountPage', () => {
  it('shows who you are', async () => {
    const t = await setup();
    expect(t.text('.user')).toBe('anna');
  });

  it('a sync error offers Retry', async () => {
    const t = await setup();
    t.sync.status.set({ kind: 'error', pending: 0, rejected: 0 });
    const retry = await t.loader.getHarness(MatButtonHarness.with({ text: 'Försök igen' }));
    await retry.click();
    expect(t.sync.syncNow).toHaveBeenCalledOnce();
    expect(t.text('.status')).toBe('Synkningen misslyckades');
  });

  it('signed out offers Sign in', async () => {
    const t = await setup();
    t.sync.status.set({ kind: 'auth', pending: 0, rejected: 0 });
    await t.harness.fixture.whenStable();
    expect(t.el.querySelector('a[href="/login"]')?.textContent).toContain('Logga in');
  });

  it('offline says the server is out of reach', async () => {
    const t = await setup();
    t.sync.status.set({ kind: 'offline', pending: 0, rejected: 0 });
    await t.harness.fixture.whenStable();
    expect(t.text('.status')).toBe('Kan inte nå servern');
  });

  it('sign out is disabled while changes are unsynced', async () => {
    const t = await setup();
    await t.store.createList('Inköpslista');
    await t.harness.fixture.whenStable();
    const button = await t.signOut();
    expect(await button.isDisabled()).toBe(true);
    expect(t.text('.pending')).toBe('1 osynkad ändring');
    await t.store.createList('Lidl');
    await t.harness.fixture.whenStable();
    expect(t.text('.pending')).toBe('2 osynkade ändringar');

    await synced(t.db);
    await vi.waitFor(async () => expect(await button.isDisabled()).toBe(false));
    // always there, so a screen reader announces the count when it appears
    expect(t.el.querySelector('.pending')?.getAttribute('aria-live')).toBe('polite');
    // :empty, so it takes no room
    expect(t.el.querySelector('.pending:empty')).not.toBeNull();
  });

  it('a change queued in another tab a moment before sign out keeps the session', async () => {
    const t = await setup();
    const button = await t.signOut();
    expect(await button.isDisabled()).toBe(false);
    const session = TestBed.inject(SessionService);
    const logout = vi.spyOn(session, 'logout');
    const log = vi.spyOn(console, 'error');
    // written straight to IndexedDB, as another tab would, and tapped before this tab has seen it
    const { householdId } = session.session()!;
    const hlc = formatHlc(Date.now(), 0, 'tab2');
    await new DexieSyncStorage(t.db).append([
      makeEvent('list.created', { listId: newId(), name: 'Lidl' }, { householdId, hlc, occurredAt: Date.now() }),
    ]);
    t.el.querySelector<HTMLButtonElement>('.signout')!.click();
    await expect(logout.mock.results[0]!.value).rejects.toBeInstanceOf(PendingChangesError);
    await vi.waitFor(() => expect(t.text('.pending')).toBe('1 osynkad ändring'));
    expect(await button.isDisabled()).toBe(true);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
    expect(t.router.url).toBe('/settings/account');
    expect(t.fetch.mock.calls.map(([url]) => url)).not.toContain('/api/auth/logout');
    expect(await t.db.getMeta('session')).toEqual(session.session());
    expect(await t.db.outbox.count()).toBe(1);
  });

  it('sign out wipes local data and goes to login', async () => {
    const t = await setup();
    await t.db.setMeta('theme', 'dark');
    await t.db.setMeta('lang', 'sv');
    await t.store.createList('Inköpslista');
    await synced(t.db);
    const button = await t.signOut();
    await vi.waitFor(async () => expect(await button.isDisabled()).toBe(false));
    await button.click();
    await vi.waitFor(() => expect(t.router.url).toBe('/login'));
    expect(t.fetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }));
    expect(await t.db.getMeta('session')).toBeUndefined();
    expect(await t.db.outbox.count()).toBe(0);
    expect(TestBed.inject(SessionService).session()).toBeNull();
    // they belong to the device, not the user
    expect(await t.db.getMeta('theme')).toBe('dark');
    expect(await t.db.getMeta('lang')).toBe('sv');
  });
});
