import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, type ProviderToken, importProvidersFrom, provideAppInitializer, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatBottomSheetHarness } from '@angular/material/bottom-sheet/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { Router, provideRouter, withAutoCleanupInjectors } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { SHARE_TTL_MS, type EventInput, type StoredEvent, formatHlc, makeEvent, newId } from '@promus/shared';
import Dexie from 'dexie';
import { describe, expect, it, vi } from 'vitest';
import sv from '../../i18n/sv.json';
import { routes } from '../app.routes';
import { FETCH } from './api';
import { PromusDb } from './db';
import { Household } from './household';
import { registerIcons } from './icons';
import { WIDE } from './layout';
import { Store } from './store';
import { SyncService } from './sync.service';

// stands in for Task 8's pages: these specs only see where a guest is sent
@Component({ template: '' })
class Elsewhere {}

const HOUSEHOLD_PATH = /^\/api\/(me|shares|sync|invites)\b/;
const error = (code: string, status: number) => Response.json({ error: code }, { status });
const offline = () => {
  throw new TypeError('Failed to fetch');
};

/** `answer` answers a request first; the guest endpoints otherwise accept every push and have nothing to pull. */
async function setup() {
  const household = new PromusDb(`household-${newId()}`);
  const householdId = newId();
  await household.setMeta('session', { userId: newId(), username: 'anna', householdId });
  const asked: string[] = [];
  const pushed: Record<string, EventInput[]> = {};
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
      return Response.json({ accepted: events.map((e) => e.id), rejected: [], serverTime: Date.now() });
    }
    const pull = /^\/api\/guest\/[^/]+\/pull\?after=(\d+)/.exec(url);
    if (pull) return Response.json({ events: [], lastSeq: Number(pull[1]), hasMore: false, serverTime: Date.now() });
    return error('not_found', 404);
  });
  TestBed.configureTestingModule({
    providers: [
      { provide: PromusDb, useValue: household },
      { provide: FETCH, useValue: fetch },
      { provide: WIDE, useValue: signal(false) },
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      // as app.config has it
      provideRouter(
        [...routes, { path: 'share/ended', component: Elsewhere }, { path: 'share', component: Elsewhere }],
        withAutoCleanupInjectors(),
      ),
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
  return { household, harness, router, server, asked, pushed, guestOf, open };
}

let seq = 0;

/** A guest of a link to "Tacokväll", as Task 8 leaves it after joining: meta in place, the list pulled. */
async function joined(items: string[] = [], addedBy = newId()) {
  const shareId = newId();
  const listId = newId();
  const householdId = newId();
  const at = Date.now() - 60_000;
  const event = (e: EventInput, userId: string): StoredEvent => ({ ...e, seq: ++seq, userId, receivedAt: at });
  const meta = (counter: number) => ({ householdId, occurredAt: at, hlc: formatHlc(at, counter, 'anna') });
  const events = [event(makeEvent('list.created', { listId, name: 'Tacokväll' }, meta(0)), newId())];
  items.forEach((name, i) => {
    const itemId = newId();
    events.push(event(makeEvent('item.created', { itemId, name }, meta(2 * i + 1)), addedBy));
    events.push(event(makeEvent('entry.added', { listId, itemId }, meta(2 * i + 2)), addedBy));
  });
  const name = `promus-guest-${shareId}`;
  const db = new PromusDb(name);
  const token = `token-${shareId}`;
  await db.setMeta('guest', {
    shareId,
    token,
    listId,
    householdId,
    sharedBy: 'anna',
    expiresAt: Date.now() + SHARE_TTL_MS,
  });
  await db.setMeta('session', { userId: newId(), username: 'Jonas', householdId });
  await db.setMeta('currentListId', listId);
  await db.events.bulkPut(events);
  await db.setMeta('cursor', seq);
  db.close();
  return { shareId, listId, token, name, url: `/s/${shareId}` };
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
    const bbq = await joined();

    await t.open(taco.url);
    await t.guestOf(Store).addByName(taco.listId, 'Chorizo');
    await t.guestOf(SyncService).syncNow();
    await t.harness.navigateByUrl('/share');
    await t.open(bbq.url);
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
    expect(await namesIn(new PromusDb(bbq.name))).toEqual(['Majskolvar']);
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

  it('without its cookie, a live link asks for the name again and keeps the data', async () => {
    const t = await setup();
    const taco = await joined(['Tortillas']);
    const check = { shareId: taco.shareId, listName: 'Tacokväll', sharedBy: 'anna', expiresAt: 1, joined: false };
    t.server.answer = (url) =>
      url === '/api/guest/check'
        ? Response.json(check)
        : url.startsWith('/api/guest/')
          ? error('unauthenticated', 401)
          : undefined;
    await t.router.navigateByUrl(taco.url);
    await vi.waitFor(() => expect(t.router.url).toBe(`/share#${taco.token}`));
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

  it("a guest's undo of a new item takes only the entry back", async () => {
    const t = await setup();
    const taco = await joined();
    await t.open(taco.url);
    const store = t.guestOf(Store);
    await store.undo((await store.addByName(taco.listId, 'Chorizo'))!);
    await t.guestOf(SyncService).syncNow();
    expect(t.pushed[taco.shareId]?.map((e) => e.type)).toEqual(['item.created', 'entry.added', 'entry.removed']);
  });

  it("item options on a guest's list change the guest's data", async () => {
    const t = await setup();
    const taco = await joined(['Tortillas']);
    await t.open(taco.url);
    t.harness.routeNativeElement!.querySelector<HTMLElement>('[aria-label="Alternativ för Tortillas"]')!.click();
    const loader = TestbedHarnessEnvironment.documentRootLoader(t.harness.fixture);
    const sheet = await loader.getHarness(MatBottomSheetHarness);
    const note = await sheet.getHarness(MatFormFieldHarness.with({ floatingLabelText: 'Anteckning' }));
    await (await note.getControl(MatInputHarness))!.setValue('majs');
    await sheet.dismiss();
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
