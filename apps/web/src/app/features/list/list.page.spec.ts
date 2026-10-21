import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { importProvidersFrom, provideAppInitializer, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatBottomSheetHarness } from '@angular/material/bottom-sheet/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
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

async function setup(items: [name: string, note?: string][] = []) {
  const db = new PromusDb(`list-${newId()}`);
  await db.setMeta('session', { userId: newId(), username: 'anna', householdId: newId() });
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

    sync.status.set({ kind: 'offline', pending: 0, rejected: 0 });
    await fixture.whenStable();
    expect(indicator()).toBeNull();

    sync.status.set({ kind: 'error', pending: 0, rejected: 1, messageKey: 'sync.rejected' });
    await fixture.whenStable();
    (indicator() as HTMLElement).click();
    await fixture.whenStable();
    const harness = await loader.getHarness(MatDialogHarness);
    expect(await harness.getText()).toContain('Några ändringar nekades');
    await (await harness.getHarness(MatButtonHarness.with({ text: 'Försök igen' }))).click();
    expect(sync.syncNow).toHaveBeenCalledOnce();
  });
});
