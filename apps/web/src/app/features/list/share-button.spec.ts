import { Clipboard } from '@angular/cdk/clipboard';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { importProvidersFrom, provideAppInitializer, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatMenuHarness } from '@angular/material/menu/testing';
import { MatSnackBarHarness } from '@angular/material/snack-bar/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { type EntryView, type Share, newId } from '@promus/shared';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import sv from '../../../i18n/sv.json';
import { FETCH } from '../../core/api';
import { GUEST, PromusDb } from '../../core/db';
import { registerIcons } from '../../core/icons';
import { ORIGIN } from '../../core/platform';
import { SessionService } from '../../core/session';
import { SyncService, type SyncStatus } from '../../core/sync.service';
import { ShareButton, listText } from './share-button';

const link = (listId: string): Share => ({ id: 's1', listId, token: 'tok', expiresAt: Date.now() + 1000, createdBy: 'u1' });
const row = (name: string, set: Partial<EntryView> = {}): EntryView => ({
  itemId: newId(),
  name,
  note: null,
  checkedAt: null,
  addedBy: null,
  quantity: 1,
  price: null,
  checkedBy: null,
  ...set,
});
const ROWS = [row('Mjölk', { quantity: 2 }), row('Vispgrädde', { note: '3 dl', price: 2490 })];

async function setup(guest = false) {
  const db = new PromusDb(`share-${newId()}`);
  const listId = newId();
  // the list's live link, once made or set by a test; `fail` refuses to make one
  const live: { share: Share | null; fail?: 'offline' | 'not_found' } = { share: null };
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    if (url === '/api/shares' && init?.method === 'GET')
      return Response.json({ shares: live.share ? [live.share] : [], guests: [] });
    if (url === '/api/shares' && init?.method === 'POST') {
      if (live.fail === 'offline') throw new TypeError('Failed to fetch');
      if (live.fail === 'not_found') return Response.json({ error: 'not_found' }, { status: 404 });
      const made = live.share === null;
      live.share ??= link(JSON.parse(init.body as string).listId);
      return Response.json(live.share, { status: made ? 201 : 200 });
    }
    if (url === '/api/shares/s1' && init?.method === 'DELETE') {
      live.share = null;
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected ${init?.method} ${String(url)}`);
  });
  await db.setMeta('session', { userId: newId(), username: 'anna', householdId: newId() });
  const status = signal<SyncStatus>({ kind: 'idle', pending: 0, rejected: 0 });
  const syncNow = vi.fn(async () => undefined);
  TestBed.configureTestingModule({
    providers: [
      { provide: PromusDb, useValue: db },
      { provide: FETCH, useValue: fetch },
      { provide: ORIGIN, useValue: 'https://promus.example' },
      { provide: GUEST, useValue: guest ? { shareId: 's1' } : null },
      { provide: SyncService, useValue: { status, syncNow, soon: () => undefined } },
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
  const fixture = TestBed.createComponent(ShareButton);
  fixture.componentRef.setInput('list', { id: listId, name: 'Inköpslista' });
  fixture.componentRef.setInput('entries', ROWS);
  await fixture.whenStable();
  const loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
  const menu = await loader.getHarness(MatMenuHarness);
  return { listId, fixture, loader, menu, fetch, live, status, syncNow };
}

const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const items = () => [...document.querySelectorAll<HTMLElement>('.mat-mdc-menu-panel [role^="menuitem"]')];
const item = (label: RegExp) => items().find((i) => label.test(text(i)))!;
const sheet = () => document.querySelector('mat-bottom-sheet-container');

describe('listText', () => {
  it('is what is left to get under the list\'s name, plain or as a Markdown checklist', () => {
    expect(listText('Inköpslista', ROWS, 'text')).toBe('Inköpslista\n\nMjölk ×2\nVispgrädde (3 dl)');
    expect(listText('Inköpslista', ROWS, 'markdown')).toBe('# Inköpslista\n\n- [ ] Mjölk ×2\n- [ ] Vispgrädde (3 dl)');
  });
});

describe('ShareButton', () => {
  it('offers the link, then the list as text or Markdown', async () => {
    const t = await setup();
    await t.menu.open();
    expect(items().map((i) => text(i))).toEqual([sv.share.link, sv.share.copyText, sv.share.copyMarkdown]);
  });

  it('a guest can copy the list, but has no link to share', async () => {
    const t = await setup(true);
    await t.menu.open();
    expect(items().map((i) => text(i))).toEqual([sv.share.copyText, sv.share.copyMarkdown]);
  });

  it('copies what is left to get, and says so', async () => {
    const t = await setup();
    const copy = vi.spyOn(TestBed.inject(Clipboard), 'copy').mockReturnValue(true);
    await t.menu.open();
    item(/Markdown/).click();
    expect(copy).toHaveBeenCalledWith(listText('Inköpslista', ROWS, 'markdown'));
    expect(await (await t.loader.getHarness(MatSnackBarHarness)).getMessage()).toBe(sv.snack.listCopied);
  });

  it('sharing makes a link and shows it, and Undo ends it', async () => {
    const t = await setup();
    await t.menu.open();
    item(/^Dela länk/).click();
    await vi.waitFor(() => expect(sheet()?.textContent).toContain('https://promus.example/share#tok'));
    expect(sheet()?.getAttribute('aria-label')).toBe('Dela Inköpslista');
    const body = JSON.stringify({ listId: t.listId });
    expect(t.fetch).toHaveBeenCalledWith('/api/shares', expect.objectContaining({ method: 'POST', body }));
    const snackBar = await t.loader.getHarness(MatSnackBarHarness);
    expect(await snackBar.getMessage()).toBe('Länken skapad');
    await snackBar.dismissWithAction();
    await vi.waitFor(() => expect(sheet()).toBeNull());
    await vi.waitFor(() => expect(t.live.share).toBeNull());
  });

  it('sharing a shared list shows its link, with nothing to undo', async () => {
    const t = await setup();
    t.live.share = link(t.listId);
    await t.menu.open();
    item(/^Dela länk/).click();
    await vi.waitFor(() => expect(sheet()?.textContent).toContain('https://promus.example/share#tok'));
    expect(await t.loader.getAllHarnesses(MatSnackBarHarness)).toEqual([]);
  });

  it('Undo closes the link\'s sheet, also one opened again', async () => {
    const t = await setup();
    await t.menu.open();
    item(/^Dela länk/).click();
    await vi.waitFor(() => expect(sheet()).not.toBeNull());
    TestBed.inject(MatBottomSheet).dismiss();
    await vi.waitFor(() => expect(sheet()).toBeNull());
    await t.menu.open();
    item(/^Dela länk/).click();
    await vi.waitFor(() => expect(sheet()).not.toBeNull());
    await (await t.loader.getHarness(MatSnackBarHarness)).dismissWithAction();
    await vi.waitFor(() => expect(sheet()).toBeNull());
  });

  it('sharing syncs first while changes are waiting, so the server knows the list', async () => {
    const t = await setup();
    t.status.set({ kind: 'idle', pending: 2, rejected: 0 });
    // the server knows the list only once the sync has finished, not merely started
    t.live.fail = 'not_found';
    t.syncNow.mockImplementation(async () => {
      await Promise.resolve();
      t.live.fail = undefined;
    });
    await t.menu.open();
    item(/^Dela länk/).click();
    await vi.waitFor(() => expect(sheet()).not.toBeNull());
    expect(t.syncNow).toHaveBeenCalledOnce();
  });

  it('with nothing waiting, sharing doesn\'t sync first', async () => {
    const t = await setup();
    await t.menu.open();
    item(/^Dela länk/).click();
    await vi.waitFor(() => expect(sheet()).not.toBeNull());
    expect(t.syncNow).not.toHaveBeenCalled();
  });

  it.each(['offline', 'not_found'] as const)('a link that can\'t be made (%s) fails, and opens no sheet', async (fail) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    onTestFinished(() => log.mockRestore());
    const t = await setup();
    t.live.fail = fail;
    await t.menu.open();
    item(/^Dela länk/).click();
    await vi.waitFor(async () =>
      expect(await (await t.loader.getHarness(MatSnackBarHarness)).getMessage()).toBe(sv.errors.actionFailed),
    );
    expect(sheet()).toBeNull();
    expect(log).toHaveBeenCalled();
  });});
