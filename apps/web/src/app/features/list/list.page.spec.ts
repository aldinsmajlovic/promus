import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { importProvidersFrom, provideAppInitializer, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatBottomSheetHarness } from '@angular/material/bottom-sheet/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatActionListItemHarness } from '@angular/material/list/testing';
import { MatMenuHarness } from '@angular/material/menu/testing';
import { MatSnackBarHarness } from '@angular/material/snack-bar/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { type Member, type SharesResponse, type StoredEvent, entryKey, formatHlc, newId } from '@promus/shared';
import { describe, expect, it, vi } from 'vitest';
import sv from '../../../i18n/sv.json';
import { FETCH } from '../../core/api';
import { PromusDb } from '../../core/db';
import { Household } from '../../core/household';
import { WIDE } from '../../core/layout';
import { registerIcons } from '../../core/icons';
import { SessionService } from '../../core/session';
import { Shares } from '../../core/shares';
import { Store } from '../../core/store';
import { SyncService, type SyncStatus } from '../../core/sync.service';
import { ListPage } from './list.page';
import { untilDay } from './share-sheet';

function configure(db: PromusDb, wide = false) {
  const status = signal<SyncStatus>({ kind: 'idle', pending: 0, rejected: 0 });
  const sync = { status, syncNow: vi.fn(async () => undefined), soon: () => undefined };
  // the household's links and guests, as the server has them now, or once a test lets it answer
  const server: { shares: SharesResponse | Promise<SharesResponse> } = { shares: { shares: [], guests: [] } };
  // the page asks who's in the household; no household in the answer keeps the cached members
  const fetch = vi.fn<typeof globalThis.fetch>(async (url) =>
    url === '/api/shares'
      ? Response.json(await server.shares)
      : Response.json({ user: { id: 'u1', username: 'anna' }, households: [] }),
  );
  TestBed.configureTestingModule({
    providers: [
      { provide: PromusDb, useValue: db },
      { provide: SyncService, useValue: sync },
      { provide: FETCH, useValue: fetch },
      { provide: WIDE, useValue: signal(wide) },
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      provideRouter([]),
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
  return { sync, server, fetch };
}

/**
 * `others` are the household's members besides you, cached in meta `members` as the page finds them; `shares`
 * is what the server says of the household's links when the page opens.
 */
async function setup(
  items: [name: string, note?: string][] = [],
  others: string[] = [],
  wide = false,
  shares?: (listId: string) => SharesResponse | Promise<SharesResponse>,
) {
  const db = new PromusDb(`list-${newId()}`);
  const you: Member = { id: newId(), username: 'anna', role: 'owner' };
  const members = [you, ...others.map((username) => ({ id: newId(), username, role: 'member' }))];
  const householdId = newId();
  await db.setMeta('session', { userId: you.id, username: you.username, householdId });
  await db.setMeta('members', members);
  const { sync, server, fetch } = configure(db, wide);
  const store = TestBed.inject(Store);
  await TestBed.inject(SessionService).load();
  await store.load();
  const { listId } = await store.createList('Inköpslista');
  for (const [name, note] of items) {
    await store.addByName(listId, name);
    if (note) await store.setNote(listId, itemId(store, name), note);
  }
  if (shares) server.shares = shares(listId);
  const fixture = TestBed.createComponent(ListPage);
  await fixture.whenStable();
  const el: HTMLElement = fixture.nativeElement;
  const loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
  return { db, store, listId, fixture, el, loader, sync, server, fetch, members, householdId };
}

/** Puts `adds` on the list as pulled from the server, later than the local adds, so each names who added it. */
async function pull(t: Awaited<ReturnType<typeof setup>>, adds: [name: string, userId: string][]) {
  const later = Date.now() + 60_000;
  const events = adds.map(
    ([name, userId], i): StoredEvent => ({
      id: newId(),
      householdId: t.householdId,
      type: 'entry.added',
      v: 1,
      hlc: formatHlc(later + i, 0, 'other'),
      occurredAt: later + i,
      payload: { listId: t.listId, itemId: itemId(t.store, name) },
      seq: i + 1,
      userId,
      receivedAt: later + i,
    }),
  );
  await t.db.events.bulkAdd(events);
  await t.store.load();
}

/** The app starting again on this device: its services anew, over the same database. */
async function restart(db: PromusDb) {
  TestBed.resetTestingModule();
  configure(db);
  await TestBed.inject(SessionService).load();
  await TestBed.inject(Store).load();
}

function itemId(store: Store, name: string): string {
  const item = [...store.state().items.values()].find((i) => i.name === name);
  if (!item) throw new Error(`no item ${name}`);
  return item.id;
}

const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const rows = (el: HTMLElement, checked: boolean) =>
  [...el.querySelectorAll(`[role="checkbox"][aria-checked="${checked}"]`)] as HTMLElement[];
const row = (el: HTMLElement, name: string) => rows(el, false).find((r) => text(r.querySelector('.name')) === name)!;
const sharesAsked = (fetch: ReturnType<typeof configure>['fetch']) =>
  fetch.mock.calls.filter(([url]) => url === '/api/shares').length;
const names = (el: HTMLElement, checked = false) => rows(el, checked).map((r) => text(r.querySelector('.name')));
// the menu triggers carry aria-expanded too
const doneToggle = (el: HTMLElement) => el.querySelector<HTMLElement>('main [aria-expanded]');
const noteOf = (store: Store, listId: string, name: string) =>
  store.state().entries.get(entryKey(listId, itemId(store, name)))?.note;
/** The edit sheet's stepper button: Färre or Fler. */
const stepper = (label: string) => document.querySelector<HTMLButtonElement>(`.stepper [aria-label="${label}"]`)!;
/** A row's quantity and second line. */
const lines = (r: HTMLElement) => [text(r.querySelector('.qty')), text(r.querySelector('.note'))];

/** Opens Mjölk's edit sheet and sets its fields; a refused name keeps it open with the note saved. */
async function editMjolk(t: Awaited<ReturnType<typeof setup>>, values: { name?: string; note?: string; price?: string }) {
  t.el.querySelector<HTMLElement>('[aria-label="Alternativ för Mjölk"]')!.click();
  const sheet = await t.loader.getHarness(MatBottomSheetHarness);
  for (const [label, value] of [['Namn', values.name], ['Anteckning', values.note], ['Pris', values.price]] as const) {
    if (value === undefined) continue;
    const field = await sheet.getHarness(MatFormFieldHarness.with({ floatingLabelText: label }));
    await (await field.getControl(MatInputHarness))!.setValue(value);
  }
  return sheet;
}

describe('ListPage', () => {
  it('shows active items sorted the Swedish way', async () => {
    const { el } = await setup([['Ägg'], ['Mjölk'], ['Bananer'], ['Ost']]);
    expect(names(el)).toEqual(['Bananer', 'Mjölk', 'Ost', 'Ägg']);
  });

  it('tapping a row checks it and offers undo', async () => {
    const { el, fixture, loader } = await setup([['Mjölk'], ['Ost']]);
    rows(el, false)[0]!.click();
    await fixture.whenStable();
    expect(names(el)).toEqual(['Ost']);
    expect(text(doneToggle(el))).toBe('Klart (1)');

    const snackBar = await loader.getHarness(MatSnackBarHarness);
    expect(await snackBar.getMessage()).toBe('Mjölk avbockad');
    expect(await snackBar.getActionDescription()).toBe('Ångra');
    await snackBar.dismissWithAction();
    await fixture.whenStable();
    expect(names(el)).toEqual(['Mjölk', 'Ost']);
    expect(doneToggle(el)).toBeNull();
  });

  it('Done starts open; folding it is remembered on this device', async () => {
    const { db, el, fixture, store, listId } = await setup([['Mjölk'], ['Ost'], ['Smör']]);
    await store.check(listId, itemId(store, 'Mjölk'));
    await store.check(listId, itemId(store, 'Ost'));
    await fixture.whenStable();
    const toggle = doneToggle(el)!;
    expect(text(toggle)).toBe('Klart (2)');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(names(el, true).sort()).toEqual(['Mjölk', 'Ost']);

    rows(el, true).find((r) => text(r).includes('Ost'))!.click();
    await fixture.whenStable();
    expect(names(el)).toEqual(['Ost', 'Smör']);
    expect(text(toggle)).toBe('Klart (1)');

    toggle.click();
    await fixture.whenStable();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(rows(el, true)).toHaveLength(0);
    await vi.waitFor(async () => expect(await db.getMeta('doneFolded')).toBe(true));

    await restart(db);
    const again = TestBed.createComponent(ListPage);
    await again.whenStable();
    expect(doneToggle(again.nativeElement)!.getAttribute('aria-expanded')).toBe('false');
    expect(rows(again.nativeElement, true)).toHaveLength(0);
  });

  it('a fold that is not saved says so', async () => {
    const failed = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { db, el, fixture, store, listId, loader } = await setup([['Mjölk']]);
    await store.check(listId, itemId(store, 'Mjölk'));
    await fixture.whenStable();
    vi.spyOn(db, 'setMeta').mockRejectedValueOnce(new Error('disk full'));
    doneToggle(el)!.click();
    await fixture.whenStable();
    expect(doneToggle(el)!.getAttribute('aria-expanded')).toBe('false');
    expect(await (await loader.getHarness(MatSnackBarHarness)).getMessage()).toBe('Ändringen kunde inte sparas');
    expect(failed).toHaveBeenCalledWith('action failed', new Error('disk full'));
    failed.mockRestore();
  });

  it('rows only arrive once the whole list has shown, Done included', async () => {
    const t = await setup([['Mjölk'], ['Ost']]);
    await t.store.check(t.listId, itemId(t.store, 'Ost'));
    // a cold start: the list is loaded already; whether Done is folded is read only after it shows
    await restart(t.db);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const getMeta = t.db.getMeta.bind(t.db) as (key: string) => Promise<unknown>;
    const holdFolded = (key: string) => (key === 'doneFolded' ? held.then(() => getMeta(key)) : getMeta(key));
    const spy = vi.spyOn(t.db, 'getMeta').mockImplementation(holdFolded as never);
    const page = TestBed.createComponent(ListPage);
    // jsdom runs no animations, so ask the page which class an arriving row would get
    const arriving = () => page.componentInstance['arriving']();
    // the read is a pending task, so wait for the rows themselves
    await vi.waitFor(() => expect(names(page.nativeElement)).toEqual(['Mjölk']));
    expect(doneToggle(page.nativeElement)).toBeNull();
    expect(arriving()).toBe('');

    release();
    await page.whenStable();
    expect(names(page.nativeElement, true)).toEqual(['Ost']);
    expect(arriving()).toBe('arrive');
    spy.mockRestore();
  });

  it('back from Add or find, Done shows at once and its rows stay still', async () => {
    const t = await setup([['Mjölk'], ['Ost']]);
    await t.store.check(t.listId, itemId(t.store, 'Ost'));
    await t.fixture.whenStable();
    t.fixture.destroy();
    // read once, as the app started: the list page coming back doesn't read it again
    const getMeta = vi.spyOn(t.db, 'getMeta');
    const page = TestBed.createComponent(ListPage);
    // jsdom runs no animations, so ask the page which class an arriving row would get: none as it first renders
    expect(page.componentInstance['arriving']()).toBe('');
    page.detectChanges();
    // that first render had Done, so the list has shown in full: rows that come later arrive
    expect(names(page.nativeElement, true)).toEqual(['Ost']);
    expect(page.componentInstance['arriving']()).toBe('arrive');
    expect(getMeta).not.toHaveBeenCalledWith('doneFolded');
    getMeta.mockRestore();
  });

  it('a checked row leaves inert, so its focus can move on', async () => {
    const { fixture, store, listId } = await setup([['Mjölk']]);
    const page = fixture.componentInstance;
    const mjolk = page['view']().active[0]!;
    await store.check(listId, mjolk.itemId);
    await fixture.whenStable();
    const li = Object.assign(document.createElement('li'), { getAnimations: () => [] });
    page['leave']({ target: li, animationComplete: vi.fn() }, mjolk);
    expect(li.classList.contains('checked-off')).toBe(true);
    expect(li.hasAttribute('inert')).toBe(true);
    expect(li.hasAttribute('aria-hidden')).toBe(false);
  });

  it('a Done row leaves at once, with no fold, unless it was swiped', async () => {
    const { fixture } = await setup([['Mjölk']]);
    const leaveDone = fixture.componentInstance['leaveDone'].bind(fixture.componentInstance);
    const li = document.createElement('li');
    const animationComplete = vi.fn();
    leaveDone({ target: li, animationComplete });
    expect(animationComplete).toHaveBeenCalledOnce();
    expect(li.classList.contains('checked-off')).toBe(false);
    expect(li.hasAttribute('inert')).toBe(false);
  });

  it('while Done is folded, a checked row still leaves and is counted', async () => {
    const { el, fixture, store, listId } = await setup([['Mjölk'], ['Ost']]);
    await store.check(listId, itemId(store, 'Mjölk'));
    await fixture.whenStable();
    doneToggle(el)!.click();
    await fixture.whenStable();
    expect(text(doneToggle(el))).toBe('Klart (1)');

    rows(el, false)[0]!.click();
    await fixture.whenStable();
    expect(names(el)).toEqual([]);
    expect(text(doneToggle(el))).toBe('Klart (2)');
    expect(rows(el, true)).toHaveLength(0);
  });

  it('the band says how many are left and who you share with', async () => {
    const { el, fixture } = await setup([['Mjölk'], ['Ost'], ['Smör']], ['bo', 'cia', 'dan', 'eva']);
    await vi.waitFor(() => expect(el.querySelector('.with')).not.toBeNull());
    await fixture.whenStable();
    const band = el.querySelector('header')!;
    expect(text(band.querySelector('.meta'))).toContain('3 att handla');
    const shared = band.querySelector('.with')!;
    expect(shared.querySelectorAll('app-face')).toHaveLength(3);
    expect(text(shared)).toContain('+1');
    expect(shared.getAttribute('aria-label')).toBe('Delas med bo, cia, dan och eva');
  });

  it('with no one else, only your initial shows', async () => {
    const { el, fixture } = await setup([['Mjölk']]);
    await vi.waitFor(() => expect(TestBed.inject(Household).members()).toHaveLength(1));
    await fixture.whenStable();
    expect(el.querySelector('.with')).toBeNull();
    expect(el.querySelectorAll('header app-face')).toHaveLength(1);
  });

  it('a row someone else added shows their face; yours and unknown ones show none', async () => {
    const failed = vi.spyOn(console, 'error');
    const t = await setup([['Mjölk'], ['Ost'], ['Smör']], ['bo']);
    const [you, bo] = t.members;
    await pull(t, [
      ['Mjölk', you!.id],
      ['Ost', bo!.id],
      ['Smör', newId()],
    ]);
    await vi.waitFor(() => expect(t.el.querySelectorAll('main app-face')).toHaveLength(1));
    const ost = rows(t.el, false).find((r) => text(r.querySelector('.name')) === 'Ost')!;
    expect(text(ost.querySelector('app-face'))).toBe('B');
    // the face is hidden from screen readers, so the row says who added it
    expect(ost.getAttribute('aria-description')).toBe('Tillagd av bo');

    await t.db.setMeta('members', []);
    await TestBed.inject(Household).refresh();
    await t.fixture.whenStable();
    expect(t.el.querySelectorAll('main app-face')).toHaveLength(0);
    expect(failed).not.toHaveBeenCalled();
    failed.mockRestore();
  });

  it("a row a guest added shows the guest's face, ringed; one without a name is G for Guest", async () => {
    const t = await setup([['Chorizo'], ['Öl']], [], false, () => ({
      shares: [],
      guests: [
        { id: 'g1', shareId: 's1', name: 'Fredrik' },
        { id: 'g2', shareId: 's1', name: null },
      ],
    }));
    await pull(t, [
      ['Chorizo', 'g1'],
      ['Öl', 'g2'],
    ]);
    await vi.waitFor(() => expect(t.el.querySelectorAll('main app-face')).toHaveLength(2));
    for (const [name, initial, by] of [
      ['Chorizo', 'F', 'Fredrik'],
      ['Öl', 'G', 'Gäst'],
    ]) {
      const face = row(t.el, name!).querySelector('app-face')!;
      expect(text(face)).toBe(initial);
      expect(face.classList).toContain('guest');
      expect(row(t.el, name!).getAttribute('aria-description')).toBe(`Tillagd av ${by}`);
    }
  });

  it('a guest the page does not know yet shows no face, and the household\'s links are asked for once', async () => {
    const failed = vi.spyOn(console, 'error');
    const t = await setup([['Chorizo'], ['Öl'], ['Lime']]);
    // the page asks when it opens
    await vi.waitFor(() => expect(sharesAsked(t.fetch)).toBe(1));
    // Fredrik joined since; g9 the server doesn't know either
    t.server.shares = { shares: [], guests: [{ id: 'g1', shareId: 's1', name: 'Fredrik' }] };
    await pull(t, [
      ['Chorizo', 'g1'],
      ['Öl', 'g9'],
    ]);
    await vi.waitFor(() => expect(text(row(t.el, 'Chorizo').querySelector('app-face'))).toBe('F'));
    expect(row(t.el, 'Öl').querySelector('app-face')).toBeNull();
    expect(sharesAsked(t.fetch)).toBe(2);

    // rendering again asks no more
    row(t.el, 'Lime').click();
    await t.fixture.whenStable();
    expect(row(t.el, 'Öl').querySelector('app-face')).toBeNull();
    expect(sharesAsked(t.fetch)).toBe(2);
    expect(failed).not.toHaveBeenCalled();
    failed.mockRestore();
  });

  it("a guest the page's own question brings asks nothing more", async () => {
    let answer!: () => void;
    const held = new Promise<void>((resolve) => (answer = resolve));
    const t = await setup([['Chorizo']], [], false, () =>
      held.then(() => ({ shares: [], guests: [{ id: 'g1', shareId: 's1', name: 'Fredrik' }] })),
    );
    // the row shows before the server has answered the page
    await pull(t, [['Chorizo', 'g1']]);
    await t.fixture.whenStable();
    expect(row(t.el, 'Chorizo').querySelector('app-face')).toBeNull();

    answer();
    await vi.waitFor(() => expect(text(row(t.el, 'Chorizo').querySelector('app-face'))).toBe('F'));
    await TestBed.inject(Shares).settled();
    expect(sharesAsked(t.fetch)).toBe(1);
  });

  it("\"with\" shows the household and the guests of this list's link; tapping it says until when", async () => {
    const expiresAt = Date.now() + 86_400_000;
    const t = await setup([['Mjölk']], ['bo'], false, (listId) => ({
      shares: [
        { id: 's1', listId, token: 'tok1', expiresAt, createdBy: 'u1' },
        { id: 's2', listId: newId(), token: 'tok2', expiresAt, createdBy: 'u1' },
      ],
      guests: [
        { id: 'g1', shareId: 's1', name: 'Fredrik' },
        { id: 'g2', shareId: 's1', name: null },
        // another list's guest, and one of a link that has ended
        { id: 'g3', shareId: 's2', name: 'Felix' },
        { id: 'g4', shareId: 's0', name: 'Jonas' },
      ],
    }));
    await vi.waitFor(() => expect(t.el.querySelectorAll('.with app-face')).toHaveLength(3));
    expect(t.el.querySelector('.with')!.getAttribute('aria-label')).toBe('Delas med bo, Fredrik och Gäst');

    await (await t.loader.getHarness(MatMenuHarness.with({ selector: '.with' }))).open();
    const panel = document.querySelector('.people-menu')!;
    expect(text(panel.querySelector('.heading'))).toBe('På Inköpslista');
    expect([...panel.querySelectorAll('.person .full-name')].map(text)).toEqual(['anna', 'bo', 'Fredrik', 'Gäst']);
    expect(text(panel.querySelector('.until'))).toBe(`Länken fungerar till ${untilDay(expiresAt, 'sv')}`);
  });

  it('a link that runs out on screen takes its guests from "with" when the page next renders', async () => {
    const expiresAt = Date.now() + 60_000;
    const t = await setup([['Mjölk'], ['Ost']], ['bo'], false, (listId) => ({
      shares: [{ id: 's1', listId, token: 'tok1', expiresAt, createdBy: 'u1' }],
      guests: [{ id: 'g1', shareId: 's1', name: 'Fredrik' }],
    }));
    await t.store.check(t.listId, itemId(t.store, 'Ost'));
    await vi.waitFor(() => expect(t.el.querySelectorAll('.with app-face')).toHaveLength(2));
    await vi.waitFor(() => expect(doneToggle(t.el)).not.toBeNull());

    // folding Done changes nothing in the list, only what the page shows
    const later = vi.spyOn(Date, 'now').mockReturnValue(expiresAt);
    doneToggle(t.el)!.click();
    await t.fixture.whenStable();
    expect(t.el.querySelector('.with')!.getAttribute('aria-label')).toBe('Delas med bo');
    await (await t.loader.getHarness(MatMenuHarness.with({ selector: '.with' }))).open();
    expect(document.querySelector('.people-menu .until')).toBeNull();
    later.mockRestore();
  });

  it.each([
    ['Chorizo', ['F', 'Tillagd av Fredrik', 'Gäst på den här listan'], true],
    ['Ost', ['B', 'Tillagd av bo', ''], false],
    ['Smör', ['A', 'Tillagd av dig', ''], false],
    // added on this phone and not yet synced: no one has stamped who added it
    ['Mjölk', ['A', 'Tillagd av dig', ''], false],
  ])('item options of %s start with who added it', async (name, by, guest) => {
    const t = await setup([['Mjölk'], ['Chorizo'], ['Ost'], ['Smör']], ['bo'], false, () => ({
      shares: [],
      guests: [{ id: 'g1', shareId: 's1', name: 'Fredrik' }],
    }));
    const [you, bo] = t.members;
    await pull(t, [
      ['Chorizo', 'g1'],
      ['Ost', bo!.id],
      ['Smör', you!.id],
    ]);
    await vi.waitFor(() => expect(t.el.querySelectorAll('main app-face')).toHaveLength(2));
    t.el.querySelector<HTMLElement>(`[aria-label="Alternativ för ${name}"]`)!.click();
    await t.loader.getHarness(MatBottomSheetHarness);
    const block = document.querySelector('app-edit-sheet .by')!;
    expect(['app-face', 'b', '.who span'].map((part) => text(block.querySelector(part)))).toEqual(by);
    expect(block.querySelector('app-face')!.classList.contains('guest')).toBe(guest);
  });

  it('focus stays in the list when a row moves to the other section', async () => {
    const { el, fixture } = await setup([['Mjölk'], ['Ost'], ['Smör']]);
    const tap = async (row: HTMLElement) => {
      row.focus();
      row.click();
      await fixture.whenStable();
    };
    const focused = () => document.activeElement as HTMLElement;

    await tap(rows(el, false)[1]!);
    expect(text(focused())).toBe('Smör');
    await tap(rows(el, false)[1]!);
    expect(text(focused())).toBe('Mjölk');
    await tap(rows(el, false)[0]!);
    expect(focused()).toBe(doneToggle(el));

    await tap(rows(el, true)[2]!);
    expect(text(focused())).toBe(text(rows(el, true)[1]!));
    await tap(rows(el, true)[0]!);
    await tap(rows(el, true)[0]!);
    // Done is gone with its toggle
    expect(focused()).toBe(el.querySelector('.dock'));
  });

  it('shows no title until the current list is known', async () => {
    const { db, store, listId } = await setup();
    await store.renameList(listId, 'Mat');
    // sorts first, so a guess before the saved id is known would show it
    await store.createList('Apotek');
    await db.setMeta('currentListId', listId);
    const later = <T>(load: () => Promise<T>) => new Promise((r) => setTimeout(r, 50)).then(load);
    const transaction = db.transaction.bind(db) as (...args: unknown[]) => Promise<unknown>;
    const getMeta = db.getMeta.bind(db) as (key: string) => Promise<unknown>;

    for (const slow of ['store', 'saved id']) {
      TestBed.resetTestingModule();
      // the same database, with a Store that has not loaded it yet; one of the two loads lags
      configure(db);
      const lagStore = (...args: unknown[]) => later(() => transaction(...args));
      const lagSavedId = (key: string) => (key === 'currentListId' ? later(() => getMeta(key)) : getMeta(key));
      const spy =
        slow === 'store'
          ? vi.spyOn(db, 'transaction').mockImplementation(lagStore as never)
          : vi.spyOn(db, 'getMeta').mockImplementation(lagSavedId as never);
      const fixture = TestBed.createComponent(ListPage);
      const el: HTMLElement = fixture.nativeElement;
      const titles = new Set<string>();
      const seen = new MutationObserver(() => titles.add(text(el.querySelector('h1'))));
      seen.observe(el, { subtree: true, childList: true, characterData: true });
      // the Store's first load is no pending task, so wait for the title itself
      await vi.waitFor(() => expect(text(el.querySelector('h1'))).toBe('Mat'));
      seen.disconnect();
      spy.mockRestore();
      titles.delete('');
      expect([slow, [...titles]]).toEqual([slow, ['Mat']]);
    }
  });

  it('an empty list invites the first item', async () => {
    const { el } = await setup();
    expect(text(el.querySelector('.empty .brand'))).toBe('Inget på Inköpslista än');
    expect(text(el.querySelector('.empty'))).toContain('Lägg till den första varan med Lägg till eller hitta nedan.');
    expect(rows(el, false)).toHaveLength(0);
  });

  it('Add or find at the bottom opens the add view', async () => {
    const { el } = await setup([['Mjölk']]);
    const dock = [...el.querySelectorAll('a')].find((a) => text(a) === 'Lägg till eller hitta');
    expect(dock?.getAttribute('href')).toBe('/add');
  });

  it('right-clicking a row opens its options, as holding it does', async () => {
    const { el, loader } = await setup([['Mjölk']]);
    const row = rows(el, false)[0]!;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await loader.getHarness(MatBottomSheetHarness);
    expect(text(document.querySelector('app-edit-sheet h2'))).toBe('Mjölk');
    expect(names(el)).toEqual(['Mjölk']);
  });

  it('swiping a row left removes it, with undo', async () => {
    const { el, fixture, loader } = await setup([['Mjölk'], ['Ost']]);
    HTMLElement.prototype.setPointerCapture = vi.fn();
    const row = rows(el, false)[0]!;
    Object.defineProperty(row, 'offsetWidth', { value: 360 });
    const fire = (type: string, x: number) =>
      row.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: x, clientY: 0, button: 0, bubbles: true }));
    fire('pointerdown', 300);
    fire('pointermove', 150);
    fire('pointerup', 150);
    await fixture.whenStable();
    expect(names(el)).toEqual(['Ost']);

    const snackBar = await loader.getHarness(MatSnackBarHarness);
    expect(await snackBar.getMessage()).toBe('Mjölk borttagen');
    await snackBar.dismissWithAction();
    await fixture.whenStable();
    expect(names(el)).toEqual(['Mjölk', 'Ost']);
  });

  it('on a computer, Add or find sits beside the list and the dock is gone', async () => {
    const { el } = await setup([['Mjölk']], [], true);
    expect(el.querySelector('aside.sheet.panel app-add-or-find')).toBeTruthy();
    expect(el.querySelector('.dock')).toBeNull();
    expect(text(el)).not.toContain('Lägg till eller hitta');
  });

  it("on a computer, Add or find's snackbar is at the bottom, over the list", async () => {
    const { el, fixture, loader } = await setup([['Mjölk']], [], true);
    const input = el.querySelector<HTMLInputElement>('aside input')!;
    input.value = 'Ost';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(await (await loader.getHarness(MatSnackBarHarness)).getMessage()).toBe('Ost tillagd');
    const snack = document.querySelector<HTMLElement>('.mat-mdc-snack-bar-container')!;
    expect(snack.classList).not.toContain('in-toolbar');
    expect(snack.closest<HTMLElement>('.cdk-global-overlay-wrapper')?.style.alignItems).toBe('flex-end');
  });

  it('on a computer, item options open beside the row', async () => {
    const { el, fixture, store, listId, loader } = await setup([['Mjölk', '2 st']], [], true);
    el.querySelector<HTMLElement>('[aria-label="Alternativ för Mjölk"]')!.click();
    const dialog = await loader.getHarness(MatDialogHarness);
    expect(await loader.getAllHarnesses(MatBottomSheetHarness)).toHaveLength(0);
    const field = await dialog.getHarness(MatFormFieldHarness.with({ floatingLabelText: 'Anteckning' }));
    await (await field.getControl(MatInputHarness))!.setValue('2 st, laktosfri');

    await dialog.close();
    await fixture.whenStable();
    expect(await loader.getAllHarnesses(MatDialogHarness)).toHaveLength(0);
    expect(store.state().entries.get(entryKey(listId, itemId(store, 'Mjölk')))?.note).toBe('2 st, laktosfri');
  });

  it.each([
    ['upper', { top: 100, bottom: 156, right: 600 }, { top: '100px' }],
    ['lower', { top: 600, bottom: 656, right: 5000 }, { bottom: `${innerHeight - 656}px` }],
  ])('on a computer, the options dialog opens at a row in the %s half', async (_half, rect, edge) => {
    const { el, loader, fixture } = await setup([['Mjölk']], [], true);
    const open = vi.spyOn(TestBed.inject(MatDialog), 'open');
    vi.spyOn(el.querySelector('.row')!, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);
    el.querySelector<HTMLElement>('[aria-label="Alternativ för Mjölk"]')!.click();
    await loader.getHarness(MatDialogHarness);
    expect(open.mock.calls[0]![1]!.position).toEqual({ left: `${Math.min(rect.right + 8, innerWidth - 336)}px`, ...edge });
    await (await loader.getHarness(MatDialogHarness)).close();
    await fixture.whenStable();
  });

  it('edit sheet saves a changed note on close', async () => {
    const { el, fixture, store, listId, loader } = await setup([['Mjölk', '2 st']]);
    el.querySelector<HTMLElement>('[aria-label="Alternativ för Mjölk"]')!.click();
    const sheet = await loader.getHarness(MatBottomSheetHarness);
    const field = await sheet.getHarness(MatFormFieldHarness.with({ floatingLabelText: 'Anteckning' }));
    const note = (await field.getControl(MatInputHarness))!;
    expect(await note.getValue()).toBe('2 st');
    await note.setValue('2 st, laktosfri');
    expect(store.state().entries.get(entryKey(listId, itemId(store, 'Mjölk')))?.note).toBe('2 st');

    await sheet.dismiss();
    await fixture.whenStable();
    expect(await loader.getAllHarnesses(MatBottomSheetHarness)).toHaveLength(0);
    expect(store.state().entries.get(entryKey(listId, itemId(store, 'Mjölk')))?.note).toBe('2 st, laktosfri');
    expect(text(rows(el, false)[0]!.querySelector('.note'))).toBe('2 st, laktosfri');
    expect(await (await loader.getHarness(MatSnackBarHarness)).getMessage()).toBe('Anteckning sparad');
  });

  it('edit sheet stays open with the reason when a name is refused', async () => {
    const { el, fixture, store, loader } = await setup([['Mjölk']]);
    el.querySelector<HTMLElement>('[aria-label="Alternativ för Mjölk"]')!.click();
    const sheet = await loader.getHarness(MatBottomSheetHarness);
    const field = await sheet.getHarness(MatFormFieldHarness.with({ floatingLabelText: 'Namn' }));
    const name = (await field.getControl(MatInputHarness))!;
    await name.setValue(' ');

    await sheet.dismiss();
    await fixture.whenStable();
    expect(await loader.getAllHarnesses(MatBottomSheetHarness)).toHaveLength(1);
    expect(await field.getTextErrors()).toEqual(['Ange ett namn']);
    expect(itemId(store, 'Mjölk')).toBeTruthy();

    await name.setValue('Laktosfri mjölk');
    await sheet.dismiss();
    await fixture.whenStable();
    expect(await loader.getAllHarnesses(MatBottomSheetHarness)).toHaveLength(0);
    expect(names(el)).toEqual(['Laktosfri mjölk']);
  });

  it('edit sheet refuses the name of another item under the field', async () => {
    const t = await setup([['Mjölk'], ['Ost']]);
    const sheet = await editMjolk(t, { name: 'ost' });
    await sheet.dismiss();
    await t.fixture.whenStable();
    expect(await t.loader.getAllHarnesses(MatBottomSheetHarness)).toHaveLength(1);
    const field = await sheet.getHarness(MatFormFieldHarness.with({ floatingLabelText: 'Namn' }));
    expect(await field.getTextErrors()).toEqual(['Det namnet finns redan']);
    expect(names(t.el)).toEqual(['Mjölk', 'Ost']);
  });

  it('a note saved before a refused name is undone with a later remove', async () => {
    const t = await setup([['Mjölk', '2 st']]);
    const sheet = await editMjolk(t, { name: ' ', note: 'laktosfri' });
    await sheet.dismiss();
    await t.fixture.whenStable();
    expect(noteOf(t.store, t.listId, 'Mjölk')).toBe('laktosfri');

    await (await sheet.getHarness(MatActionListItemHarness.with({ text: 'Ta bort från listan' }))).click();
    await t.fixture.whenStable();
    expect(names(t.el)).toEqual([]);
    const snackBar = await t.loader.getHarness(MatSnackBarHarness);
    expect(await snackBar.getMessage()).toBe('Mjölk borttagen');
    await snackBar.dismissWithAction();
    await t.fixture.whenStable();
    expect(names(t.el)).toEqual(['Mjölk']);
    expect(noteOf(t.store, t.listId, 'Mjölk')).toBe('2 st');
  });

  it('Back after a refused name keeps the saved note undoable and drops the name', async () => {
    const failed = vi.spyOn(console, 'error');
    const t = await setup([['Mjölk', '2 st']]);
    const sheet = await editMjolk(t, { name: ' ', note: 'laktosfri' });
    await sheet.dismiss();
    await t.fixture.whenStable();

    window.dispatchEvent(new PopStateEvent('popstate'));
    await t.fixture.whenStable();
    expect(await t.loader.getAllHarnesses(MatBottomSheetHarness)).toHaveLength(0);
    expect(names(t.el)).toEqual(['Mjölk']);
    const snackBar = await t.loader.getHarness(MatSnackBarHarness);
    expect(await snackBar.getMessage()).toBe('Anteckning sparad');
    expect(failed).not.toHaveBeenCalled();
    await snackBar.dismissWithAction();
    await t.fixture.whenStable();
    expect(noteOf(t.store, t.listId, 'Mjölk')).toBe('2 st');
  });

  it('edit sheet also saves when Back closes it', async () => {
    const { el, fixture, store, listId, loader } = await setup([['Mjölk']]);
    el.querySelector<HTMLElement>('[aria-label="Alternativ för Mjölk"]')!.click();
    const sheet = await loader.getHarness(MatBottomSheetHarness);
    const field = await sheet.getHarness(MatFormFieldHarness.with({ floatingLabelText: 'Anteckning' }));
    await (await field.getControl(MatInputHarness))!.setValue('laktosfri');

    // Back is a popstate, which closes the sheet without going through its own close
    window.dispatchEvent(new PopStateEvent('popstate'));
    await fixture.whenStable();
    expect(await loader.getAllHarnesses(MatBottomSheetHarness)).toHaveLength(0);
    expect(store.state().entries.get(entryKey(listId, itemId(store, 'Mjölk')))?.note).toBe('laktosfri');
  });

  it('edit sheet sets quantity and price, and one undo takes back everything changed there', async () => {
    const t = await setup([['Mjölk', '2 st']]);
    const sheet = await editMjolk(t, { note: 'laktosfri', price: '14,90' });
    expect(document.querySelector('.price input')?.getAttribute('inputmode')).toBe('decimal');
    expect(stepper('Färre').disabled).toBe(true);
    stepper('Fler').click();
    stepper('Fler').click();
    await t.fixture.whenStable();
    expect(text(document.querySelector('.stepper output'))).toBe('3');
    expect(stepper('Färre').disabled).toBe(false);

    await sheet.dismiss();
    await t.fixture.whenStable();
    expect(lines(rows(t.el, false)[0]!)).toEqual(['×3', 'laktosfri · 44,70 kr']);
    await (await t.loader.getHarness(MatSnackBarHarness)).dismissWithAction();
    await t.fixture.whenStable();
    expect(lines(rows(t.el, false)[0]!)).toEqual(['', '2 st']);
    expect(t.store.state().items.get(itemId(t.store, 'Mjölk'))?.price).toBeNull();
  });

  it('the stepper stops at 99', async () => {
    const t = await setup([['Mjölk']]);
    await t.store.setQuantity(t.listId, itemId(t.store, 'Mjölk'), 99);
    await t.fixture.whenStable();
    const sheet = await editMjolk(t, {});
    expect(text(document.querySelector('.stepper output'))).toBe('99');
    expect(stepper('Fler').disabled).toBe(true);
    await sheet.dismiss();
    await t.fixture.whenStable();
  });

  it('a refused price keeps the sheet open with the reason, and the note is saved', async () => {
    const t = await setup([['Mjölk']]);
    const sheet = await editMjolk(t, { note: 'laktosfri', price: 'abc' });
    await sheet.dismiss();
    await t.fixture.whenStable();
    expect(await t.loader.getAllHarnesses(MatBottomSheetHarness)).toHaveLength(1);
    const field = await sheet.getHarness(MatFormFieldHarness.with({ floatingLabelText: 'Pris' }));
    expect(await field.getTextErrors()).toEqual(['Skriv ett pris, till exempel 14,90']);
    expect(noteOf(t.store, t.listId, 'Mjölk')).toBe('laktosfri');
  });

  it('rows show a quantity above 1 and what they cost, Done rows too', async () => {
    const t = await setup([['Mjölk'], ['Bröd', 'fullkorn'], ['Ost']]);
    const [milk, cheese] = [itemId(t.store, 'Mjölk'), itemId(t.store, 'Ost')];
    await t.store.setQuantity(t.listId, milk, 3);
    await t.store.setPrices([{ itemId: milk, price: 1490 }, { itemId: cheese, price: 4990 }]);
    await t.store.check(t.listId, cheese);
    await t.fixture.whenStable();
    expect(rows(t.el, false).map(lines)).toEqual([['', 'fullkorn'], ['×3', '44,70 kr']]);
    expect(rows(t.el, true).map(lines)).toEqual([['', '49,90 kr']]);
  });

  it('the total and what is left show once a row has a price, with quantities, and how many have none', async () => {
    const t = await setup([['Mjölk'], ['Bröd'], ['Ost']]);
    const [milk, bread, cheese] = [itemId(t.store, 'Mjölk'), itemId(t.store, 'Bröd'), itemId(t.store, 'Ost')];
    const total = () => text(t.el.querySelector('.total'));
    expect(t.el.querySelector('.total')).toBeNull();

    await t.store.setQuantity(t.listId, milk, 3);
    await t.store.setPrices([{ itemId: milk, price: 1490 }]);
    await t.fixture.whenStable();
    expect(total()).toBe('≈ 45 kr totalt · 45 kr kvar · 2 utan pris');

    await t.store.setPrices([{ itemId: bread, price: 3500 }, { itemId: cheese, price: 8950 }]);
    await t.store.check(t.listId, cheese);
    await t.fixture.whenStable();
    // Ost is in Done: in the total, not in what's left
    expect(total()).toBe('≈ 169 kr totalt · 80 kr kvar');
    // under the rows to get, above Done
    const order = [...t.el.querySelectorAll('main ul, main .total, main [aria-expanded]')].map((e) => e.tagName);
    expect(order).toEqual(['UL', 'P', 'BUTTON', 'UL']);
  });

  it('the rows without a price are priced in one sheet, with one undo', async () => {
    const t = await setup([['Mjölk'], ['Bröd'], ['Ost']]);
    const [milk, bread, cheese] = [itemId(t.store, 'Mjölk'), itemId(t.store, 'Bröd'), itemId(t.store, 'Ost')];
    await t.store.setPrices([{ itemId: milk, price: 1490 }]);
    await t.fixture.whenStable();
    t.el.querySelector<HTMLElement>('.total button')!.click();
    const sheet = await t.loader.getHarness(MatBottomSheetHarness);
    const fields = await sheet.getAllHarnesses(MatFormFieldHarness);
    expect(await Promise.all(fields.map((f) => f.getLabel()))).toEqual(['Bröd', 'Ost']);
    const inputs = [...document.querySelectorAll<HTMLInputElement>('app-price-sheet input')];

    await (await fields[0]!.getControl(MatInputHarness))!.setValue('35');
    inputs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(document.activeElement).toBe(inputs[1]);
    await (await fields[1]!.getControl(MatInputHarness))!.setValue('89,50');
    inputs[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await t.fixture.whenStable();
    expect(await t.loader.getAllHarnesses(MatBottomSheetHarness)).toHaveLength(0);
    expect(text(t.el.querySelector('.total'))).toBe('≈ 139 kr totalt · 139 kr kvar');

    const snackBar = await t.loader.getHarness(MatSnackBarHarness);
    expect(await snackBar.getMessage()).toBe('Priser sparade');
    await snackBar.dismissWithAction();
    await t.fixture.whenStable();
    expect([milk, bread, cheese].map((id) => t.store.state().items.get(id)?.price)).toEqual([1490, null, null]);
  });

  it('a price that does not read keeps the sheet open on it, and saves nothing', async () => {
    const t = await setup([['Mjölk'], ['Bröd'], ['Ost']]);
    await t.store.setPrices([{ itemId: itemId(t.store, 'Mjölk'), price: 1490 }]);
    await t.fixture.whenStable();
    t.el.querySelector<HTMLElement>('.total button')!.click();
    const sheet = await t.loader.getHarness(MatBottomSheetHarness);
    const fields = await sheet.getAllHarnesses(MatFormFieldHarness);
    await (await fields[0]!.getControl(MatInputHarness))!.setValue('35');
    await (await fields[1]!.getControl(MatInputHarness))!.setValue('gratis');
    await sheet.dismiss();
    await t.fixture.whenStable();
    expect(await t.loader.getAllHarnesses(MatBottomSheetHarness)).toHaveLength(1);
    expect(await fields[1]!.getTextErrors()).toEqual(['Skriv ett pris, till exempel 14,90']);
    expect(t.store.state().items.get(itemId(t.store, 'Bröd'))?.price).toBeNull();

    await (await fields[1]!.getControl(MatInputHarness))!.setValue('');
    await sheet.dismiss();
    await t.fixture.whenStable();
    expect(await t.loader.getAllHarnesses(MatBottomSheetHarness)).toHaveLength(0);
    expect(t.store.state().items.get(itemId(t.store, 'Bröd'))?.price).toBe(3500);
    expect(await (await t.loader.getHarness(MatSnackBarHarness)).getMessage()).toBe('Pris sparat');
  });

  it('rows are labelled checkboxes', async () => {
    const { el } = await setup([['Mjölk', 'laktosfri']]);
    const [row] = rows(el, false);
    expect(row!.tagName).toBe('BUTTON');
    expect(row!.getAttribute('role')).toBe('checkbox');
    expect(row!.getAttribute('aria-checked')).toBe('false');
    // no aria-label: the accessible name is the row's text, name and note
    expect(row!.hasAttribute('aria-label')).toBe(false);
    expect(text(row!)).toContain('Mjölk');
    expect(text(row!)).toContain('laktosfri');
  });

  it('your initial carries the sync status', async () => {
    const { el, fixture, sync } = await setup();
    const link = () => el.querySelector<HTMLAnchorElement>('app-profile-button a')!;
    expect(link().getAttribute('aria-label')).toBe('Inställningar för anna');
    expect(link().getAttribute('href')).toBe('/settings');
    expect(link().querySelector('.badge')).toBeNull();

    sync.status.set({ kind: 'offline', pending: 2, rejected: 0 });
    await fixture.whenStable();
    expect(link().getAttribute('aria-label')).toBe('Inställningar för anna, 2 osynkade ändringar');
    expect(text(link().querySelector('.badge'))).toBe('2');

    sync.status.set({ kind: 'auth', pending: 2, rejected: 0 });
    await fixture.whenStable();
    expect(text(link().querySelector('.badge'))).toBe('!');
  });
});
