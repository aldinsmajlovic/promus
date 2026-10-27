import { Location } from '@angular/common';
import { SpyLocation, provideLocationMocks } from '@angular/common/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, importProvidersFrom, provideAppInitializer, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatSnackBarHarness } from '@angular/material/snack-bar/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { entryKey, newId } from '@promus/shared';
import { describe, expect, it, vi } from 'vitest';
import sv from '../../../i18n/sv.json';
import { CurrentList } from '../../core/current-list';
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
  const input = el.querySelector('input')!;
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
const name = (row: HTMLElement) => row.querySelector('.name')?.textContent?.trim();
const titles = (t: Setup) => rowEls(t).map((r) => name(r) ?? r.textContent?.trim());
const note = (row: HTMLElement) => row.querySelector('.note')?.textContent?.trim();
/** The row's lead: an add icon, the empty circle, or the filled one. */
const lead = (row: HTMLElement) =>
  row.querySelector('.circle.checked') ? 'checked' : row.querySelector('.circle') ? 'circle' : 'add';
/** The row's status text: On the list, Checked off, Added. */
const tag = (row: HTMLElement) => row.querySelector('.tag')?.textContent?.trim();

async function tap(t: Setup, row: HTMLElement) {
  row.click();
  await t.fixture.whenStable();
}

async function type(t: Setup, text: string) {
  t.input.value = text;
  t.input.dispatchEvent(new Event('input'));
  await t.fixture.whenStable();
}

async function enter(t: Setup) {
  t.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  await t.fixture.whenStable();
}

const errors = (t: Setup) => [...t.el.querySelectorAll('.error')].map((e) => e.textContent?.trim());
const focused = (t: Setup) => document.activeElement === t.input;

describe('AddPage', () => {
  it('an item comes back with its last quantity, shown after its name', async () => {
    const t = await setup([['Mjölk', 2]]);
    const id = itemId(t.store, 'Mjölk');
    await t.store.addItem(t.listId, id);
    await t.store.setQuantity(t.listId, id, 3);
    await t.store.remove(t.listId, id);
    await t.fixture.whenStable();
    expect(rowEls(t)[0]!.querySelector('.qty')?.textContent?.trim()).toBe('×3');
    await tap(t, rowEls(t)[0]!);
    expect(t.store.state().entries.get(entryKey(t.listId, id))?.quantity).toBe(3);
  });

  it('shows usual items when the field is empty', async () => {
    const t = await setup([['Kaffe', 3], ['Mjölk', 8, '2 st'], ['Gurka', 1], ['Ost', 5]], ['Ost']);
    expect(t.el.querySelector('.band .title')?.textContent?.trim()).toBe('Inköpslista');
    expect(await t.loader.getAllHarnesses(MatButtonHarness.with({ selector: '[aria-label="Stäng"]' }))).toHaveLength(1);
    expect(t.input.placeholder).toBe('Lägg till eller hitta');
    expect(focused(t)).toBe(true);

    // Ost is already on the list
    expect(titles(t)).toEqual(['Mjölk', 'Kaffe', 'Gurka']);
    expect(note(rowEls(t)[0]!)).toBe('2 st');
    expect(rowEls(t).map(lead)).toEqual(['add', 'add', 'add']);

    // tapping one adds it with its note; it stays in place, highlighted, marked Added
    await tap(t, rowEls(t)[1]!);
    expect(onListNow(t, 'Kaffe')).toBe(true);
    expect(titles(t)).toEqual(['Mjölk', 'Kaffe', 'Gurka']);
    expect(rowEls(t)[1]!.classList).toContain('flash');
    expect(tag(rowEls(t)[1]!)).toBe('Tillagd');
    await vi.waitFor(() => expect(rowEls(t)[1]!.classList).not.toContain('flash'));
    expect(focused(t)).toBe(true);
  });

  it('Enter re-adds an exact match', async () => {
    const t = await setup([['Mjölk', 2, 'laktosfri'], ['Havremjölk', 4]]);
    await type(t, ' MJÖLK');
    expect(titles(t)).toEqual(['Mjölk', 'Havremjölk']);

    await enter(t);
    expect(onListNow(t, 'Mjölk')).toBe(true);
    expect(onListNow(t, 'Havremjölk')).toBe(false);
    expect(itemNames(t)).toEqual(['Havremjölk', 'Mjölk']);
    expect(t.store.state().entries.get(entryKey(t.listId, itemId(t.store, 'Mjölk')))?.note).toBe('laktosfri');
    expect(t.input.value).toBe('');
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
    expect(titles(t)).toEqual(['Grädde', 'Lägg till "grädd"']);
    expect(lead(rowEls(t)[1]!)).toBe('add');

    await enter(t);
    expect(itemNames(t)).toEqual(['Grädde', 'grädd']);
    expect(onListNow(t, 'grädd')).toBe(true);
    expect(onListNow(t, 'Grädde')).toBe(false);
    expect(t.input.value).toBe('');
    expect(await (await t.loader.getHarness(MatSnackBarHarness)).getMessage()).toBe('grädd tillagd');
  });

  it('tapping a fuzzy match adds that item and clears the field', async () => {
    const t = await setup([['Grädde', 1], ['Gräddfil', 2]]);
    await type(t, 'gradd');
    expect(titles(t)).toEqual(['Gräddfil', 'Grädde', 'Lägg till "gradd"']);
    // matched letters are bold, as text
    expect([...rowEls(t)[1]!.querySelectorAll('b')].map((b) => b.textContent)).toEqual(['Grädd']);

    await tap(t, rowEls(t)[1]!);
    expect(onListNow(t, 'Grädde')).toBe(true);
    expect(itemNames(t)).toEqual(['Grädde', 'Gräddfil']);
    expect(t.input.value).toBe('');
    expect(focused(t)).toBe(true);
    // the matches stay a moment, the added one highlighted, then the usual items are back
    expect(rowEls(t).find((r) => r.classList.contains('flash'))?.textContent).toContain('Grädde');
    await vi.waitFor(() => expect(t.el.querySelector('.flash')).toBeNull());
    expect(titles(t)).toEqual(['Gräddfil', 'Grädde']);
  });

  it('an item on the list checks off from here, and back', async () => {
    const t = await setup([['Mjölk', 3]], ['Mjölk']);
    await type(t, 'mjö');
    const [row] = rowEls(t);
    expect([lead(row!), tag(row!)]).toEqual(['circle', 'På listan']);

    await tap(t, row!);
    expect(rowEls(t)[0]!.querySelector('.strike')).not.toBeNull();
    expect(await (await t.loader.getHarness(MatSnackBarHarness)).getMessage()).toBe('Mjölk avbockad');
    expect([lead(rowEls(t)[0]!), tag(rowEls(t)[0]!)]).toEqual(['checked', 'Avbockad']);

    await tap(t, rowEls(t)[0]!);
    expect(await (await t.loader.getHarness(MatSnackBarHarness)).getMessage()).toBe('Mjölk tillbaka på listan');
    expect([lead(rowEls(t)[0]!), tag(rowEls(t)[0]!)]).toEqual(['circle', 'På listan']);
  });

  it('Enter on an exact match on the list is refused and checks nothing off', async () => {
    const t = await setup([['Mjölk', 3]], ['Mjölk']);
    const outbox = await t.db.outbox.count();
    await type(t, 'mjölk');
    await enter(t);
    expect(errors(t)).toEqual(['Finns redan på listan']);
    expect(t.store.state().entries.get(entryKey(t.listId, itemId(t.store, 'Mjölk')))?.state).toBe('active');
    expect(await t.db.outbox.count()).toBe(outbox);
    expect(await t.loader.getAllHarnesses(MatSnackBarHarness)).toHaveLength(0);
  });

  it('a double tap on a usual item adds it once and leaves it on the list', async () => {
    const t = await setup([['Kaffe', 3]]);
    const outbox = await t.db.outbox.count();
    const [row] = rowEls(t);
    // both before the first add has resolved
    row!.click();
    row!.click();
    await t.fixture.whenStable();
    expect(t.store.state().entries.get(entryKey(t.listId, itemId(t.store, 'Kaffe')))?.state).toBe('active');
    expect(await (await t.loader.getHarness(MatSnackBarHarness)).getMessage()).toBe('Kaffe tillagd');
    expect(tag(rowEls(t)[0]!)).toBe('Tillagd');
    // a single entry.added
    expect(await t.db.outbox.count()).toBe(outbox + 1);
  });

  it('an undone add can be added again', async () => {
    const t = await setup([['Kaffe', 3]]);
    await tap(t, rowEls(t)[0]!);
    expect(tag(rowEls(t)[0]!)).toBe('Tillagd');
    await (await t.loader.getHarness(MatSnackBarHarness)).dismissWithAction();
    await t.fixture.whenStable();
    expect(onListNow(t, 'Kaffe')).toBe(false);
    expect([lead(rowEls(t)[0]!), tag(rowEls(t)[0]!), rowEls(t)[0]!.hasAttribute('disabled')]).toEqual([
      'add',
      undefined,
      false,
    ]);

    const outbox = await t.db.outbox.count();
    await tap(t, rowEls(t)[0]!);
    expect(onListNow(t, 'Kaffe')).toBe(true);
    expect(await t.db.outbox.count()).toBe(outbox + 1);
    expect(tag(rowEls(t)[0]!)).toBe('Tillagd');
  });

  it('Added lasts until you type', async () => {
    const t = await setup([['Kaffe', 3]]);
    await tap(t, rowEls(t)[0]!);
    expect(tag(rowEls(t)[0]!)).toBe('Tillagd');

    await type(t, 'kaf');
    expect([tag(rowEls(t)[0]!), rowEls(t)[0]!.hasAttribute('disabled')]).toEqual(['På listan', false]);
    await tap(t, rowEls(t)[0]!);
    expect(await (await t.loader.getHarness(MatSnackBarHarness)).getMessage()).toBe('Kaffe avbockad');
  });

  it('Added stays with the list it was added to', async () => {
    const t = await setup([['Kaffe', 3]]);
    await tap(t, rowEls(t)[0]!);
    expect(tag(rowEls(t)[0]!)).toBe('Tillagd');

    const { listId: other } = await t.store.createList('Apotek');
    TestBed.inject(CurrentList).select(other);
    await t.fixture.whenStable();
    expect(titles(t)).toEqual(['Kaffe']);
    // added there by someone else, as the row shows
    await t.store.addItem(other, itemId(t.store, 'Kaffe'));
    await t.fixture.whenStable();
    expect([tag(rowEls(t)[0]!), rowEls(t)[0]!.hasAttribute('disabled')]).toEqual(['På listan', false]);
  });

  it('a failed add leaves the row tappable', async () => {
    const t = await setup([['Kaffe', 3]]);
    const add = vi.spyOn(t.store, 'addItem').mockResolvedValueOnce(null);
    await tap(t, rowEls(t)[0]!);
    expect(onListNow(t, 'Kaffe')).toBe(false);
    expect([tag(rowEls(t)[0]!), rowEls(t)[0]!.hasAttribute('disabled')]).toEqual([undefined, false]);

    add.mockRestore();
    await tap(t, rowEls(t)[0]!);
    expect(onListNow(t, 'Kaffe')).toBe(true);
  });

  it('a 201-character name shows the too-long message', async () => {
    const t = await setup();
    await type(t, 'a'.repeat(201));
    await enter(t);
    expect(errors(t)).toEqual(['Högst 200 tecken']);
    expect(itemNames(t)).toEqual([]);
    expect(t.input.value).toBe('a'.repeat(201));

    // typing clears the message
    await type(t, 'a'.repeat(200));
    expect(errors(t)).toEqual([]);
    await enter(t);
    expect(itemNames(t)).toEqual(['a'.repeat(200)]);
  });

  it('Enter on an empty field asks for a name', async () => {
    const t = await setup();
    await enter(t);
    expect(errors(t)).toEqual(['Ange ett namn']);
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
