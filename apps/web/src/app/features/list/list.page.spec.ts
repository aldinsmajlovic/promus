import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { importProvidersFrom, provideAppInitializer, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatBottomSheetHarness } from '@angular/material/bottom-sheet/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatActionListItemHarness } from '@angular/material/list/testing';
import { MatSnackBarHarness } from '@angular/material/snack-bar/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { type Member, type StoredEvent, entryKey, formatHlc, newId } from '@promus/shared';
import { describe, expect, it, vi } from 'vitest';
import sv from '../../../i18n/sv.json';
import { FETCH } from '../../core/api';
import { PromusDb } from '../../core/db';
import { Household } from '../../core/household';
import { registerIcons } from '../../core/icons';
import { SessionService } from '../../core/session';
import { Store } from '../../core/store';
import { SyncService, type SyncStatus } from '../../core/sync.service';
import { ListPage } from './list.page';

function configure(db: PromusDb) {
  const status = signal<SyncStatus>({ kind: 'idle', pending: 0, rejected: 0 });
  const sync = { status, syncNow: vi.fn(async () => undefined), soon: () => undefined };
  TestBed.configureTestingModule({
    providers: [
      { provide: PromusDb, useValue: db },
      { provide: SyncService, useValue: sync },
      // the page asks who's in the household; no household in the answer keeps the cached members
      { provide: FETCH, useValue: async () => Response.json({ user: { id: 'u1', username: 'anna' }, households: [] }) },
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
  return sync;
}

/** `others` are the household's members besides you, cached in meta `members` as the page finds them. */
async function setup(items: [name: string, note?: string][] = [], others: string[] = []) {
  const db = new PromusDb(`list-${newId()}`);
  const you: Member = { id: newId(), username: 'anna', role: 'owner' };
  const members = [you, ...others.map((username) => ({ id: newId(), username, role: 'member' }))];
  const householdId = newId();
  await db.setMeta('session', { userId: you.id, username: you.username, householdId });
  await db.setMeta('members', members);
  const sync = configure(db);
  const store = TestBed.inject(Store);
  await TestBed.inject(SessionService).load();
  await store.load();
  const { listId } = await store.createList('Inköpslista');
  for (const [name, note] of items) {
    await store.addByName(listId, name);
    if (note) await store.setNote(listId, itemId(store, name), note);
  }
  const fixture = TestBed.createComponent(ListPage);
  await fixture.whenStable();
  const el: HTMLElement = fixture.nativeElement;
  const loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
  return { db, store, listId, fixture, el, loader, sync, members, householdId };
}

function itemId(store: Store, name: string): string {
  const item = [...store.state().items.values()].find((i) => i.name === name);
  if (!item) throw new Error(`no item ${name}`);
  return item.id;
}

const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const rows = (el: HTMLElement, checked: boolean) =>
  [...el.querySelectorAll(`[role="checkbox"][aria-checked="${checked}"]`)] as HTMLElement[];
const names = (el: HTMLElement, checked = false) => rows(el, checked).map((r) => text(r.querySelector('.name')));
// the menu triggers carry aria-expanded too
const doneToggle = (el: HTMLElement) => el.querySelector<HTMLElement>('main [aria-expanded]');
const noteOf = (store: Store, listId: string, name: string) =>
  store.state().entries.get(entryKey(listId, itemId(store, name)))?.note;

/** Opens Mjölk's edit sheet and sets its fields; a refused name keeps it open with the note saved. */
async function editMjolk(t: Awaited<ReturnType<typeof setup>>, values: { name?: string; note?: string }) {
  t.el.querySelector<HTMLElement>('[aria-label="Alternativ för Mjölk"]')!.click();
  const sheet = await t.loader.getHarness(MatBottomSheetHarness);
  for (const [label, value] of [['Namn', values.name], ['Anteckning', values.note]] as const) {
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

    const again = TestBed.createComponent(ListPage);
    await again.whenStable();
    expect(doneToggle(again.nativeElement)!.getAttribute('aria-expanded')).toBe('false');
    expect(rows(again.nativeElement, true)).toHaveLength(0);
  });

  it('rows only arrive once the whole list has shown, Done included', async () => {
    const t = await setup([['Mjölk'], ['Ost']]);
    await t.store.check(t.listId, itemId(t.store, 'Ost'));
    // the list is loaded already; whether Done is folded is read only after it shows
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
    // pulled from the server, later than the local adds: the last entry.added names who added it
    const later = Date.now() + 60_000;
    const pulled = (name: string, userId: string, seq: number): StoredEvent => ({
      id: newId(),
      householdId: t.householdId,
      type: 'entry.added',
      v: 1,
      hlc: formatHlc(later + seq, 0, 'other'),
      occurredAt: later + seq,
      payload: { listId: t.listId, itemId: itemId(t.store, name) },
      seq,
      userId,
      receivedAt: later + seq,
    });
    await t.db.events.bulkAdd([pulled('Mjölk', you!.id, 1), pulled('Ost', bo!.id, 2), pulled('Smör', newId(), 3)]);
    await t.store.load();
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
