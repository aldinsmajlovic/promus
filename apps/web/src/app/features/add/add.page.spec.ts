import { Location } from '@angular/common';
import { SpyLocation, provideLocationMocks } from '@angular/common/testing';
import { TestKey } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, importProvidersFrom, provideAppInitializer, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatActionListItemHarness } from '@angular/material/list/testing';
import { MatSnackBarHarness } from '@angular/material/snack-bar/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { entryKey, newId } from '@promus/shared';
import { describe, expect, it, vi } from 'vitest';
import sv from '../../../i18n/sv.json';
import { PromusDb } from '../../core/db';
import { registerIcons } from '../../core/icons';
import { Store } from '../../core/store';
import { SyncService, type SyncStatus } from '../../core/sync.service';
import { AddPage } from './add.page';

@Component({ template: '' })
class Blank {}

function configure(db: PromusDb) {
  const status = signal<SyncStatus>({ kind: 'idle', pending: 0, rejected: 0 });
  TestBed.configureTestingModule({
    providers: [
      { provide: PromusDb, useValue: db },
      { provide: SyncService, useValue: { status, syncNow: async () => undefined, soon: () => undefined } },
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      provideRouter([
        { path: '', component: Blank },
        { path: 'add', component: AddPage },
      ]),
      provideLocationMocks(),
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
}

type Bought = [name: string, times: number, note?: string];

/** Items bought `times` times and then cleared from the list, so they are usual items. */
async function setup(bought: Bought[] = [], onList: string[] = []) {
  const db = new PromusDb(`add-${newId()}`);
  await db.setMeta('session', { userId: newId(), username: 'anna', householdId: newId() });
  configure(db);
  const store = TestBed.inject(Store);
  await store.load();
  const { listId } = await store.createList('Inköpslista');
  for (const [name, times, note] of bought) {
    for (let i = 0; i < times; i++) {
      await store.addByName(listId, name);
      if (note) await store.setNote(listId, itemId(store, name), note);
      await store.check(listId, itemId(store, name));
    }
    await store.remove(listId, itemId(store, name));
  }
  for (const name of onList) await store.addByName(listId, name);
  const fixture = TestBed.createComponent(AddPage);
  await fixture.whenStable();
  const el: HTMLElement = fixture.nativeElement;
  const loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
  const input = await loader.getHarness(MatInputHarness);
  return { db, store, listId, fixture, el, loader, input };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function itemId(store: Store, name: string): string {
  const item = [...store.state().items.values()].find((i) => i.name === name);
  if (!item) throw new Error(`no item ${name}`);
  return item.id;
}

const onListNow = (t: Setup, name: string) =>
  t.store.state().entries.get(entryKey(t.listId, itemId(t.store, name)))?.state === 'active';
const itemNames = (t: Setup) => [...t.store.state().items.values()].map((i) => i.name).sort();
// DOM order: the best match first, drawn nearest the field
const rowEls = (t: Setup) => [...t.el.querySelectorAll<HTMLElement>('.results > button')];
const icons = (row: HTMLElement) =>
  [...row.querySelectorAll('mat-icon')].map((i) => i.getAttribute('data-mat-icon-name'));
const titles = async (t: Setup) =>
  Promise.all((await t.loader.getAllHarnesses(MatActionListItemHarness)).map((r) => r.getTitle()));

async function type(t: Setup, text: string) {
  await t.input.setValue(text);
  await t.fixture.whenStable();
}

async function enter(t: Setup) {
  await (await t.input.host()).sendKeys(TestKey.ENTER);
  await t.fixture.whenStable();
}

const errors = async (t: Setup) => (await t.loader.getHarness(MatFormFieldHarness)).getTextErrors();
const focused = (t: Setup) => document.activeElement === t.el.querySelector('input');

describe('AddPage', () => {
  it('shows usual items when the field is empty', async () => {
    const t = await setup([['Kaffe', 3], ['Mjölk', 8, '2 st'], ['Gurka', 1], ['Ost', 5]], ['Ost']);
    expect(t.el.querySelector('h1')?.textContent?.trim()).toBe('Inköpslista');
    expect(await t.loader.getAllHarnesses(MatButtonHarness.with({ selector: '[aria-label="Stäng"]' }))).toHaveLength(1);
    expect(await t.input.getPlaceholder()).toBe('Lägg till vara');
    expect(focused(t)).toBe(true);

    // Ost is already on the list
    expect(await titles(t)).toEqual(['Mjölk', 'Kaffe', 'Gurka']);
    const rows = await t.loader.getAllHarnesses(MatActionListItemHarness);
    expect(await rows[0]!.getSecondaryText()).toBe('2 st');
    expect(rowEls(t).map(icons)).toEqual([
      ['history', 'add'],
      ['history', 'add'],
      ['history', 'add'],
    ]);

    // tapping one adds it with its note; it stays in place, highlighted, with a check
    await rows[1]!.click();
    await t.fixture.whenStable();
    expect(onListNow(t, 'Kaffe')).toBe(true);
    expect(await titles(t)).toEqual(['Mjölk', 'Kaffe', 'Gurka']);
    expect(rowEls(t)[1]!.classList).toContain('flash');
    expect(icons(rowEls(t)[1]!)).toEqual(['history', 'check']);
    await vi.waitFor(() => expect(rowEls(t)[1]!.classList).not.toContain('flash'));
    expect(focused(t)).toBe(true);
  });

  it('Enter re-adds an exact match', async () => {
    const t = await setup([['Mjölk', 2, 'laktosfri'], ['Havremjölk', 4]]);
    await type(t, ' MJÖLK');
    expect(await titles(t)).toEqual(['Mjölk', 'Havremjölk']);
    expect(await t.loader.getAllHarnesses(MatActionListItemHarness.with({ title: /^Lägg till/ }))).toHaveLength(0);

    await enter(t);
    expect(onListNow(t, 'Mjölk')).toBe(true);
    expect(onListNow(t, 'Havremjölk')).toBe(false);
    expect(itemNames(t)).toEqual(['Havremjölk', 'Mjölk']);
    expect(t.store.state().entries.get(entryKey(t.listId, itemId(t.store, 'Mjölk')))?.note).toBe('laktosfri');
    expect(await t.input.getValue()).toBe('');
    expect(focused(t)).toBe(true);

    // at the top, so the keyboard doesn't hide it
    const snackBar = await t.loader.getHarness(MatSnackBarHarness);
    expect(await snackBar.getMessage()).toBe('Mjölk tillagd');
    expect(await snackBar.getActionDescription()).toBe('Ångra');
    const wrapper = document.querySelector<HTMLElement>('.mat-mdc-snack-bar-container')!.closest<HTMLElement>(
      '.cdk-global-overlay-wrapper',
    );
    expect(wrapper?.style.alignItems).toBe('flex-start');
    await snackBar.dismissWithAction();
    await t.fixture.whenStable();
    expect(onListNow(t, 'Mjölk')).toBe(false);
  });

  it('Enter creates a new item when nothing matches exactly', async () => {
    const t = await setup([['Grädde', 1]]);
    await type(t, 'grädd');
    // the create row comes last, farthest from the field
    expect(await titles(t)).toEqual(['Grädde', 'Lägg till "grädd"']);
    expect(icons(rowEls(t)[1]!)).toEqual(['add']);

    await enter(t);
    expect(itemNames(t)).toEqual(['Grädde', 'grädd']);
    expect(onListNow(t, 'grädd')).toBe(true);
    expect(onListNow(t, 'Grädde')).toBe(false);
    expect(await t.input.getValue()).toBe('');
    expect(await (await t.loader.getHarness(MatSnackBarHarness)).getMessage()).toBe('grädd tillagd');
  });

  it('tapping a fuzzy match adds that item and clears the field', async () => {
    const t = await setup([['Grädde', 1], ['Gräddfil', 2]]);
    await type(t, 'gradd');
    expect(await titles(t)).toEqual(['Gräddfil', 'Grädde', 'Lägg till "gradd"']);
    // matched letters are bold, as text
    expect([...rowEls(t)[1]!.querySelectorAll('b')].map((b) => b.textContent)).toEqual(['Grädd']);

    await (await t.loader.getHarness(MatActionListItemHarness.with({ title: 'Grädde' }))).click();
    await t.fixture.whenStable();
    expect(onListNow(t, 'Grädde')).toBe(true);
    expect(itemNames(t)).toEqual(['Grädde', 'Gräddfil']);
    expect(await t.input.getValue()).toBe('');
    expect(focused(t)).toBe(true);
    // the matches stay a moment, the added one highlighted, then the usual items are back
    expect(rowEls(t).find((r) => r.classList.contains('flash'))?.textContent).toContain('Grädde');
    await vi.waitFor(() => expect(t.el.querySelector('.flash')).toBeNull());
    expect(await titles(t)).toEqual(['Gräddfil', 'Grädde']);
  });

  it('items already on the list are marked and not added twice', async () => {
    const t = await setup([['Mjölk', 3]], ['Mjölk']);
    const outbox = await t.db.outbox.count();
    await type(t, 'mjölk');
    const [row] = rowEls(t);
    expect(row!.getAttribute('aria-disabled')).toBe('true');
    expect(icons(row!)).toEqual(['history', 'check']);
    expect(row!.querySelector('[data-mat-icon-name="check"]')?.getAttribute('aria-label')).toBe('På listan');

    row!.click();
    await t.fixture.whenStable();
    await enter(t);
    expect(await errors(t)).toEqual(['Finns redan på listan']);
    expect(await t.db.outbox.count()).toBe(outbox);
    expect(await t.loader.getAllHarnesses(MatSnackBarHarness)).toHaveLength(0);
  });

  it('a 201-character name shows the too-long message', async () => {
    const t = await setup();
    await type(t, 'a'.repeat(201));
    await enter(t);
    expect(await errors(t)).toEqual(['Högst 200 tecken']);
    expect(itemNames(t)).toEqual([]);
    expect(await t.input.getValue()).toBe('a'.repeat(201));

    // typing clears the message
    await type(t, 'a'.repeat(200));
    expect(await errors(t)).toEqual([]);
    await enter(t);
    expect(itemNames(t)).toEqual(['a'.repeat(200)]);
  });

  it('Enter on an empty field asks for a name', async () => {
    const t = await setup();
    await enter(t);
    expect(await errors(t)).toEqual(['Ange ett namn']);
  });

  it('close returns to the list, and Back from there does not reopen it', async () => {
    // opened from the list, and opened directly with nothing to go back to
    for (const [start, next] of [['/', '/add'], ['/add']] as const) {
      TestBed.resetTestingModule();
      configure(new PromusDb(`add-${newId()}`));
      const location = TestBed.inject(Location) as SpyLocation;
      location.setInitialPath(start);
      const harness = await RouterTestingHarness.create();
      const router = TestBed.inject(Router);
      // as at startup: from here on the router follows Back
      router.initialNavigation();
      await harness.fixture.whenStable();
      if (next) await harness.navigateByUrl(next);
      // the router takes up a Back in a timeout
      const settled = async () => {
        await new Promise((r) => setTimeout(r));
        await harness.fixture.whenStable();
      };
      const loader = TestbedHarnessEnvironment.documentRootLoader(harness.fixture);
      await (await loader.getHarness(MatButtonHarness.with({ selector: '[aria-label="Stäng"]' }))).click();
      await settled();
      expect([start, router.url]).toEqual([start, '/']);
      location.back();
      await settled();
      expect([start, router.url]).toEqual([start, '/']);
    }
  });
});
