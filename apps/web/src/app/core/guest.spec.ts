import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { type ProviderToken, importProvidersFrom, provideAppInitializer, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatBottomSheetHarness } from '@angular/material/bottom-sheet/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSnackBarHarness } from '@angular/material/snack-bar/testing';
import { NavigationEnd, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { ApiError, SHARE_TTL_MS, cleanGuestName, formatHlc, makeEvent, newId } from '@promus/shared';
import type { EventInput, EventType, GuestMe, PayloadOf, StoredEvent } from '@promus/shared';
import Dexie from 'dexie';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import sv from '../../i18n/sv.json';
import { ROUTER_FEATURES } from '../app.config';
import { routes } from '../app.routes';
import { Actions } from './actions';
import { FETCH } from './api';
import { PromusDb } from './db';
import { Household } from './household';
import { registerIcons } from './icons';
import { WIDE } from './layout';
import { Store } from './store';
import { SyncService } from './sync.service';

const HOUSEHOLD_PATH = /^\/api\/(me|shares|sync|invites)\b/;
const error = (code: string, status: number) => Response.json({ error: code }, { status });
const offline = () => {
  throw new TypeError('Failed to fetch');
};

/** Who each link's guest is and who's on its list, as its `me` answers; `joined` fills it in. */
const mes = new Map<string, GuestMe>();

/**
 * `answer` answers a request first. The guest endpoints otherwise have nothing to pull, accept every push but an
 * archive or unarchive, which they refuse as the server does, and take every new name, kept in `renamed`.
 */
async function setup(wide = false) {
  const household = new PromusDb(`household-${newId()}`);
  const householdId = newId();
  await household.setMeta('session', { userId: newId(), username: 'anna', householdId });
  const asked: string[] = [];
  const pushed: Record<string, EventInput[]> = {};
  const renamed: [shareId: string, name: string][] = [];
  const server: { answer: (url: string) => Response | undefined } = { answer: () => undefined };
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    asked.push(url);
    const answer = server.answer(url);
    if (answer) return answer;
    const push = /^\/api\/guest\/([^/]+)\/push$/.exec(url);
    if (push) {
      const { events } = JSON.parse(String(init?.body)) as { events: EventInput[] };
      (pushed[push[1]!] ??= []).push(...events);
      const archives = (e: EventInput) => e.type === 'item.archived' || e.type === 'item.unarchived';
      return Response.json({
        accepted: events.filter((e) => !archives(e)).map((e) => e.id),
        rejected: events.filter(archives).map((e) => ({ id: e.id, code: 'out_of_scope', message: 'never by guests' })),
        serverTime: Date.now(),
      });
    }
    const pull = /^\/api\/guest\/[^/]+\/pull\?after=(\d+)/.exec(url);
    if (pull) return Response.json({ events: [], lastSeq: Number(pull[1]), hasMore: false, serverTime: Date.now() });
    const me = /^\/api\/guest\/([^/]+)\/me$/.exec(url);
    const found = me && mes.get(me[1]!);
    if (found) return Response.json(found);
    const rename = /^\/api\/guest\/([^/]+)\/name$/.exec(url);
    const guest = rename && mes.get(rename[1]!);
    if (guest) {
      const raw = (JSON.parse(String(init?.body)) as { name: string }).name;
      renamed.push([rename![1]!, raw]);
      const name = cleanGuestName(raw);
      guest.guest.name = name;
      guest.people = guest.people.map((p) => (p.id === guest.guest.id ? { ...p, name } : p));
      return new Response(null, { status: 204 });
    }
    return error('not_found', 404);
  });
  TestBed.configureTestingModule({
    providers: [
      { provide: PromusDb, useValue: household },
      { provide: FETCH, useValue: fetch },
      { provide: WIDE, useValue: signal(wide) },
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      provideRouter(routes, ...ROUTER_FEATURES),
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
  const harness = await RouterTestingHarness.create();
  const router = TestBed.inject(Router);
  const home = TestBed.inject(Store);
  await home.load();
  const { listId } = await home.createList('Inköpslista');
  await home.addByName(listId, 'Mjölk');
  /** The guest page's own instance. */
  const guestOf = <T,>(token: ProviderToken<T>): T => harness.routeDebugElement!.injector.get(token);
  /** Opens a link's page once its first sync is done and its list is shown. */
  const open = async (url: string) => {
    await harness.navigateByUrl(url);
    await guestOf(SyncService).syncNow();
    await guestOf(Store).load();
    await harness.fixture.whenStable();
  };
  const loader = TestbedHarnessEnvironment.documentRootLoader(harness.fixture);
  return { household, harness, router, server, asked, pushed, renamed, guestOf, open, loader };
}

let seq = 0;

/**
 * A guest of a link to "Tacokväll", as Task 8 leaves it after joining: meta in place, the list pulled. `items` are on
 * the list, `archived` items the household has archived, on the list too when also in `items`.
 */
async function joined(items: string[] = [], archived: string[] = []) {
  const shareId = newId();
  const listId = newId();
  const householdId = newId();
  const anna = newId();
  const guestId = newId();
  const at = Date.now() - 60_000;
  let counter = 0;
  const events: StoredEvent[] = [];
  /** An event as the link's pull answers it, by anna unless `userId` says who. */
  const event = <T extends EventType>(type: T, payload: PayloadOf<T>, userId = anna): StoredEvent => {
    const made = makeEvent(type, payload, { householdId, occurredAt: at, hlc: formatHlc(at, counter++, 'anna') });
    return { ...made, seq: ++seq, userId, receivedAt: at };
  };
  const add = <T extends EventType>(type: T, payload: PayloadOf<T>) => events.push(event(type, payload));
  add('list.created', { listId, name: 'Tacokväll' });
  const ids = new Map<string, string>();
  for (const name of items) {
    const itemId = newId();
    ids.set(name, itemId);
    add('item.created', { itemId, name });
    add('entry.added', { listId, itemId });
  }
  for (const name of archived) {
    let itemId = ids.get(name);
    if (!itemId) {
      itemId = newId();
      add('item.created', { itemId, name });
    }
    add('item.archived', { itemId });
  }
  const name = `promus-guest-${shareId}`;
  const db = new PromusDb(name);
  const token = `token-${shareId}`;
  const expiresAt = Date.now() + SHARE_TTL_MS;
  await db.setMeta('guest', { shareId, token, listId, householdId, sharedBy: 'anna', expiresAt });
  await db.setMeta('session', { userId: guestId, username: 'Jonas', householdId });
  await db.setMeta('currentListId', listId);
  const me: GuestMe = {
    guest: { id: guestId, name: 'Jonas' },
    share: { id: shareId, householdId, listId, expiresAt, sharedBy: 'anna' },
    people: [
      { id: anna, name: 'anna', guest: false },
      { id: guestId, name: 'Jonas', guest: true },
    ],
  };
  mes.set(shareId, structuredClone(me));
  await db.setMeta('me', me);
  await db.events.bulkPut(events);
  await db.setMeta('cursor', seq);
  db.close();
  /** Puts `more` in the link's data, as if pulled before the page opens. */
  const pulled = async (...more: StoredEvent[]) => {
    const again = new PromusDb(name);
    await again.events.bulkPut(more);
    await again.setMeta('cursor', seq);
    again.close();
  };
  return { shareId, listId, token, name, guestId, url: `/s/${shareId}`, event, pulled };
}

/** The names of the items these events make. */
const created = (events: EventInput[] = []) =>
  events.flatMap((e) => (e.type === 'item.created' ? [e.payload.name] : []));

/** The item names a database holds, pulled and queued. */
async function namesIn(db: PromusDb): Promise<string[]> {
  return created([...(await db.events.toArray()), ...(await db.outbox.toArray()).map((r) => r.event)]);
}

const ended = (router: Router) => router.lastSuccessfulNavigation()?.extras.state;

describe('guest mode', () => {
  it('two links and the household never share an event', async () => {
    const t = await setup();
    const taco = await joined(['Tortillas']);
    const bbq = await joined(['Korv']);

    await t.open(taco.url);
    await t.guestOf(Store).addByName(taco.listId, 'Chorizo');
    await t.guestOf(SyncService).syncNow();
    await t.harness.navigateByUrl('/share');
    await t.open(bbq.url);
    // the page left behind took its services with it: this one is the second link's
    expect(t.harness.routeNativeElement?.textContent).toContain('Korv');
    expect(t.harness.routeNativeElement?.textContent).not.toContain('Tortillas');
    await t.guestOf(Store).addByName(bbq.listId, 'Majskolvar');
    await t.guestOf(SyncService).syncNow();
    // the page left behind syncs no more
    const since = t.asked.length;
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(t.asked.slice(since).some((url) => url.includes(bbq.shareId))).toBe(true));
    expect(t.asked.slice(since).filter((url) => url.includes(taco.shareId))).toEqual([]);

    expect(created(t.pushed[taco.shareId])).toEqual(['Chorizo']);
    expect(created(t.pushed[bbq.shareId])).toEqual(['Majskolvar']);
    expect(await namesIn(new PromusDb(taco.name))).toEqual(['Tortillas', 'Chorizo']);
    expect(await namesIn(new PromusDb(bbq.name))).toEqual(['Korv', 'Majskolvar']);
    expect(await namesIn(t.household)).toEqual(['Mjölk']);
  });

  it('with its meta in place, a link opens offline', async () => {
    const t = await setup();
    const taco = await joined(['Tortillas']);
    t.server.answer = offline;
    await t.open(taco.url);
    expect(t.router.url).toBe(taco.url);
    expect(t.harness.routeNativeElement?.querySelector('h1')?.textContent).toContain('Tacokväll');
    expect(t.harness.routeNativeElement?.textContent).toContain('Tortillas');
    expect(t.guestOf(SyncService).status().kind).toBe('offline');
  });

  it('an ended link deletes its data and shows the ended page; the household keeps its own', async () => {
    const t = await setup();
    const taco = await joined(['Tortillas']);
    t.server.answer = (url) => (url.startsWith('/api/guest/') ? error('share_ended', 401) : undefined);
    await t.router.navigateByUrl(taco.url);
    await vi.waitFor(() => expect(t.router.url).toBe('/share/ended'));
    expect(ended(t.router)).toEqual({ sharedBy: 'anna' });
    expect(await Dexie.exists(taco.name)).toBe(false);
    expect(await namesIn(t.household)).toEqual(['Mjölk']);
    expect((await t.household.getMeta('session'))?.username).toBe('anna');
  });

  it('an expired link, its cookie gone with it, ends the same way once the link says so', async () => {
    const t = await setup();
    const taco = await joined(['Tortillas']);
    t.server.answer = (url) =>
      url === '/api/guest/check'
        ? error('share_invalid', 404)
        : url.startsWith('/api/guest/')
          ? error('unauthenticated', 401)
          : undefined;
    await t.router.navigateByUrl(taco.url);
    await vi.waitFor(() => expect(t.router.url).toBe('/share/ended'));
    expect(ended(t.router)).toEqual({ sharedBy: 'anna' });
    expect(await Dexie.exists(taco.name)).toBe(false);
  });

  const live = (shareId: string) =>
    Response.json({ shareId, listName: 'Tacokväll', sharedBy: 'anna', expiresAt: 1, joined: false });
  it.each([
    ['works', live],
    ['is full', () => error('share_full', 409)],
  ])('without its cookie, a link that %s asks for the name again and keeps the data', async (_case, check) => {
    const t = await setup();
    const taco = await joined(['Tortillas']);
    t.server.answer = (url) =>
      url === '/api/guest/check'
        ? check(taco.shareId)
        : url.startsWith('/api/guest/')
          ? error('unauthenticated', 401)
          : undefined;
    // the name step's own check may send it on: a full link to the ended page
    const went: string[] = [];
    t.router.events.subscribe((e) => e instanceof NavigationEnd && went.push(e.urlAfterRedirects));
    await t.router.navigateByUrl(taco.url);
    await vi.waitFor(() => expect(went).toContain(`/share#${taco.token}`));
    expect(await Dexie.exists(taco.name)).toBe(true);
  });

  it('without its cookie and offline, it stays on the list', async () => {
    const t = await setup();
    const taco = await joined(['Tortillas']);
    t.server.answer = (url) =>
      url === '/api/guest/check'
        ? offline()
        : url.startsWith('/api/guest/')
          ? error('unauthenticated', 401)
          : undefined;
    await t.harness.navigateByUrl(taco.url);
    await vi.waitFor(() => expect(t.asked).toContain('/api/guest/check'));
    await t.guestOf(SyncService).syncNow();
    expect(t.guestOf(SyncService).status().kind).toBe('offline');
    expect(t.router.url).toBe(taco.url);
    expect(await Dexie.exists(taco.name)).toBe(true);
  });

  it('without its cookie, a server error from the link check keeps the page and the data, and asks again', async () => {
    const t = await setup();
    const taco = await joined(['Tortillas']);
    t.server.answer = (url) =>
      url === '/api/guest/check'
        ? error('internal', 503)
        : url.startsWith('/api/guest/')
          ? error('unauthenticated', 401)
          : undefined;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    onTestFinished(() => log.mockRestore());
    await t.harness.navigateByUrl(taco.url);
    const sync = t.guestOf(SyncService);
    await sync.syncNow();
    await sync.syncNow();
    expect(sync.status()).toMatchObject({ kind: 'error', messageKey: 'sync.serverError' });
    expect(log).toHaveBeenCalledWith('sync failed', expect.any(ApiError));
    expect(t.asked.filter((url) => url === '/api/guest/check').length).toBeGreaterThan(1);
    expect(t.router.url).toBe(taco.url);
    expect(await Dexie.exists(taco.name)).toBe(true);
  });

  it('without its meta, a 401 shows the ended page and keeps the data', async () => {
    const t = await setup();
    const taco = await joined(['Tortillas']);
    await t.open(taco.url);
    const sync = t.guestOf(SyncService);
    await t.guestOf(PromusDb).meta.delete('guest');
    t.server.answer = (url) => (url.startsWith('/api/guest/') ? error('share_ended', 401) : undefined);
    await sync.syncNow();
    expect(t.router.url).toBe('/share/ended');
    expect(ended(t.router)).toEqual({ sharedBy: null });
    expect(await Dexie.exists(taco.name)).toBe(true);
  });

  it.each([false, true])(
    'an ended link closes the open options and the snackbar before the ended page (computer: %s)',
    async (wide) => {
      const t = await setup(wide);
      const taco = await joined(['Tortillas']);
      await t.open(taco.url);
      const sync = t.guestOf(SyncService);
      await t.guestOf(Actions).run(t.guestOf(Store).addByName(taco.listId, 'Chorizo'));
      t.harness.routeNativeElement!.querySelector<HTMLElement>('[aria-label="Alternativ för Tortillas"]')!.click();
      await (wide ? t.loader.getHarness(MatDialogHarness) : t.loader.getHarness(MatBottomSheetHarness));
      expect(await t.loader.getAllHarnesses(MatSnackBarHarness)).toHaveLength(1);
      const log = vi.spyOn(console, 'error');
      onTestFinished(() => log.mockRestore());
      t.server.answer = (url) => (url.startsWith('/api/guest/') ? error('share_ended', 401) : undefined);
      await sync.syncNow();
      await t.harness.fixture.whenStable();
      expect(t.router.url).toBe('/share/ended');
      expect(await t.loader.getAllHarnesses(MatBottomSheetHarness)).toHaveLength(0);
      expect(await t.loader.getAllHarnesses(MatDialogHarness)).toHaveLength(0);
      expect(await t.loader.getAllHarnesses(MatSnackBarHarness)).toHaveLength(0);
      expect(log).not.toHaveBeenCalled();
    },
  );

  it("a left page's database closes, so nothing late makes it again", async () => {
    const t = await setup();
    const taco = await joined(['Tortillas']);
    await t.open(taco.url);
    const db = t.guestOf(PromusDb);
    await t.harness.navigateByUrl('/share');
    expect(db.isOpen()).toBe(false);
    await expect(db.getMeta('guest')).rejects.toThrow();
  });

  it("once another tab deletes a link's data, this tab's instance can't make it again", async () => {
    const t = await setup();
    const taco = await joined(['Tortillas']);
    await t.open(taco.url);
    const db = t.guestOf(PromusDb);
    await new PromusDb(taco.name).delete();
    await expect(db.getMeta('guest')).rejects.toThrow();
    expect(await Dexie.exists(taco.name)).toBe(false);
  });

  it("a guest's Undo in the snackbar takes back the guest's own change", async () => {
    const t = await setup();
    const taco = await joined(['Tortillas']);
    await t.open(taco.url);
    t.harness.routeNativeElement!.querySelector<HTMLElement>('[role="checkbox"][aria-checked="false"]')!.click();
    await t.harness.fixture.whenStable();
    await (await t.loader.getHarness(MatSnackBarHarness)).dismissWithAction();
    await t.harness.fixture.whenStable();
    await t.guestOf(SyncService).syncNow();
    expect(t.pushed[taco.shareId]?.map((e) => e.type)).toEqual(['entry.checked', 'entry.unchecked']);
    const household = (await t.household.outbox.toArray()).map((r) => r.event.type);
    expect(household).toEqual(['list.created', 'item.created', 'entry.added']);
  });

  it("a guest typing an archived item's name puts it back on the list, and only that", async () => {
    const t = await setup();
    const taco = await joined([], ['Gräddfil']);
    await t.open(taco.url);
    await t.guestOf(Actions).run(t.guestOf(Store).addByName(taco.listId, 'gräddfil'));
    await t.guestOf(SyncService).syncNow();
    await t.harness.fixture.whenStable();
    expect(t.pushed[taco.shareId]?.map((e) => e.type)).toEqual(['entry.added']);
    expect(t.guestOf(SyncService).status().kind).toBe('idle');
    expect(t.harness.routeNativeElement?.textContent).toContain('Gräddfil');
  });

  it("a guest typing the name of an archived item already on the list adds nothing, and offers no Undo", async () => {
    const t = await setup();
    const taco = await joined(['Gräddfil'], ['Gräddfil']);
    await t.open(taco.url);
    expect(await t.guestOf(Actions).run(t.guestOf(Store).addByName(taco.listId, 'gräddfil'))).toBeNull();
    await t.harness.fixture.whenStable();
    expect(await t.loader.getAllHarnesses(MatSnackBarHarness)).toHaveLength(0);
    await t.guestOf(SyncService).syncNow();
    expect(t.pushed[taco.shareId]).toBeUndefined();
  });

  it("a guest's undo of a new item takes only the entry back", async () => {
    const t = await setup();
    const taco = await joined();
    await t.open(taco.url);
    const store = t.guestOf(Store);
    await store.undo((await store.addByName(taco.listId, 'Chorizo'))!);
    await t.guestOf(SyncService).syncNow();
    expect(t.pushed[taco.shareId]?.map((e) => e.type)).toEqual(['item.created', 'entry.added', 'entry.removed']);
  });

  it.each([false, true])("item options on a guest's list change the guest's data (computer: %s)", async (wide) => {
    const t = await setup(wide);
    const taco = await joined(['Tortillas']);
    await t.open(taco.url);
    t.harness.routeNativeElement!.querySelector<HTMLElement>('[aria-label="Alternativ för Tortillas"]')!.click();
    const options = wide
      ? await t.loader.getHarness(MatDialogHarness)
      : await t.loader.getHarness(MatBottomSheetHarness);
    const note = await options.getHarness(MatFormFieldHarness.with({ floatingLabelText: 'Anteckning' }));
    await (await note.getControl(MatInputHarness))!.setValue('majs');
    await (options instanceof MatDialogHarness ? options.close() : options.dismiss());
    await t.harness.fixture.whenStable();
    const noted = async (db: PromusDb) => (await db.outbox.toArray()).filter((r) => r.event.type === 'entry.noteSet');
    expect(await noted(new PromusDb(taco.name))).toHaveLength(1);
    expect(await noted(t.household)).toHaveLength(0);
  });

  it('calls no household endpoint, and shows none of its people', async () => {
    const t = await setup();
    await t.household.setMeta('members', [{ id: newId(), username: 'fredrik', role: 'member' }]);
    // added by someone the guest's page doesn't know: on the household's page, that asks the server for its links
    const taco = await joined(['Tortillas']);
    await t.open(taco.url);
    expect(t.asked).toContain(`/api/guest/${taco.shareId}/pull?after=${seq}&limit=500`);
    expect(t.asked.filter((url) => HOUSEHOLD_PATH.test(url))).toEqual([]);
    expect(t.guestOf(Household).members()).toEqual([]);
  });

  it('a link this browser has no data for has ended, by no one it can name', async () => {
    const t = await setup();
    const shareId = newId();
    await t.router.navigateByUrl(`/s/${shareId}`);
    expect(t.router.url).toBe('/share/ended');
    expect(ended(t.router)).toEqual({ sharedBy: null });
    expect(await Dexie.exists(`promus-guest-${shareId}`)).toBe(false);
  });
});

describe("the guest's screens", () => {
  const page = (t: Awaited<ReturnType<typeof setup>>) => t.harness.routeNativeElement!;
  const household = (t: Awaited<ReturnType<typeof setup>>) => t.asked.filter((url) => HOUSEHOLD_PATH.test(url));

  it('the list shows its name, with no list menu and no Settings', async () => {
    const t = await setup();
    const taco = await joined(['Tortillas']);
    await t.open(taco.url);
    expect(page(t).querySelector('h1')?.textContent?.trim()).toBe('Tacokväll');
    expect(page(t).querySelector('app-list-menu')).toBeNull();
    expect(page(t).querySelector('[href="/settings"]')).toBeNull();
  });

  it.each([false, true])('item options have no "Remove from suggestions" (computer: %s)', async (wide) => {
    const t = await setup(wide);
    const taco = await joined(['Tortillas']);
    await t.open(taco.url);
    page(t).querySelector<HTMLElement>('[aria-label="Alternativ för Tortillas"]')!.click();
    const options = await (wide ? t.loader.getHarness(MatDialogHarness) : t.loader.getHarness(MatBottomSheetHarness));
    const text = await (await options.host()).text();
    expect(text).toContain(sv.edit.remove);
    expect(text).not.toContain(sv.edit.archive);
  });

  it('rows and "with" name the people on the list as the link says, offline too', async () => {
    const t = await setup();
    const taco = await joined(['Tortillas']);
    t.server.answer = offline;
    await t.open(taco.url);
    await vi.waitFor(() => expect(page(t).querySelector('.with')?.getAttribute('aria-label')).toBe('Delas med anna'));
    expect(page(t).querySelector('li app-face')?.textContent?.trim()).toBe('A');
  });

  it("who's on the list is asked when the page opens, and again only when a pull brings changes", async () => {
    const t = await setup();
    const taco = await joined(['Tortillas']);
    const asks = () => t.asked.filter((url) => url === `/api/guest/${taco.shareId}/me`).length;
    await t.open(taco.url);
    await vi.waitFor(() => expect(asks()).toBe(1));
    const sync = t.guestOf(SyncService);
    await sync.syncNow();
    await t.harness.fixture.whenStable();
    expect(asks()).toBe(1);
    const renamed = taco.event('list.renamed', { listId: taco.listId, name: 'Taco' });
    t.server.answer = (url) =>
      url.includes('/pull?')
        ? Response.json({ events: [renamed], lastSeq: renamed.seq, hasMore: false, serverTime: Date.now() })
        : undefined;
    await sync.syncNow();
    await vi.waitFor(() => expect(asks()).toBe(2));
    expect(household(t)).toEqual([]);
  });

  it("an entry the guest's phone got without its add names no one, while the guest's own says you", async () => {
    const t = await setup();
    const taco = await joined();
    const [gurka, korv] = [newId(), newId()];
    await taco.pulled(
      taco.event('item.created', { itemId: gurka, name: 'Gurka' }),
      taco.event('entry.unchecked', { listId: taco.listId, itemId: gurka }),
      taco.event('item.created', { itemId: korv, name: 'Korv' }, taco.guestId),
      taco.event('entry.added', { listId: taco.listId, itemId: korv }, taco.guestId),
    );
    await t.open(taco.url);
    const options = async (name: string) => {
      page(t).querySelector<HTMLElement>(`[aria-label="Alternativ för ${name}"]`)!.click();
      const sheet = await t.loader.getHarness(MatBottomSheetHarness);
      const text = await (await sheet.host()).text();
      await sheet.dismiss();
      await t.harness.fixture.whenStable();
      return text;
    };
    expect(await options('Gurka')).not.toContain(sv.edit.addedByYou);
    expect(await options('Korv')).toContain(sv.edit.addedByYou);
  });

  it.each([false, true])(
    "Add or find stays in the link's data, and finds only what's been on its list (computer: %s)",
    async (wide) => {
      const t = await setup(wide);
      const taco = await joined(['Tortillas']);
      await t.open(taco.url);
      if (!wide) {
        page(t).querySelector<HTMLElement>('a.dock')!.click();
        await vi.waitFor(() => expect(t.router.url).toBe(`${taco.url}/add`));
        await t.harness.fixture.whenStable();
      }
      const field = page(t).querySelector<HTMLInputElement>('.add-field input')!;
      const search = async (text: string) => {
        field.value = text;
        field.dispatchEvent(new Event('input'));
        await t.harness.fixture.whenStable();
        return [...page(t).querySelectorAll('.results .row')].map((r) => r.textContent?.trim());
      };
      // the household's Mjölk is unknown here: typing it offers a new item
      expect(await search('Mjölk')).toEqual(['Lägg till "Mjölk"']);
      expect(await search('Tort')).toEqual([`Tortillas${sv.add.onList}`, 'Lägg till "Tort"']);
      await search('Chorizo');
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await t.harness.fixture.whenStable();
      await t.guestOf(SyncService).syncNow();
      expect(created(t.pushed[taco.shareId])).toEqual(['Chorizo']);
      expect(await namesIn(t.household)).toEqual(['Mjölk']);
      expect(household(t)).toEqual([]);
    },
  );

  it("Add or find opened straight from its address closes to the guest's list", async () => {
    const t = await setup();
    const taco = await joined(['Tortillas']);
    await t.harness.navigateByUrl(`${taco.url}/add`);
    await t.harness.fixture.whenStable();
    page(t).querySelector<HTMLElement>(`[aria-label="${sv.dialog.close}"]`)!.click();
    await vi.waitFor(() => expect(t.router.url).toBe(taco.url));
  });

  it("the guest's initial opens their sheet: a new name changes their face, and Undo changes it back", async () => {
    const t = await setup();
    const taco = await joined(['Tortillas']);
    await t.open(taco.url);
    const profile = () => page(t).querySelector<HTMLElement>('app-profile-button button')!;
    expect(profile().getAttribute('aria-label')).toBe('Jonas: ditt namn och språk');
    profile().click();
    const sheet = await t.loader.getHarness(MatBottomSheetHarness);
    const field = await sheet.getHarness(MatInputHarness);
    expect(await field.getValue()).toBe('Jonas');
    await field.setValue('Kalle');
    await (await sheet.getHarness(MatButtonHarness.with({ text: sv.guest.save }))).click();
    await vi.waitFor(() => expect(profile().textContent?.trim()).toBe('K'));
    expect(profile().getAttribute('aria-label')).toBe('Kalle: ditt namn och språk');
    expect(t.renamed).toEqual([[taco.shareId, 'Kalle']]);
    expect((await t.guestOf(PromusDb).getMeta('session'))?.username).toBe('Kalle');
    expect(t.guestOf(Household).person(taco.guestId)?.name).toBe('Kalle');
    const snack = await t.loader.getHarness(MatSnackBarHarness);
    expect(await snack.getMessage()).toBe('Bytt namn till Kalle');
    await snack.dismissWithAction();
    await vi.waitFor(() => expect(profile().textContent?.trim()).toBe('J'));
    expect(t.renamed.at(-1)).toEqual([taco.shareId, 'Jonas']);
    expect(household(t)).toEqual([]);
  });

  it('a name of only spaces makes the guest Guest, with a G', async () => {
    const t = await setup();
    const taco = await joined(['Tortillas']);
    await t.open(taco.url);
    const profile = () => page(t).querySelector<HTMLElement>('app-profile-button button')!;
    profile().click();
    const sheet = await t.loader.getHarness(MatBottomSheetHarness);
    await (await sheet.getHarness(MatInputHarness)).setValue('   ');
    await (await sheet.getHarness(MatButtonHarness.with({ text: sv.guest.save }))).click();
    await vi.waitFor(() => expect(profile().textContent?.trim()).toBe('G'));
    expect(profile().getAttribute('aria-label')).toBe('Gäst: ditt namn och språk');
  });

  it('a name the server finds too long is shown on the field, and the name stays', async () => {
    const t = await setup();
    const taco = await joined(['Tortillas']);
    await t.open(taco.url);
    t.server.answer = (url) => (url.endsWith('/name') ? error('name_too_long', 400) : undefined);
    const profile = () => page(t).querySelector<HTMLElement>('app-profile-button button')!;
    profile().click();
    const sheet = await t.loader.getHarness(MatBottomSheetHarness);
    const field = await sheet.getHarness(MatInputHarness);
    expect(await (await field.host()).getProperty('maxLength')).toBe(40);
    await field.setValue('Kalle');
    await (await sheet.getHarness(MatButtonHarness.with({ text: sv.guest.save }))).click();
    await vi.waitFor(async () => expect(await (await sheet.host()).text()).toContain('Högst 40 tecken'));
    expect(profile().textContent?.trim()).toBe('J');
  });
});
