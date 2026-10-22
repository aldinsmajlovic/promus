import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, importProvidersFrom, provideAppInitializer } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatButtonToggleGroupHarness } from '@angular/material/button-toggle/testing';
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
import { SessionService } from '../../core/session';
import { Store } from '../../core/store';
import { SettingsPage } from './settings.page';

@Component({ template: '' })
class Blank {}

const html = document.documentElement;

async function setup() {
  const db = new PromusDb(`settings-${newId()}`);
  await db.setMeta('session', { userId: newId(), username: 'anna', householdId: newId() });
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
  TestBed.configureTestingModule({
    providers: [
      { provide: PromusDb, useValue: db },
      { provide: FETCH, useValue: fetch },
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      provideRouter([
        { path: '', component: Blank },
        { path: 'settings', component: SettingsPage },
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
  const harness = await RouterTestingHarness.create('/settings');
  const el: HTMLElement = harness.fixture.nativeElement;
  const loader = TestbedHarnessEnvironment.documentRootLoader(harness.fixture);
  const text = (selector: string) => el.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
  const toggle = async (group: 'lang' | 'theme', text: string) => {
    const selector = `[aria-labelledby="${group}"]`;
    const toggles = await loader.getHarness(MatButtonToggleGroupHarness.with({ selector }));
    const [found] = await toggles.getToggles({ text });
    return found!;
  };
  const signOut = () => loader.getHarness(MatButtonHarness.with({ text: 'Logga ut' }));
  return { db, store, fetch, harness, el, loader, text, toggle, signOut, router: TestBed.inject(Router) };
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

describe('SettingsPage', () => {
  it('shows the signed-in user and the app version', async () => {
    const t = await setup();
    expect(t.text('h1')).toBe('Inställningar');
    expect(t.text('.user')).toBe('anna');
    expect(t.text('.version')).toBe('Version 0.1.0');
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
    t.el.querySelector<HTMLButtonElement>('.account button')!.click();
    await expect(logout.mock.results[0]!.value).rejects.toBeInstanceOf(PendingChangesError);
    await vi.waitFor(() => expect(t.text('.pending')).toBe('1 osynkad ändring'));
    expect(await button.isDisabled()).toBe(true);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
    expect(t.router.url).toBe('/settings');
    expect(t.fetch).not.toHaveBeenCalled();
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

  it('changing theme sets color-scheme on the document', async () => {
    // the browser bar colours, as in index.html
    document.head.insertAdjacentHTML(
      'beforeend',
      '<meta name="theme-color" content="#F9FAEF" media="(prefers-color-scheme: light)" data-scheme="light">' +
        '<meta name="theme-color" content="#12140E" media="(prefers-color-scheme: dark)" data-scheme="dark">',
    );
    const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
    const t = await setup();
    expect(await (await t.toggle('theme', 'System')).isChecked()).toBe(true);

    await (await t.toggle('theme', 'Mörkt')).check();
    expect(html.style.colorScheme).toBe('dark');
    expect(metas.map((m) => m.media)).toEqual(['not all', 'all']);
    await vi.waitFor(async () => expect(await t.db.getMeta('theme')).toBe('dark'));

    await (await t.toggle('theme', 'Ljust')).check();
    expect(html.style.colorScheme).toBe('light');
    expect(metas.map((m) => m.media)).toEqual(['all', 'not all']);

    await (await t.toggle('theme', 'System')).check();
    expect(html.style.colorScheme).toBe('light dark');
    expect(metas.map((m) => m.media)).toEqual(['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)']);
    await vi.waitFor(async () => expect(await t.db.getMeta('theme')).toBe('system'));
    for (const m of metas) m.remove();
  });

  it('changing language translates the page and sets the html lang', async () => {
    const t = await setup();
    await (await t.toggle('lang', 'English')).check();
    await vi.waitFor(() => expect(t.text('h1')).toBe('Settings'));
    expect(html.lang).toBe('en');
    await vi.waitFor(async () => expect(await t.db.getMeta('lang')).toBe('en'));

    // System follows the browser
    const languages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['sv-SE']);
    await (await t.toggle('lang', 'System')).check();
    languages.mockRestore();
    await vi.waitFor(() => expect(t.text('h1')).toBe('Inställningar'));
    expect(html.lang).toBe('sv');
    await vi.waitFor(async () => expect(await t.db.getMeta('lang')).toBe('system'));
  });
});
