import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatButtonToggleHarness } from '@angular/material/button-toggle/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatInputHarness } from '@angular/material/input/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { newId } from '@promus/shared';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../i18n/en.json';
import sv from '../../../i18n/sv.json';
import { FETCH } from '../../core/api';
import { PromusDb } from '../../core/db';
import { ORIGIN, SECURE_CONTEXT } from '../../core/platform';
import { SyncService } from '../../core/sync.service';
import { SetupPage } from './setup.page';

@Component({ template: '' })
class Blank {}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const user = { id: 'u1', username: 'Anna' };

/** `setupAnswer` is what POST /api/setup returns; sign-in and the cookie check succeed. */
async function setup(setupAnswer: () => Response, secure = true) {
  const db = new PromusDb(`setup-${newId()}`);
  const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
    if (url === '/api/setup') return setupAnswer();
    if (url === '/api/auth/login') return json(200, { user, householdId: newId() });
    if (url === '/api/me') return json(200, { user, households: [] });
    throw new Error(`unexpected ${String(url)}`);
  });
  TestBed.configureTestingModule({
    providers: [
      { provide: PromusDb, useValue: db },
      { provide: FETCH, useValue: fetch },
      { provide: ORIGIN, useValue: 'https://promus.example' },
      { provide: SECURE_CONTEXT, useValue: secure },
      { provide: SyncService, useValue: { syncNow: vi.fn(async () => undefined) } },
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      provideRouter([
        { path: '', component: Blank },
        { path: 'login', component: Blank },
        { path: 'setup', component: SetupPage },
      ]),
      importProvidersFrom(
        TranslocoTestingModule.forRoot({
          langs: { sv, en },
          translocoConfig: { availableLangs: ['sv', 'en'], defaultLang: 'en', reRenderOnLangChange: true },
          preloadLangs: true,
        }),
      ),
    ],
  });
  const harness = await RouterTestingHarness.create('/setup');
  const loader = TestbedHarnessEnvironment.documentRootLoader(harness.fixture);
  const el: HTMLElement = harness.fixture.nativeElement;
  const router = TestBed.inject(Router);
  const field = (selector: string) => loader.getHarness(MatInputHarness.with({ selector }));
  const button = async (text: string) => (await loader.getHarness(MatButtonHarness.with({ text }))).click();
  /** Svenska, then the account step filled in and sent. */
  const create = async (code: string) => {
    await (await loader.getHarness(MatButtonToggleHarness.with({ text: 'Svenska' }))).check();
    await button('Nästa');
    await (await field('[autocomplete="one-time-code"]')).setValue(code);
    await (await field('[autocomplete="username"]')).setValue('Anna');
    await (await field('[autocomplete="new-password"]')).setValue('correct horse');
    await button('Skapa konto');
  };
  return { db, fetch, el, router, create, button };
}

describe('SetupPage', () => {
  it('creates the first account in the chosen language, signs in and ends on the phone step', async () => {
    const t = await setup(() => json(201, {}));
    await t.create('7kqm-p4x2');
    await vi.waitFor(() => expect(t.el.textContent).toContain(sv.phone.scan));
    const [, init] = t.fetch.mock.calls.find(([url]) => url === '/api/setup')!;
    expect(JSON.parse(init!.body as string)).toEqual({
      setupCode: '7kqm-p4x2', username: 'Anna', password: 'correct horse', locale: 'sv',
    });
    expect(await t.db.getMeta('session')).toMatchObject({ userId: 'u1' });
    expect(t.el.textContent).toContain('https://promus.example');
    await t.button('Klar');
    await vi.waitFor(() => expect(t.router.url).toBe('/'));
  });

  it('a wrong or outdated code is shown under the code field', async () => {
    const t = await setup(() => json(403, { error: 'setup_code_invalid' }));
    await t.create('AAAA-AAAA');
    await vi.waitFor(() => expect(t.el.querySelector('mat-error')?.textContent).toContain(sv.setup.codeInvalid));
    expect(t.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/setup']);
  });

  it('a server that is set up already sends you to sign in', async () => {
    const t = await setup(() => json(409, { error: 'already_set_up' }));
    await t.create('7KQM-P4X2');
    await vi.waitFor(() => expect(t.router.url).toBe('/login'));
  });

  it('over plain HTTP, shows what to do instead of a form', async () => {
    const t = await setup(() => json(201, {}), false);
    expect(t.el.textContent).toContain(en.https.needed);
    expect(t.el.querySelector('form')).toBeNull();
    expect(t.el.querySelector('mat-button-toggle')).toBeNull();
  });
});
