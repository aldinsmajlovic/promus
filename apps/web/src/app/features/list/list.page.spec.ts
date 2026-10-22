import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { importProvidersFrom, provideAppInitializer, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatBottomSheetHarness } from '@angular/material/bottom-sheet/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatActionListItemHarness } from '@angular/material/list/testing';
import { MatMenuHarness } from '@angular/material/menu/testing';
import { MatSnackBarHarness } from '@angular/material/snack-bar/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { entryKey, newId } from '@promus/shared';
import { describe, expect, it, vi } from 'vitest';
import sv from '../../../i18n/sv.json';
import { PromusDb } from '../../core/db';
import { registerIcons } from '../../core/icons';
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

async function setup(items: [name: string, note?: string][] = []) {
  const db = new PromusDb(`list-${newId()}`);
  await db.setMeta('session', { userId: newId(), username: 'anna', householdId: newId() });
  const sync = configure(db);
  const store = TestBed.inject(Store);
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
  return { db, store, listId, fixture, el, loader, sync };
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

  it('done is collapsed and shows its count', async () => {
    const { el, fixture, store, listId } = await setup([['Mjölk'], ['Ost'], ['Smör']]);
    await store.check(listId, itemId(store, 'Mjölk'));
    await store.check(listId, itemId(store, 'Ost'));
    await fixture.whenStable();
    const toggle = doneToggle(el)!;
    expect(text(toggle)).toBe('Klart (2)');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(rows(el, true)).toHaveLength(0);

    toggle.click();
    await fixture.whenStable();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(names(el, true).sort()).toEqual(['Mjölk', 'Ost']);

    rows(el, true).find((r) => text(r).includes('Ost'))!.click();
    await fixture.whenStable();
    expect(names(el)).toEqual(['Ost', 'Smör']);
    expect(text(doneToggle(el))).toBe('Klart (1)');
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

    doneToggle(el)!.click();
    await fixture.whenStable();
    await tap(rows(el, true)[2]!);
    expect(text(focused())).toBe(text(rows(el, true)[1]!));
    await tap(rows(el, true)[0]!);
    await tap(rows(el, true)[0]!);
    // Done is gone with its toggle
    expect(focused()).toBe(el.querySelector('.fab'));
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

  it('the list switcher appears only with more than one list', async () => {
    const { el, fixture, store, db, loader } = await setup([['Mjölk']]);
    expect(el.querySelector('.switch')).toBeNull();
    expect(text(el.querySelector('h1'))).toBe('Inköpslista');

    const { listId: lidl } = await store.createList('Lidl');
    await fixture.whenStable();
    const switcher = await loader.getHarness(MatMenuHarness.with({ selector: '.switch' }));
    await switcher.open();
    const items = await Promise.all((await switcher.getItems()).map((i) => i.getText()));
    expect(items).toEqual([
      expect.stringMatching(/^Inköpslista\s*1$/),
      expect.stringMatching(/^Lidl\s*0$/),
      'Ny lista',
    ]);

    await switcher.clickItem({ text: /^Lidl/ });
    await fixture.whenStable();
    expect(text(el.querySelector('h1'))).toBe('Lidl');
    expect(await db.getMeta('currentListId')).toBe(lidl);
  });

  it('shows the empty line for an empty list', async () => {
    const { el } = await setup();
    expect(text(el.querySelector('.empty'))).toBe('Listan är tom');
    expect(rows(el, false)).toHaveLength(0);
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

  it('deleting the current list shows another and undo brings it back', async () => {
    const { el, fixture, store, loader } = await setup([['Mjölk']]);
    await store.createList('Lidl');
    await fixture.whenStable();
    const more = await loader.getHarness(MatMenuHarness.with({ selector: '[aria-label="Fler alternativ"]' }));
    await more.clickItem({ text: 'Ta bort listan' });
    await fixture.whenStable();
    expect(text(el.querySelector('h1'))).toBe('Lidl');
    expect(el.querySelector('.switch')).toBeNull();

    const snackBar = await loader.getHarness(MatSnackBarHarness);
    expect(await snackBar.getMessage()).toBe('Listan borttagen');
    await snackBar.dismissWithAction();
    await fixture.whenStable();
    expect(text(el.querySelector('h1'))).toBe('Inköpslista');
    expect(names(el)).toEqual(['Mjölk']);
  });

  it('a refused list name shows under the field and keeps the dialog open', async () => {
    const { el, fixture, loader } = await setup();
    const more = await loader.getHarness(MatMenuHarness.with({ selector: '[aria-label="Fler alternativ"]' }));
    await more.clickItem({ text: 'Ny lista' });
    const dialog = await loader.getHarness(MatDialogHarness);
    const field = await dialog.getHarness(MatFormFieldHarness);
    const name = (await field.getControl(MatInputHarness))!;

    const save = await dialog.getHarness(MatButtonHarness.with({ text: 'Spara' }));
    await name.setValue('   ');
    await save.click();
    await fixture.whenStable();
    expect(await field.getTextErrors()).toEqual(['Ange ett namn']);

    await name.setValue('Lidl');
    expect(await field.getTextErrors()).toEqual([]);
    await save.click();
    await fixture.whenStable();
    expect(await loader.getAllHarnesses(MatDialogHarness)).toHaveLength(0);
    expect(text(el.querySelector('h1'))).toBe('Lidl');
  });

  it('the sync indicator shows only what needs attention', async () => {
    const { el, fixture, loader, sync } = await setup();
    const indicator = () => el.querySelector('app-sync-indicator button');
    expect(indicator()).toBeNull();

    sync.status.set({ kind: 'offline', pending: 2, rejected: 0 });
    await fixture.whenStable();
    expect(indicator()?.querySelector('mat-icon')?.getAttribute('data-mat-icon-name')).toBe('cloud_off');
    expect(text(indicator()!.querySelector('.mat-badge-content'))).toBe('2');
    expect(indicator()!.getAttribute('aria-label')).toBe('Offline, 2 osynkade ändringar');
    sync.status.set({ kind: 'offline', pending: 1, rejected: 0 });
    await fixture.whenStable();
    expect(indicator()!.getAttribute('aria-label')).toBe('Offline, 1 osynkad ändring');

    sync.status.set({ kind: 'offline', pending: 0, rejected: 0 });
    await fixture.whenStable();
    expect(indicator()).toBeNull();

    sync.status.set({ kind: 'error', pending: 0, rejected: 1, messageKey: 'sync.rejected' });
    await fixture.whenStable();
    (indicator() as HTMLElement).click();
    await fixture.whenStable();
    const harness = await loader.getHarness(MatDialogHarness);
    // the reason is the dialog's accessible name, so it is read out when the dialog opens
    const labelledBy = await harness.getAriaLabelledby();
    expect(text(document.getElementById(labelledBy ?? ''))).toBe('Några ändringar nekades');
    await (await harness.getHarness(MatButtonHarness.with({ text: 'Försök igen' }))).click();
    expect(sync.syncNow).toHaveBeenCalledOnce();
  });
});
