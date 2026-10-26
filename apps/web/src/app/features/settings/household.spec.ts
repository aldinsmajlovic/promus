import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { importProvidersFrom, provideAppInitializer } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatSnackBarHarness } from '@angular/material/snack-bar/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, expect, it, vi } from 'vitest';
import sv from '../../../i18n/sv.json';
import { FETCH } from '../../core/api';
import { registerIcons } from '../../core/icons';
import { ORIGIN } from '../../core/platform';
import { HouseholdSection } from './household';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function setup(origin = 'https://promus.example') {
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    if (url === '/api/me') {
      const members = [{ id: 'u1', username: 'anna', role: 'owner' }, { id: 'u2', username: 'bo', role: 'member' }];
      return json(200, { user: { id: 'u1', username: 'anna' }, households: [{ id: 'h1', role: 'owner', members }] });
    }
    if (url === '/api/invites' && init?.method === 'POST') return json(201, { id: 'i1', token: 'tok', expiresAt: 1 });
    if (url === '/api/invites/i1' && init?.method === 'DELETE') return new Response(null, { status: 204 });
    throw new Error(`unexpected ${String(url)}`);
  });
  TestBed.configureTestingModule({
    providers: [
      { provide: FETCH, useValue: fetch },
      { provide: ORIGIN, useValue: origin },
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
  const fixture = TestBed.createComponent(HouseholdSection);
  fixture.detectChanges();
  const el: HTMLElement = fixture.nativeElement;
  const root = TestbedHarnessEnvironment.documentRootLoader(fixture);
  const invite = async () => (await root.getHarness(MatButtonHarness.with({ text: sv.settings.invite }))).click();
  const sheet = () => document.querySelector('mat-bottom-sheet-container');
  return { fetch, el, root, invite, sheet };
}

describe('HouseholdSection', () => {
  it('lists the members', async () => {
    const t = await setup();
    await vi.waitFor(() => expect(t.el.textContent).toContain('bo'));
    expect([...t.el.querySelectorAll('li')].map((li) => li.textContent?.trim())).toEqual(['anna', 'bo']);
  });

  it('creates an invite, shows its link as a QR code, and undo revokes it', async () => {
    const t = await setup();
    await t.invite();
    await vi.waitFor(() => expect(t.sheet()?.textContent).toContain('https://promus.example/join#tok'));
    expect(t.sheet()!.querySelector('app-qr-code')).not.toBeNull();
    expect(t.sheet()!.textContent).toContain(sv.invite.copy);
    const snack = await t.root.getHarness(MatSnackBarHarness);
    expect(await snack.getMessage()).toBe(sv.snack.inviteCreated);
    await snack.dismissWithAction();
    await vi.waitFor(() =>
      expect(t.fetch).toHaveBeenCalledWith('/api/invites/i1', expect.objectContaining({ method: 'DELETE' })),
    );
    await vi.waitFor(() => expect(t.sheet()).toBeNull());
  });

  it('on localhost, the sheet explains instead of showing a QR code', async () => {
    const t = await setup('http://localhost:8080');
    await t.invite();
    await vi.waitFor(() => expect(t.sheet()?.textContent).toContain(sv.phone.local));
    expect(t.sheet()!.querySelector('app-qr-code')).toBeNull();
  });
});
