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
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    new Response(JSON.stringify({ user: { id: me, username: 'anna' }, households: [{ id: 'h1', role: 'owner', members }] }), {
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
  return { db, status, harness, el, loader, text, pick };
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

  it('theme changes in place from a menu', async () => {
    const t = await setup();
    expect(t.text('.theme-row .val')).toBe('System');
    await t.pick('theme', 'Mörkt');
    expect(html.style.colorScheme).toBe('dark');
    expect(t.text('.theme-row .val')).toBe('Mörkt');
    await vi.waitFor(async () => expect(await t.db.getMeta('theme')).toBe('dark'));
  });

  it('language changes in place from a menu', async () => {
    const t = await setup();
    await t.pick('lang', 'English');
    await vi.waitFor(() => expect(t.text('h1')).toBe('Settings'));
    expect(html.lang).toBe('en');
    await vi.waitFor(async () => expect(await t.db.getMeta('lang')).toBe('en'));
  });

  it('shows the app version', async () => {
    const t = await setup();
    expect(t.text('.version')).toBe(`Version ${version}`);
  });
});
