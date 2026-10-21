import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { entryKey, frequentItems, newId, toSnapshot } from '@promus/shared';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { PromusDb } from './db';
import { DexieSyncStorage } from './dexie-storage';
import { requestPersistence } from './persist';
import { Store, ValidationError } from './store';

async function setup() {
  const db = new PromusDb(`store-${newId()}`);
  await db.setMeta('session', { userId: newId(), username: 'anna', householdId: newId() });
  TestBed.configureTestingModule({ providers: [{ provide: PromusDb, useValue: db }] });
  const store = TestBed.inject(Store);
  await store.load();
  const token = await store.createList('Inköpslista');
  return { db, store, listId: token.listId };
}

/** Another tab: its own connection to the same database, and its own Store. */
function otherTab(db: PromusDb): Store {
  const injector = createEnvironmentInjector(
    [{ provide: PromusDb, useValue: new PromusDb(db.name) }, DexieSyncStorage, Store],
    TestBed.inject(EnvironmentInjector),
  );
  onTestFinished(() => injector.destroy());
  return injector.get(Store);
}

const itemNamed = (store: Store, name: string) => {
  const item = [...store.state().items.values()].find((i) => i.name === name);
  if (!item) throw new Error(`no item ${name}`);
  return item;
};

describe('Store', () => {
  it('addByName re-adds an existing item instead of creating a duplicate', async () => {
    const { store, listId } = await setup();
    await store.addByName(listId, 'Mjölk');
    const mjolk = itemNamed(store, 'Mjölk');
    await store.check(listId, mjolk.id);
    const readded = await store.addByName(listId, ' MJÖLK ');
    expect(readded).toMatchObject({ messageKey: 'snack.added', params: { name: 'Mjölk' } });
    expect([...store.state().items.values()].map((i) => i.name)).toEqual(['Mjölk']);
    expect(store.state().entries.get(entryKey(listId, mjolk.id))?.state).toBe('active');
  });

  it('addByName prefills the previous note', async () => {
    const { store, listId } = await setup();
    await store.addByName(listId, 'Mjölk');
    const { id } = itemNamed(store, 'Mjölk');
    await store.setNote(listId, id, 'laktosfri');
    await store.remove(listId, id);
    await store.addByName(listId, 'mjölk');
    expect(store.state().entries.get(entryKey(listId, id))?.note).toBe('laktosfri');
  });

  it('addByName returns null when the item is already on the list', async () => {
    const { db, store, listId } = await setup();
    await store.addByName(listId, 'Mjölk');
    const written = await db.outbox.count();
    expect(await store.addByName(listId, 'mjölk')).toBeNull();
    expect(await db.outbox.count()).toBe(written);
  });

  it('rejects empty and over-long names', async () => {
    const { store, listId } = await setup();
    await expect(store.addByName(listId, '​ ')).rejects.toEqual(new ValidationError('name_empty'));
    await expect(store.addByName(listId, 'a'.repeat(201))).rejects.toMatchObject({ code: 'name_too_long' });
    await expect(store.setNote(listId, newId(), 'a'.repeat(501))).rejects.toMatchObject({ code: 'note_too_long' });
    expect(await store.addByName(listId, 'a'.repeat(200))).not.toBeNull();
  });

  it('undo restores the list', async () => {
    const { store, listId } = await setup();
    await store.addByName(listId, 'Mjölk');
    const mjolk = itemNamed(store, 'Mjölk');
    const checked = await store.check(listId, mjolk.id);
    expect(checked).toMatchObject({ messageKey: 'snack.checked', params: { name: 'Mjölk' } });
    await store.undo(checked!);
    expect(store.state().entries.get(entryKey(listId, mjolk.id))?.state).toBe('active');
    expect(itemNamed(store, 'Mjölk').purchaseCount).toBe(0);

    const added = await store.addByName(listId, 'Gräddfil');
    const graddfil = itemNamed(store, 'Gräddfil');
    await store.undo(added!);
    expect(itemNamed(store, 'Gräddfil').archived).toBe(true);
    expect(store.state().entries.has(entryKey(listId, graddfil.id))).toBe(false);
    expect(frequentItems(store.state(), listId, store.now()).map((i) => i.name)).not.toContain('Gräddfil');
  });

  it('actions survive a reload', async () => {
    const { store, listId } = await setup();
    await store.addByName(listId, 'Mjölk');
    await store.addByName(listId, 'Bröd');
    const brod = itemNamed(store, 'Bröd');
    await store.check(listId, brod.id);
    await store.setNote(listId, itemNamed(store, 'Mjölk').id, '2 st');
    await store.renameItem(brod.id, 'Surdegsbröd');
    const other = otherTab(TestBed.inject(PromusDb));
    await other.load();
    expect(toSnapshot(other.state())).toEqual(toSnapshot(store.state()));
    expect(other.pendingCount()).toBe(8);
  });

  it('reloads when another tab writes', async () => {
    const { db, store, listId } = await setup();
    const other = otherTab(db);
    await other.load();
    await other.addByName(listId, 'Bröd');
    await vi.waitFor(() => expect(itemNamed(store, 'Bröd')).toBeDefined(), { timeout: 1000 });
    await vi.waitFor(() => expect(store.pendingCount()).toBe(3), { timeout: 1000 });
  });

  it('never writes an invalid event', async () => {
    const { db, store, listId } = await setup();
    await store.addByName(listId, 'Mjölk');
    const written = await db.outbox.count();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(store.addItem('not-a-list-id', itemNamed(store, 'Mjölk').id)).rejects.toThrow();
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
    expect(await db.outbox.count()).toBe(written);
  });
});

describe('requestPersistence', () => {
  it('asks for persistent storage once', async () => {
    const db = new PromusDb(`persist-${newId()}`);
    const storage = { persist: vi.fn(async () => true), persisted: vi.fn(async () => true) };
    expect(await requestPersistence(db, storage as unknown as StorageManager)).toBe(true);
    expect(await requestPersistence(db, storage as unknown as StorageManager)).toBe(true);
    expect(storage.persist).toHaveBeenCalledOnce();
    expect(await db.getMeta('persistRequested')).toBe(true);
    expect(await requestPersistence(db, undefined)).toBe(false);
  });
});
