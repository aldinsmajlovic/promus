import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { importProvidersFrom, provideAppInitializer } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatMenuItemHarness } from '@angular/material/menu/testing';
import { MatSnackBarHarness } from '@angular/material/snack-bar/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { type ApiToken, newId } from '@promus/shared';
import { describe, expect, it, vi } from 'vitest';
import sv from '../../../i18n/sv.json';
import { FETCH } from '../../core/api';
import { PromusDb } from '../../core/db';
import { registerIcons } from '../../core/icons';
import { ORIGIN } from '../../core/platform';
import { SessionService } from '../../core/session';
import { AppsPage } from './apps.page';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const DAY = 86_400_000;

async function setup(tokens: ApiToken[]) {
  const db = new PromusDb(`apps-${newId()}`);
  await db.setMeta('session', { userId: 'u1', username: 'anna', householdId: 'h1' });
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    if (url === '/api/tokens' && init?.method === 'GET') return json(200, { tokens });
    if (url === '/api/tokens' && init?.method === 'POST') return json(201, { id: 't1', token: 'pr_example' });
    if (url === '/api/tokens/t1' && init?.method === 'DELETE') return new Response(null, { status: 204 });
    if (url === '/api/tokens/t1/restore' && init?.method === 'POST') return new Response(null, { status: 204 });
    throw new Error(`unexpected ${String(url)}`);
  });
  TestBed.configureTestingModule({
    providers: [
      { provide: PromusDb, useValue: db },
      { provide: FETCH, useValue: fetch },
      { provide: ORIGIN, useValue: 'https://promus.example' },
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
  await TestBed.inject(SessionService).load();
  const fixture = TestBed.createComponent(AppsPage);
  fixture.detectChanges();
  const el: HTMLElement = fixture.nativeElement;
  const root = TestbedHarnessEnvironment.documentRootLoader(fixture);
  const sheet = () => document.querySelector('mat-bottom-sheet-container');
  const snackbar = () => vi.waitFor(() => root.getHarness(MatSnackBarHarness), { timeout: 3000 });
  const button = (text: string) => root.getHarness(MatButtonHarness.with({ text }));
  return { fetch, el, root, sheet, snackbar, button };
}

const token = (over: Partial<ApiToken> = {}): ApiToken => ({
  id: 't1',
  name: 'Home Assistant',
  createdAt: 1,
  lastUsedAt: null,
  ...over,
});

const rows = (el: HTMLElement) =>
  [...el.querySelectorAll('li .row')].map(
    (r) => `${r.querySelector('.name')?.textContent?.trim()} · ${r.querySelector('.sub')?.textContent?.trim()}`,
  );

describe('AppsPage', () => {
  it('lists tokens with when they were last used', async () => {
    const t = await setup([token({ lastUsedAt: Date.now() }), token({ id: 't2', name: 'Old' })]);
    await vi.waitFor(() => expect(t.el.querySelectorAll('li').length).toBe(2));
    expect(rows(t.el)).toEqual([`Home Assistant · ${sv.apps.usedToday}`, `Old · ${sv.apps.neverUsed}`]);
  });

  it('says yesterday, and otherwise the date', async () => {
    const t = await setup([
      token({ lastUsedAt: Date.now() - DAY }),
      token({ id: 't2', name: 'Old', lastUsedAt: Date.now() - 30 * DAY }),
    ]);
    await vi.waitFor(() => expect(t.el.querySelectorAll('li').length).toBe(2));
    const [first, second] = rows(t.el);
    expect(first).toBe(`Home Assistant · ${sv.apps.usedYesterday}`);
    expect(second).toMatch(/^Old · Använd \d{1,2} \S+$/);
  });

  it('makes a token, shows it once, and Undo takes it back', async () => {
    const t = await setup([]);
    await (await t.button(sv.apps.connect)).click();
    await vi.waitFor(() => expect(t.sheet()).not.toBeNull());
    const input = t.sheet()!.querySelector('input')!;
    expect(input.maxLength).toBe(50);
    input.value = 'Home Assistant';
    input.dispatchEvent(new Event('input'));
    await (await t.button(sv.token.make)).click();
    await vi.waitFor(() =>
      expect(t.fetch).toHaveBeenCalledWith('/api/tokens', expect.objectContaining({ method: 'POST', body: '{"name":"Home Assistant"}' })),
    );
    await vi.waitFor(() => expect(t.sheet()?.textContent).toContain('pr_example'));
    expect(t.sheet()?.textContent).toContain('https://promus.example');
    const snack = await t.snackbar();
    expect(await snack.getMessage()).toBe(sv.snack.tokenMade);
    expect(await snack.getActionDescription()).toBe(sv.snack.undo);
    await snack.dismissWithAction();
    await vi.waitFor(() =>
      expect(t.fetch).toHaveBeenCalledWith('/api/tokens/t1', expect.objectContaining({ method: 'DELETE' })),
    );
    await vi.waitFor(() => expect(t.sheet()).toBeNull());
  });

  it('refuses an empty name without calling the server', async () => {
    const t = await setup([]);
    await (await t.button(sv.apps.connect)).click();
    await vi.waitFor(() => expect(t.sheet()).not.toBeNull());
    await (await t.button(sv.token.make)).click();
    await vi.waitFor(() => expect(t.sheet()?.textContent).toContain(sv.errors.nameEmpty));
    expect(t.fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toEqual([]);
  });

  it('disconnects with Undo', async () => {
    const t = await setup([token()]);
    await vi.waitFor(() => expect(t.el.querySelectorAll('li').length).toBe(1));
    t.el.querySelector<HTMLElement>('li .row')!.click();
    await vi.waitFor(() => expect(document.querySelector('.mat-mdc-menu-panel')).not.toBeNull());
    await (await t.root.getHarness(MatMenuItemHarness.with({ text: new RegExp(sv.apps.disconnect) }))).click();
    await vi.waitFor(() =>
      expect(t.fetch).toHaveBeenCalledWith('/api/tokens/t1', expect.objectContaining({ method: 'DELETE' })),
    );
    const snack = await t.snackbar();
    expect(await snack.getMessage()).toBe(sv.snack.appDisconnected.replace('{{name}}', 'Home Assistant'));
    await snack.dismissWithAction();
    await vi.waitFor(() =>
      expect(t.fetch).toHaveBeenCalledWith('/api/tokens/t1/restore', expect.objectContaining({ method: 'POST' })),
    );
  });
});
