import { Clipboard } from '@angular/cdk/clipboard';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { importProvidersFrom, provideAppInitializer } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatSnackBarHarness } from '@angular/material/snack-bar/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { newId } from '@promus/shared';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import sv from '../../../i18n/sv.json';
import { FETCH } from '../../core/api';
import { PromusDb } from '../../core/db';
import { registerIcons } from '../../core/icons';
import { ORIGIN } from '../../core/platform';
import { ShareSheet, type ShareSheetData } from './share-sheet';

const LINK = 'https://promus.example/share#tok';

function setup(restore = 204) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    if (url === '/api/shares' && init?.method === 'GET') return Response.json({ shares: [], guests: [] });
    if (url === '/api/shares/s1' && init?.method === 'DELETE') return new Response(null, { status: 204 });
    if (url === '/api/shares/s1/restore' && init?.method === 'POST')
      return restore === 204 ? new Response(null, { status: 204 }) : Response.json({ error: 'share_invalid' }, { status: restore });
    throw new Error(`unexpected ${init?.method} ${String(url)}`);
  });
  const ref = { dismiss: vi.fn() };
  const data: ShareSheetData = {
    listName: 'Tacokväll',
    share: { id: 's1', listId: newId(), token: 'tok', expiresAt: new Date(2026, 10, 9, 18, 2).getTime(), createdBy: 'u1' },
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: PromusDb, useValue: new PromusDb(`share-${newId()}`) },
      { provide: FETCH, useValue: fetch },
      { provide: ORIGIN, useValue: 'https://promus.example' },
      { provide: MAT_BOTTOM_SHEET_DATA, useValue: data },
      { provide: MatBottomSheetRef, useValue: ref },
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
  const fixture = TestBed.createComponent(ShareSheet);
  fixture.detectChanges();
  const el: HTMLElement = fixture.nativeElement;
  const loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
  const button = (text: string) => loader.getHarness(MatButtonHarness.with({ text: new RegExp(text) }));
  return { fetch, ref, el, loader, button };
}

const called = (fetch: ReturnType<typeof setup>['fetch'], url: string, method: string) =>
  expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ method }));

describe('ShareSheet', () => {
  it('shows the link as a QR code and an address, and until when it works', () => {
    const { el } = setup();
    expect(el.querySelector('h2')?.textContent).toBe('Dela Tacokväll');
    expect(el.textContent).toContain(sv.share.intro);
    expect(el.querySelector('app-qr-code svg')?.getAttribute('aria-label')).toBe(LINK);
    expect(el.querySelector('.url')?.textContent?.trim()).toBe(LINK);
    expect(el.querySelector('.until span')?.textContent?.trim()).toBe('Fungerar till mån 9 nov.');
  });

  it('Copy puts the link on the clipboard', async () => {
    const t = setup();
    const copy = vi.spyOn(TestBed.inject(Clipboard), 'copy').mockReturnValue(true);
    await (await t.button(sv.share.copy)).click();
    expect(copy).toHaveBeenCalledWith(LINK);
    expect(await (await t.loader.getHarness(MatSnackBarHarness)).getMessage()).toBe(sv.snack.copied);
  });

  it('Share opens the phone\'s share menu, and is hidden where there is none', async () => {
    expect(await setup().loader.getAllHarnesses(MatButtonHarness.with({ text: sv.share.share }))).toEqual([]);

    TestBed.resetTestingModule();
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    onTestFinished(() => {
      delete (navigator as { share?: unknown }).share;
    });
    const t = setup();
    await (await t.loader.getHarness(MatButtonHarness.with({ text: sv.share.share }))).click();
    expect(share).toHaveBeenCalledWith({ url: LINK });
  });

  it('End link ends it, and Undo brings it back', async () => {
    const t = setup();
    await (await t.button(sv.share.end)).click();
    expect(t.ref.dismiss).toHaveBeenCalled();
    await vi.waitFor(() => called(t.fetch, '/api/shares/s1', 'DELETE'));
    const snack = await t.loader.getHarness(MatSnackBarHarness);
    expect(await snack.getMessage()).toBe(sv.snack.shareEnded);
    await snack.dismissWithAction();
    await vi.waitFor(() => called(t.fetch, '/api/shares/s1/restore', 'POST'));
  });

  it('a link that can\'t come back says the change failed', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    onTestFinished(() => log.mockRestore());
    const t = setup(404);
    await (await t.button(sv.share.end)).click();
    const ended = await t.loader.getHarness(MatSnackBarHarness);
    expect(await ended.getMessage()).toBe(sv.snack.shareEnded);
    await ended.dismissWithAction();
    await vi.waitFor(async () =>
      expect(await (await t.loader.getHarness(MatSnackBarHarness)).getMessage()).toBe(sv.errors.actionFailed),
    );
    expect(log).toHaveBeenCalled();
  });
});
