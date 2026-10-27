import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { importProvidersFrom, provideAppInitializer, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatInputHarness } from '@angular/material/input/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { type GuestMe, SHARE_TTL_MS, cleanGuestName, newId } from '@promus/shared';
import Dexie from 'dexie';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../i18n/en.json';
import sv from '../../../i18n/sv.json';
import { ROUTER_FEATURES } from '../../app.config';
import { routes } from '../../app.routes';
import { FETCH } from '../../core/api';
import { PromusDb, type Session } from '../../core/db';
import { registerIcons } from '../../core/icons';
import { WIDE } from '../../core/layout';
import { SessionService } from '../../core/session';

const error = (code: string, status: number) => Response.json({ error: code }, { status });
const offline = () => {
  throw new TypeError('Failed to fetch');
};
const checked = (shareId: string) => ({ shareId, listName: 'Tacokväll', sharedBy: 'anna', expiresAt: 1, joined: false });

/** Each answers first; undefined leaves it to the link's usual answer. */
type Answers = {
  check?: (shareId: string) => Response;
  join?: () => Response | undefined;
  me?: () => Response | undefined;
  shares?: (shareId: string) => Response;
};

/** `/share#<token>` for a link to anna's "Tacokväll"; `session` is a household signed in on this browser. */
async function setup(answers: Answers = {}, session?: Session) {
  const household = new PromusDb(`household-${newId()}`);
  if (session) await household.setMeta('session', session);
  const shareId = newId();
  // its own per test: the page looks through every link's data on this browser
  const token = `token-${shareId}`;
  const listId = newId();
  const householdId = newId();
  const guestId = newId();
  let name: string | null = null;
  const me = (): GuestMe => ({
    guest: { id: guestId, name },
    share: { id: shareId, householdId, listId, expiresAt: Date.now() + SHARE_TTL_MS, sharedBy: 'anna' },
    people: [
      { id: newId(), name: 'anna', guest: false },
      { id: guestId, name, guest: true },
    ],
  });
  const asked: { url: string; body: unknown }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
    asked.push({ url, body });
    if (url === '/api/guest/check') {
      if (answers.check) return answers.check(shareId);
      return Response.json(checked(shareId));
    }
    if (url === '/api/guest/join') {
      const answer = answers.join?.();
      if (answer) return answer;
      name = cleanGuestName((body as { name?: string }).name);
      return Response.json({ shareId, guest: { id: guestId, name } }, { status: 201 });
    }
    if (url === `/api/guest/${shareId}/me`) return answers.me?.() ?? Response.json(me());
    const pull = /^\/api\/guest\/[^/]+\/pull\?after=(\d+)/.exec(url);
    if (pull) return Response.json({ events: [], lastSeq: Number(pull[1]), hasMore: false, serverTime: Date.now() });
    if (url === '/api/shares') return answers.shares?.(shareId) ?? Response.json({ shares: [], guests: [] });
    if (url === '/api/me') return Response.json({ user: { id: session?.userId, username: 'bo' }, households: [] });
    return error('not_found', 404);
  });
  TestBed.configureTestingModule({
    providers: [
      { provide: PromusDb, useValue: household },
      { provide: FETCH, useValue: fetch },
      { provide: WIDE, useValue: signal(false) },
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      provideRouter(routes, ...ROUTER_FEATURES),
      provideAppInitializer(registerIcons),
      importProvidersFrom(
        TranslocoTestingModule.forRoot({
          langs: { sv, en },
          translocoConfig: { availableLangs: ['sv', 'en'], defaultLang: 'sv', reRenderOnLangChange: true },
          preloadLangs: true,
        }),
      ),
    ],
  });
  // as the app's startup does: the household's session, if any, is known before a page opens
  await TestBed.inject(SessionService).load();
  const harness = await RouterTestingHarness.create();
  const router = TestBed.inject(Router);
  const el = (): HTMLElement => harness.fixture.nativeElement;
  const loader = TestbedHarnessEnvironment.documentRootLoader(harness.fixture);
  const guestDb = () => new PromusDb(`promus-guest-${shareId}`);
  /** Opens the link, and waits for the name step. */
  const open = async () => {
    await harness.navigateByUrl(`/share#${token}`);
    await vi.waitFor(() => expect(el().querySelector('input')).not.toBeNull());
  };
  const typeName = async (value: string) => (await loader.getHarness(MatInputHarness)).setValue(value);
  const openList = async () =>
    (await loader.getHarness(MatButtonHarness.with({ text: sv.guest.open }))).click();
  const urls = () => asked.map((a) => a.url);
  /** This browser joined the link before: its data is here. */
  const joinedHere = async () => {
    const db = guestDb();
    const expiresAt = Date.now() + SHARE_TTL_MS;
    await db.setMeta('guest', { shareId, token, listId, householdId, sharedBy: 'anna', expiresAt });
    await db.setMeta('session', { userId: guestId, username: 'Jonas', householdId });
    db.close();
  };
  const ids = { shareId, token, listId, householdId, guestId, joinedHere };
  return { ...ids, household, harness, router, el, loader, guestDb, asked, urls, open, typeName, openList };
}

const anna: Session = { userId: newId(), username: 'anna', householdId: newId() };

describe('SharePage', () => {
  it('says who shared which list, with the name field ready to type in', async () => {
    const t = await setup();
    await t.open();
    await vi.waitFor(() => expect(t.el().querySelector('h1')?.textContent).toContain('anna delade Tacokväll'));
    await t.harness.fixture.whenStable();
    expect(document.activeElement).toBe(t.el().querySelector('input'));
    expect(t.asked[0]).toEqual({ url: '/api/guest/check', body: { token: t.token } });
  });

  it('an empty name joins as Guest, and the list opens from its own data', async () => {
    const t = await setup();
    await t.open();
    await t.openList();
    await vi.waitFor(() => expect(t.router.url).toBe(`/s/${t.shareId}`));
    expect(t.asked.find((a) => a.url === '/api/guest/join')?.body).toEqual({ token: t.token, name: '' });
    const db = t.guestDb();
    expect(await db.getMeta('guest')).toEqual({
      shareId: t.shareId,
      token: t.token,
      listId: t.listId,
      householdId: t.householdId,
      sharedBy: 'anna',
      expiresAt: expect.any(Number),
    });
    expect(await db.getMeta('session')).toEqual({ userId: t.guestId, username: '', householdId: t.householdId });
    expect(await db.getMeta('currentListId')).toBe(t.listId);
    // the token travels in bodies only
    expect(t.urls().some((url) => url.includes(t.token))).toBe(false);
    // the household's data is never touched
    expect(await t.household.getMeta('session')).toBeUndefined();
  });

  it('a name joins under that name', async () => {
    const t = await setup();
    await t.open();
    await t.typeName('Jonas');
    await t.openList();
    await vi.waitFor(() => expect(t.router.url).toBe(`/s/${t.shareId}`));
    expect((await t.guestDb().getMeta('session'))?.username).toBe('Jonas');
  });

  it('a name of only spaces joins as Guest', async () => {
    const t = await setup();
    await t.open();
    await t.typeName('   ');
    await t.openList();
    await vi.waitFor(() => expect(t.router.url).toBe(`/s/${t.shareId}`));
    expect((await t.guestDb().getMeta('session'))?.username).toBe('');
  });

  it('41 characters can not be typed', async () => {
    const t = await setup();
    await t.open();
    expect(t.el().querySelector('input')?.maxLength).toBe(40);
  });

  it('a name the server finds too long is shown on the field, and nothing else happens', async () => {
    const t = await setup({ join: () => error('name_too_long', 400) });
    await t.open();
    await t.typeName('Jonas');
    await t.openList();
    await vi.waitFor(() => expect(t.el().querySelector('mat-error')?.textContent).toContain('Högst 40 tecken'));
    expect(t.router.url).toBe(`/share#${t.token}`);
    expect(await Dexie.exists(`promus-guest-${t.shareId}`)).toBe(false);
  });

  it('offline, it says so, and Open list then works', async () => {
    let online = false;
    const t = await setup({
      join: () => {
        if (!online) throw new TypeError('Failed to fetch');
        return undefined;
      },
    });
    await t.open();
    await t.openList();
    await vi.waitFor(() => expect(t.el().querySelector('[role="alert"]')?.textContent).toContain(sv.login.offline));
    online = true;
    await t.openList();
    await vi.waitFor(() => expect(t.router.url).toBe(`/s/${t.shareId}`));
  });

  it('joined but cut off before the list opened, the next tap opens it as the same guest', async () => {
    let online = false;
    const t = await setup({
      me: () => {
        if (!online) throw new TypeError('Failed to fetch');
        return undefined;
      },
    });
    await t.open();
    await t.openList();
    await vi.waitFor(() => expect(t.el().querySelector('[role="alert"]')?.textContent).toContain(sv.login.offline));
    online = true;
    await t.openList();
    await vi.waitFor(() => expect(t.router.url).toBe(`/s/${t.shareId}`));
    expect(t.urls().filter((url) => url === '/api/guest/join')).toHaveLength(1);
  });

  it('joined, but the link ended before the list opened: the ended page names who shared it', async () => {
    const t = await setup({ me: () => error('share_ended', 401) });
    await t.open();
    await t.openList();
    await vi.waitFor(() => expect(t.router.url).toBe('/share/ended'));
    await t.harness.fixture.whenStable();
    expect(t.el().textContent).toContain('Be anna om en ny.');
  });

  it("joined, but this browser didn't keep the link's cookie: it says so, and a retry joins no second time", async () => {
    const t = await setup({ me: () => error('unauthenticated', 401) });
    await t.open();
    await t.openList();
    await vi.waitFor(() => expect(t.el().querySelector('[role="alert"]')?.textContent).toContain(sv.guest.cookie));
    await t.openList();
    await t.harness.fixture.whenStable();
    expect(t.urls().filter((url) => url === `/api/guest/${t.shareId}/me`)).toHaveLength(2);
    expect(t.urls().filter((url) => url === '/api/guest/join')).toHaveLength(1);
    expect(t.el().querySelector('[role="alert"]')?.textContent).toContain(sv.guest.cookie);
  });

  it.each([
    ['offline', offline],
    ['the server down', () => error('internal', 502)],
  ])('%s, a link this phone already joined opens from its own data', async (_, check) => {
    const t = await setup({ check });
    await t.joinedHere();
    await t.harness.navigateByUrl(`/share#${t.token}`);
    await vi.waitFor(() => expect(t.router.url).toBe(`/s/${t.shareId}`));
    expect(t.urls()).not.toContain('/api/guest/join');
  });

  it("offline, a link this phone hasn't joined says so, and looking makes no database", async () => {
    const t = await setup({ check: offline });
    // another link this phone joined
    const shareId = newId();
    const other = new PromusDb(`promus-guest-${shareId}`);
    await other.setMeta('guest', {
      shareId,
      token: `token-${shareId}`,
      listId: newId(),
      householdId: newId(),
      sharedBy: 'bo',
      expiresAt: Date.now() + SHARE_TTL_MS,
    });
    other.close();
    const before = (await Dexie.getDatabaseNames()).sort();
    await t.harness.navigateByUrl(`/share#${t.token}`);
    await vi.waitFor(() => expect(t.el().querySelector('[role="alert"]')?.textContent).toContain(sv.login.offline));
    expect(t.router.url).toBe(`/share#${t.token}`);
    expect((await Dexie.getDatabaseNames()).sort()).toEqual(before);
  });

  it('a phone that already joined skips the name step, and joins no second time', async () => {
    const t = await setup({
      check: (shareId) => Response.json({ ...checked(shareId), joined: true }),
    });
    await t.joinedHere();
    await t.harness.navigateByUrl(`/share#${t.token}`);
    await vi.waitFor(() => expect(t.router.url).toBe(`/s/${t.shareId}`));
    expect(t.urls()).not.toContain('/api/guest/join');
    expect((await t.guestDb().getMeta('session'))?.username).toBe('Jonas');
  });

  it('a phone that joined but lost its data gets it back from the link', async () => {
    const t = await setup({
      check: (shareId) => Response.json({ ...checked(shareId), joined: true }),
    });
    await t.harness.navigateByUrl(`/share#${t.token}`);
    await vi.waitFor(() => expect(t.router.url).toBe(`/s/${t.shareId}`));
    expect(t.urls()).not.toContain('/api/guest/join');
    const db = t.guestDb();
    expect((await db.getMeta('guest'))?.token).toBe(t.token);
    expect(await db.getMeta('session')).toEqual({ userId: t.guestId, username: '', householdId: t.householdId });
    expect(await db.getMeta('currentListId')).toBe(t.listId);
  });

  it('a member of the household lands on the list as themselves', async () => {
    const t = await setup(
      {
        shares: (shareId) =>
          Response.json({
            shares: [{ id: shareId, listId: t.listId, token: t.token, expiresAt: 1, createdBy: anna.userId }],
            guests: [],
          }),
      },
      anna,
    );
    await t.harness.navigateByUrl(`/share#${t.token}`);
    await vi.waitFor(() => expect(t.router.url).toBe('/'));
    expect(await t.household.getMeta('currentListId')).toBe(t.listId);
    expect(t.urls()).not.toContain('/api/guest/join');
    expect(await Dexie.exists(`promus-guest-${t.shareId}`)).toBe(false);
  });

  it.each([
    ["another household's", () => Response.json({ shares: [], guests: [] })],
    ['signed out', () => error('unauthenticated', 401)],
  ])('someone %s gets the name step', async (_case, shares) => {
    const t = await setup({ shares }, anna);
    await t.open();
    await vi.waitFor(() => expect(t.el().querySelector('h1')?.textContent).toContain('anna delade Tacokväll'));
    expect(t.urls()).toContain('/api/shares');
  });

  it("a browser with no household asks none of the household's endpoints", async () => {
    const t = await setup();
    await t.open();
    await t.openList();
    await vi.waitFor(() => expect(t.router.url).toBe(`/s/${t.shareId}`));
    expect(t.urls().filter((url) => /^\/api\/(me|shares|sync|invites)\b/.test(url))).toEqual([]);
  });

  it('a link that has ended shows the ended page, naming no one', async () => {
    const t = await setup({ check: () => error('share_invalid', 404) });
    await t.harness.navigateByUrl(`/share#${t.token}`);
    await vi.waitFor(() => expect(t.router.url).toBe('/share/ended'));
    await t.harness.fixture.whenStable();
    expect(t.el().querySelector('h1')?.textContent).toContain(sv.guest.ended);
    expect(t.el().textContent).toContain(sv.guest.ask);
  });

  it('a link this phone joined, opened again after it ended, takes its data with it, so offline it opens nothing', async () => {
    let check = () => error('share_invalid', 404);
    const t = await setup({ check: () => check() });
    await t.joinedHere();
    await t.harness.navigateByUrl(`/share#${t.token}`);
    await vi.waitFor(() => expect(t.router.url).toBe('/share/ended'));
    expect(await Dexie.exists(`promus-guest-${t.shareId}`)).toBe(false);
    check = offline;
    await t.harness.navigateByUrl(`/share#${t.token}`);
    await vi.waitFor(() => expect(t.el().querySelector('[role="alert"]')?.textContent).toContain(sv.login.offline));
    expect(t.router.url).toBe(`/share#${t.token}`);
  });

  it('without a token, the link has ended', async () => {
    const t = await setup();
    await t.harness.navigateByUrl('/share');
    await vi.waitFor(() => expect(t.router.url).toBe('/share/ended'));
    expect(t.urls()).toEqual([]);
  });

  it('a full link says so, and who to ask for a new one', async () => {
    const t = await setup({ join: () => error('share_full', 409) });
    await t.open();
    await t.openList();
    await vi.waitFor(() => expect(t.router.url).toBe('/share/ended'));
    await t.harness.fixture.whenStable();
    expect(t.el().querySelector('h1')?.textContent).toContain(sv.guest.full);
    expect(t.el().textContent).toContain('Be anna om en ny.');
  });

  it('the language switch translates the page, and this device keeps it', async () => {
    const t = await setup();
    await t.open();
    await (await t.loader.getHarness(MatButtonHarness.with({ text: 'English' }))).click();
    await vi.waitFor(() => expect(t.el().querySelector('h1')?.textContent).toContain('anna shared Tacokväll'));
    expect(await t.household.getMeta('lang')).toBe('en');
  });
});

describe('EndedPage', () => {
  it('names who shared the link, to ask for a new one', async () => {
    const t = await setup();
    await t.router.navigateByUrl('/share/ended', { state: { sharedBy: 'anna' } });
    await t.harness.fixture.whenStable();
    expect(t.el().querySelector('h1')?.textContent).toContain(sv.guest.ended);
    expect(t.el().textContent).toContain('Be anna om en ny.');
    expect(t.el().textContent).not.toContain(sv.guest.ask);
  });

  it('without a name, it asks whoever shared it', async () => {
    const t = await setup();
    await t.router.navigateByUrl('/share/ended');
    await t.harness.fixture.whenStable();
    expect(t.el().querySelector('h1')?.textContent).toContain(sv.guest.ended);
    expect(t.el().textContent).toContain(sv.guest.ask);
  });
});
