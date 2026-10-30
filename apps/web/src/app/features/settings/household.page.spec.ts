import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { importProvidersFrom, provideAppInitializer, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatMenuItemHarness } from '@angular/material/menu/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSnackBarHarness } from '@angular/material/snack-bar/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { newId } from '@promus/shared';
import { describe, expect, it, vi } from 'vitest';
import sv from '../../../i18n/sv.json';
import { FETCH } from '../../core/api';
import { Household } from '../../core/household';
import { PromusDb } from '../../core/db';
import { registerIcons } from '../../core/icons';
import { ORIGIN } from '../../core/platform';
import { SessionService } from '../../core/session';
import { StartOver } from '../../core/start-over';
import { Store } from '../../core/store';
import { SyncService } from '../../core/sync.service';
import { HouseholdPage } from './household.page';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Options = { origin?: string; userId?: string; pending?: number; restore?: Response; removeFails?: boolean };

async function setup({ origin = 'https://promus.example', userId = 'u1', pending = 0, restore, removeFails }: Options = {}) {
  const db = new PromusDb(`household-${newId()}`);
  await db.setMeta('session', { userId, username: userId === 'u1' ? 'anna' : 'bo', householdId: 'h1' });
  const sync = { syncNow: vi.fn(async () => {}), start: vi.fn(), stop: vi.fn() };
  const startOver = { run: vi.fn(async () => {}) };
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    if (url === '/api/me') {
      const members = [
        { id: 'u1', username: 'anna', role: 'owner', former: false },
        { id: 'u2', username: 'bo', role: 'member', former: false },
        { id: 'u3', username: 'cy', role: 'member', former: true },
      ];
      return json(200, { user: { id: 'u1', username: 'anna' }, households: [{ id: 'h1', role: 'owner', members }] });
    }
    if (url === '/api/invites' && init?.method === 'POST') return json(201, { id: 'i1', token: 'tok', expiresAt: 1 });
    if (url === '/api/invites/i1' && init?.method === 'DELETE') return new Response(null, { status: 204 });
    if (url === '/api/households/h1/members/u2' && init?.method === 'DELETE') {
      if (removeFails) throw new TypeError('offline');
      return new Response(null, { status: 204 });
    }
    if (url === '/api/households/h1/members/u2/restore' && init?.method === 'POST') {
      return restore ?? new Response(null, { status: 204 });
    }
    throw new Error(`unexpected ${String(url)}`);
  });
  TestBed.configureTestingModule({
    providers: [
      { provide: PromusDb, useValue: db },
      { provide: FETCH, useValue: fetch },
      { provide: ORIGIN, useValue: origin },
      { provide: SyncService, useValue: sync },
      { provide: StartOver, useValue: startOver },
      { provide: Store, useValue: { pendingCount: signal(pending) } },
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
  const fixture = TestBed.createComponent(HouseholdPage);
  fixture.detectChanges();
  const el: HTMLElement = fixture.nativeElement;
  const root = TestbedHarnessEnvironment.documentRootLoader(fixture);
  const invite = async () => (await root.getHarness(MatButtonHarness.with({ text: sv.settings.invite }))).click();
  const sheet = () => document.querySelector('mat-bottom-sheet-container');
  return { db, fetch, el, root, invite, sheet, sync, startOver, fixture };
}

// the face is only decoration, so a row reads as its name and role
const row = (li: Element | null | undefined) =>
  [...(li?.querySelectorAll('.name, .role') ?? [])].map((e) => e.textContent?.trim()).join(' ');

describe('HouseholdPage', () => {
  it('lists the members', async () => {
    const t = await setup();
    await vi.waitFor(() => expect(t.el.textContent).toContain('bo'));
    expect([...t.el.querySelectorAll('li')].map(row)).toEqual(['anna Du', 'bo']);
  });

  it('lists current members only', async () => {
    const t = await setup();
    await vi.waitFor(() => expect(t.el.querySelectorAll('li').length).toBe(2));
    expect(t.el.textContent).not.toContain('cy');
    expect(TestBed.inject(Household).person('u3')?.name).toBe('cy');
  });

  const hold = (el: Element | null | undefined) =>
    el?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  const menu = () => document.querySelector('.mat-mdc-menu-panel');
  const bo = (t: Awaited<ReturnType<typeof setup>>) => t.el.querySelectorAll('li .row')[1];
  const remove = async (t: Awaited<ReturnType<typeof setup>>) => {
    await vi.waitFor(() => expect(t.el.querySelectorAll('li').length).toBe(2));
    hold(bo(t));
    await vi.waitFor(() => expect(menu()).not.toBeNull());
    const item = await t.root.getHarness(MatMenuItemHarness.with({ text: new RegExp(sv.settings.removeMember) }));
    await item.click();
  };

  it('the owner holds a member to remove them, and Undo puts them back', async () => {
    const t = await setup();
    await remove(t);
    await vi.waitFor(() =>
      expect(t.fetch).toHaveBeenCalledWith('/api/households/h1/members/u2', expect.objectContaining({ method: 'DELETE' })),
    );
    const snack = await snackbar(t);
    expect(await snack.getMessage()).toBe(sv.snack.memberRemoved.replace('{{name}}', 'bo'));
    await snack.dismissWithAction();
    await vi.waitFor(() =>
      expect(t.fetch).toHaveBeenCalledWith(
        '/api/households/h1/members/u2/restore',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('Undo says when they have lists of their own', async () => {
    const t = await setup({ restore: json(409, { error: 'member_moved' }) });
    await remove(t);
    const snack = await snackbar(t);
    await snack.dismissWithAction();
    await vi.waitFor(async () => {
      const next = await t.root.getHarness(MatSnackBarHarness);
      expect(await next.getMessage()).toBe(sv.snack.memberMoved.replace('{{name}}', 'bo'));
    });
  });

  it('a tap on a member opens the menu too', async () => {
    const t = await setup();
    await vi.waitFor(() => expect(t.el.querySelectorAll('li').length).toBe(2));
    (bo(t) as HTMLElement).click();
    await vi.waitFor(() => expect(menu()?.textContent).toContain(sv.settings.removeMember));
  });

  it('only rows the owner can remove are buttons', async () => {
    const t = await setup();
    await vi.waitFor(() => expect(t.el.querySelectorAll('li').length).toBe(2));
    expect([...t.el.querySelectorAll('li .row')].map((r) => r.tagName)).toEqual(['DIV', 'BUTTON']);
  });

  it('no menu on your own row, nor for a member', async () => {
    const owner = await setup();
    await vi.waitFor(() => expect(owner.el.querySelectorAll('li').length).toBe(2));
    hold(owner.el.querySelector('li .row'));
    await owner.fixture.whenStable();
    expect(menu()).toBeNull();
  });

  it('no menu for a member holding the owner', async () => {
    const t = await setup({ userId: 'u2' });
    await vi.waitFor(() => expect(t.el.querySelectorAll('li').length).toBe(2));
    hold(t.el.querySelector('li .row'));
    await t.fixture.whenStable();
    expect(menu()).toBeNull();
  });

  const snackbar = (t: Awaited<ReturnType<typeof setup>>) =>
    vi.waitFor(() => t.root.getHarness(MatSnackBarHarness), { timeout: 3000 });

  const leave = async (t: Awaited<ReturnType<typeof setup>>) => {
    await vi.waitFor(() => expect(t.el.querySelectorAll('li').length).toBe(2));
    await (await t.root.getHarness(MatButtonHarness.with({ text: sv.settings.leave }))).click();
  };

  it('a member leaves, and Undo keeps them in', async () => {
    const t = await setup({ userId: 'u2' });
    await leave(t);
    await vi.waitFor(() => expect(t.sync.stop).toHaveBeenCalled());
    expect(t.fetch).toHaveBeenCalledWith('/api/households/h1/members/u2', expect.objectContaining({ method: 'DELETE' }));
    const snack = await snackbar(t);
    expect(await snack.getMessage()).toBe(sv.snack.left.replace('{{owner}}', 'anna'));
    await snack.dismissWithAction();
    await vi.waitFor(() => expect(t.sync.start).toHaveBeenCalled());
    expect(t.startOver.run).not.toHaveBeenCalled();
  });

  it('a member leaves, and once the snackbar is gone, starts over', async () => {
    const t = await setup({ userId: 'u2' });
    await leave(t);
    await snackbar(t);
    TestBed.inject(MatSnackBar).dismiss();
    await vi.waitFor(() => expect(t.startOver.run).toHaveBeenCalledWith('left'));
  });

  it('Leave is disabled while changes are unsynced', async () => {
    const t = await setup({ userId: 'u2', pending: 1 });
    await vi.waitFor(() => expect(t.el.querySelectorAll('li').length).toBe(2));
    const button = await t.root.getHarness(MatButtonHarness.with({ text: sv.settings.leave }));
    expect(await button.isDisabled()).toBe(true);
    expect(t.el.textContent).toContain(sv.settings.pending.one.replace('{{n}}', '1'));
  });

  it('a second tap on Leave does nothing', async () => {
    const t = await setup({ userId: 'u2' });
    await leave(t);
    const button = await t.root.getHarness(MatButtonHarness.with({ text: sv.settings.leave }));
    expect(await button.isDisabled()).toBe(true);
    await button.click();
    await snackbar(t);
    const deletes = t.fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE');
    expect(deletes.length).toBe(1);
    expect(t.startOver.run).not.toHaveBeenCalledWith('removed');
  });

  it('a failed Undo on Leave starts over, then says so', async () => {
    const t = await setup({ userId: 'u2', restore: json(500, { error: 'boom' }) });
    await leave(t);
    await (await snackbar(t)).dismissWithAction();
    await vi.waitFor(() => expect(t.startOver.run).toHaveBeenCalledWith('left'));
    await vi.waitFor(async () => {
      expect(await (await t.root.getHarness(MatSnackBarHarness)).getMessage()).toBe(sv.errors.actionFailed);
    });
  });

  it('leaving after being removed meanwhile does nothing', async () => {
    const t = await setup({ userId: 'u2' });
    const session = TestBed.inject(SessionService);
    t.sync.syncNow.mockImplementation(async () => {
      await t.db.setMeta('session', { userId: 'u2', username: 'bo', householdId: 'h2' });
      await session.load();
    });
    await leave(t);
    await vi.waitFor(() => expect(t.sync.syncNow).toHaveBeenCalled());
    await t.fixture.whenStable();
    expect(t.fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);
    expect(t.startOver.run).not.toHaveBeenCalled();
  });

  it('leaving offline changes nothing', async () => {
    const t = await setup({ userId: 'u2', removeFails: true });
    await leave(t);
    const snack = await snackbar(t);
    expect(await snack.getMessage()).toBe(sv.errors.actionFailed);
    expect(t.sync.start).toHaveBeenCalled();
    expect(t.startOver.run).not.toHaveBeenCalled();
  });

  it('marks you', async () => {
    const t = await setup();
    await vi.waitFor(() => expect(t.el.querySelectorAll('li').length).toBe(2));
    expect(row(t.el.querySelector('li'))).toBe('anna Du');
    expect(t.el.textContent).toContain(sv.settings.householdIntro);
  });

  it('creates an invite, shows its link as a QR code, and undo revokes it', async () => {
    const t = await setup();
    await t.invite();
    await vi.waitFor(() => expect(t.sheet()?.textContent).toContain('https://promus.example/join#tok'));
    expect(t.sheet()!.querySelector('app-qr-code')).not.toBeNull();
    expect(t.sheet()!.textContent).toContain(sv.invite.copy);
    const snack = await snackbar(t);
    expect(await snack.getMessage()).toBe(sv.snack.inviteCreated);
    await snack.dismissWithAction();
    await vi.waitFor(() =>
      expect(t.fetch).toHaveBeenCalledWith('/api/invites/i1', expect.objectContaining({ method: 'DELETE' })),
    );
    await vi.waitFor(() => expect(t.sheet()).toBeNull());
  });

  it('invites to this household', async () => {
    const t = await setup();
    const body = () => JSON.parse(t.fetch.mock.calls.find(([url]) => url === '/api/invites')![1]!.body as string);
    await t.invite();
    await vi.waitFor(() => expect(t.sheet()?.textContent).toContain(sv.invite.intro));
    expect(body()).toEqual({ ownHousehold: false });
  });

  it('on localhost, the sheet explains instead of showing a QR code', async () => {
    const t = await setup({ origin: 'http://localhost:8080' });
    await t.invite();
    await vi.waitFor(() => expect(t.sheet()?.textContent).toContain(sv.phone.local));
    expect(t.sheet()!.querySelector('app-qr-code')).toBeNull();
  });
});
