import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, importProvidersFrom, provideAppInitializer, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatMenuHarness } from '@angular/material/menu/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { newId } from '@promus/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { version } from '../../../../../../package.json';
import en from '../../../i18n/en.json';
import sv from '../../../i18n/sv.json';
import { FETCH } from '../../core/api';
import { PromusDb } from '../../core/db';
import { registerIcons } from '../../core/icons';
import { ORIGIN } from '../../core/platform';
import { SessionService } from '../../core/session';
import { type SyncStatus, SyncService } from '../../core/sync.service';
import { SettingsPage } from './settings.page';

@Component({ template: '' })
class Blank {}

const html = document.documentElement;

async function setup() {
  const me = newId();
  const db = new PromusDb(`settings-${newId()}`);
  await db.setMeta('session', { userId: me, username: 'anna', householdId: newId() });
  const members = [
    { id: me, username: 'anna', role: 'owner' },
    { id: newId(), username: 'maja', role: 'member' },
  ];
  const fetch = vi.fn<typeof globalThis.fetch>(async (url) =>
    url === '/api/invites'
      ? new Response(JSON.stringify({ id: 'i1', token: 'tok', expiresAt: 1 }), { status: 201 })
      : new Response(JSON.stringify({ user: { id: me, username: 'anna' }, households: [{ id: 'h1', role: 'owner', members }] }), {
          status: 200,
        }),
  );
  const status = signal<SyncStatus>({ kind: 'idle', pending: 0, rejected: 0 });
  TestBed.configureTestingModule({
    providers: [
      { provide: PromusDb, useValue: db },
      { provide: FETCH, useValue: fetch },
      { provide: SyncService, useValue: { status, syncNow: vi.fn(async () => undefined) } },
      { provide: ORIGIN, useValue: 'https://promus.example' },
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      provideRouter([
        { path: '', component: Blank },
        { path: 'settings', component: SettingsPage },
        { path: 'settings/account', component: Blank },
        { path: 'settings/household', component: Blank },
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
  await TestBed.inject(SessionService).load();
  const harness = await RouterTestingHarness.create('/settings');
  const el: HTMLElement = harness.fixture.nativeElement;
  const loader = TestbedHarnessEnvironment.documentRootLoader(harness.fixture);
  const text = (selector: string) => el.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
  const pick = async (row: 'theme' | 'lang', item: string) => {
    const menu = await loader.getHarness(MatMenuHarness.with({ selector: `.${row}-row` }));
    await menu.clickItem({ text: item });
  };
  return { db, fetch, status, harness, el, loader, text, pick };
}

afterEach(() => {
  html.style.colorScheme = '';
  html.lang = '';
});

describe('SettingsPage', () => {
  it('the profile row shows your name and opens Account', async () => {
    const t = await setup();
    expect(t.text('h1')).toBe('Inställningar');
    expect(t.text('.profile .main')).toBe('anna');
    expect(t.text('.profile .sub')).toBe('Konto och utloggning');
    expect(t.el.querySelector('.profile')?.getAttribute('href')).toBe('/settings/account');
  });

  it('with a sync status, the profile row has the badge and says it in words', async () => {
    const t = await setup();
    t.status.set({ kind: 'idle', pending: 3, rejected: 0 });
    await t.harness.fixture.whenStable();
    expect(t.text('.profile .badge')).toBe('3');
    expect(t.text('.profile .sub')).toBe('3 osynkade ändringar');
  });

  it('the household row names everyone, you first', async () => {
    const t = await setup();
    await vi.waitFor(() => expect(t.text('.household-row .sub')).toBe('Du och maja'));
    expect(t.el.querySelector('.household-row')?.getAttribute('href')).toBe('/settings/household');
    expect(t.el.querySelectorAll('.household-row app-face').length).toBe(2);
  });

  it('Invite a friend shows a link to lists of their own', async () => {
    const t = await setup();
    expect(t.text('.friend-row .main')).toBe(sv.settings.friend);
    expect(t.text('.friend-row .sub')).toBe(sv.settings.friendHint);
    t.el.querySelector<HTMLButtonElement>('.friend-row')!.click();
    const sheet = () => document.querySelector('mat-bottom-sheet-container');
    await vi.waitFor(() => expect(sheet()?.textContent).toContain(sv.invite.ownIntro));
    expect(sheet()!.querySelector('h2')?.textContent).toBe(sv.invite.ownTitle);
    expect(sheet()!.textContent).toContain('https://promus.example/join#tok');
    const [, init] = t.fetch.mock.calls.find(([url]) => url === '/api/invites')!;
    expect(JSON.parse(init!.body as string)).toEqual({ ownHousehold: true });
  });

  it('theme changes in place from a menu', async () => {
    // the browser bar colours, as in index.html
    document.head.insertAdjacentHTML(
      'beforeend',
      '<meta name="theme-color" content="#22401A" media="(prefers-color-scheme: light)" data-scheme="light">' +
        '<meta name="theme-color" content="#0E1A09" media="(prefers-color-scheme: dark)" data-scheme="dark">',
    );
    const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
    const t = await setup();
    expect(t.text('.theme-row .val')).toBe('System');

    await t.pick('theme', 'Mörkt');
    expect(html.style.colorScheme).toBe('dark');
    expect(metas.map((m) => m.media)).toEqual(['not all', 'all']);
    expect(t.text('.theme-row .val')).toBe('Mörkt');
    await vi.waitFor(async () => expect(await t.db.getMeta('theme')).toBe('dark'));

    await t.pick('theme', 'Ljust');
    expect(html.style.colorScheme).toBe('light');
    expect(metas.map((m) => m.media)).toEqual(['all', 'not all']);

    await t.pick('theme', 'System');
    expect(html.style.colorScheme).toBe('light dark');
    expect(metas.map((m) => m.media)).toEqual(['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)']);
    await vi.waitFor(async () => expect(await t.db.getMeta('theme')).toBe('system'));
    for (const m of metas) m.remove();
  });

  it('language changes in place from a menu', async () => {
    const t = await setup();
    await t.pick('lang', 'English');
    await vi.waitFor(() => expect(t.text('h1')).toBe('Settings'));
    expect(html.lang).toBe('en');
    await vi.waitFor(async () => expect(await t.db.getMeta('lang')).toBe('en'));

    // System follows the browser
    const languages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['sv-SE']);
    await t.pick('lang', 'System');
    languages.mockRestore();
    await vi.waitFor(() => expect(t.text('h1')).toBe('Inställningar'));
    expect(html.lang).toBe('sv');
    await vi.waitFor(async () => expect(await t.db.getMeta('lang')).toBe('system'));
  });

  it('shows the app version', async () => {
    const t = await setup();
    expect(t.text('.version')).toBe(`Version ${version}`);
  });
});
