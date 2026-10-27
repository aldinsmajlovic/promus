import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatInputHarness } from '@angular/material/input/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { formatHlc, makeEvent, newId } from '@promus/shared';
import { describe, expect, it, vi } from 'vitest';
import sv from '../../../i18n/sv.json';
import { FETCH } from '../../core/api';
import { PromusDb, type Session } from '../../core/db';
import { DexieSyncStorage } from '../../core/dexie-storage';
import { ORIGIN, SECURE_CONTEXT } from '../../core/platform';
import { SyncService } from '../../core/sync.service';
import { JoinPage } from './join.page';

@Component({ template: '' })
class Blank {}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const anna: Session = { userId: 'u1', username: 'anna', householdId: newId() };
const bo = { id: 'u2', username: 'bo' };

type Answers = { check?: () => Response; accept?: (body: { username: string }) => Response; login?: () => Response };

async function setup(answers: Answers = {}, cached?: Session) {
  const db = new PromusDb(`join-${newId()}`);
  if (cached) await db.setMeta('session', cached);
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    if (url === '/api/invites/check') return (answers.check ?? (() => json(200, { expiresAt: Date.now() + 1000, invitedBy: 'anna', ownHousehold: false })))();
    if (url === '/api/invites/accept') return (answers.accept ?? (() => json(201, {})))(JSON.parse(init!.body as string));
    if (url === '/api/auth/login') return (answers.login ?? (() => json(200, { user: bo, householdId: anna.householdId })))();
    if (url === '/api/me') return json(200, { user: bo, households: [] });
    throw new Error(`unexpected ${String(url)}`);
  });
  TestBed.configureTestingModule({
    providers: [
      { provide: PromusDb, useValue: db },
      { provide: FETCH, useValue: fetch },
      { provide: ORIGIN, useValue: 'https://promus.example' },
      { provide: SECURE_CONTEXT, useValue: true },
      { provide: SyncService, useValue: { syncNow: vi.fn(async () => undefined) } },
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      provideRouter([
        { path: '', component: Blank },
        { path: 'join', component: JoinPage },
      ]),
      importProvidersFrom(
        TranslocoTestingModule.forRoot({
          langs: { sv },
          translocoConfig: { availableLangs: ['sv'], defaultLang: 'sv' },
          preloadLangs: true,
        }),
      ),
    ],
  });
  const harness = await RouterTestingHarness.create('/join#the-token');
  const loader = TestbedHarnessEnvironment.documentRootLoader(harness.fixture);
  const el: HTMLElement = harness.fixture.nativeElement;
  const join = async (username: string, submit = sv.join.submit) => {
    const field = (selector: string) => loader.getHarness(MatInputHarness.with({ selector }));
    await (await field('[autocomplete="username"]')).setValue(username);
    await (await field('[autocomplete="new-password"]')).setValue('correct horse');
    await (await loader.getHarness(MatButtonHarness.with({ text: submit }))).click();
  };
  const accepts = () => fetch.mock.calls.filter(([url]) => url === '/api/invites/accept');
  return { db, fetch, el, join, accepts };
}

describe('JoinPage', () => {
  it('names who sent the invite', async () => {
    const t = await setup();
    await vi.waitFor(() => expect(t.el.querySelector('h1')?.textContent).toContain('anna bjöd in dig'));
  });

  it('checks the token from the link, joins, signs in and shows the phone step', async () => {
    const t = await setup();
    await vi.waitFor(() => expect(t.el.textContent).toContain(sv.join.intro));
    const [, check] = t.fetch.mock.calls[0]!;
    expect(JSON.parse(check!.body as string)).toEqual({ token: 'the-token' });
    await t.join('bo');
    await vi.waitFor(() => expect(t.el.textContent).toContain(sv.phone.scan));
    expect(JSON.parse(t.accepts()[0]![1]!.body as string)).toEqual({ token: 'the-token', username: 'bo', password: 'correct horse', locale: 'sv' });
    expect(await t.db.getMeta('session')).toMatchObject({ userId: 'u2', householdId: anna.householdId });
  });

  it('an invite to lists of your own says so, and creates the account', async () => {
    const t = await setup({ check: () => json(200, { expiresAt: Date.now() + 1000, invitedBy: 'anna', ownHousehold: true }) });
    await vi.waitFor(() => expect(t.el.textContent).toContain(sv.join.ownTagline));
    expect(t.el.textContent).not.toContain(sv.join.tagline);
    await t.join('bo', sv.join.ownSubmit);
    await vi.waitFor(() => expect(t.el.textContent).toContain(sv.phone.scan));
    expect(t.el.querySelector('h1')?.textContent).toContain(sv.join.ownTitle);
    expect(t.accepts()).toHaveLength(1);
  });

  it('an expired or used link says so', async () => {
    const t = await setup({ check: () => json(404, { error: 'invite_invalid' }) });
    await vi.waitFor(() => expect(t.el.textContent).toContain(sv.join.invalid));
    expect(t.el.querySelector('form')).toBeNull();
  });

  it("another user's unsynced changes block joining before the invite is used", async () => {
    const t = await setup({}, anna);
    const event = makeEvent('list.created', { listId: newId(), name: 'Inköpslista' }, {
      householdId: anna.householdId, hlc: formatHlc(Date.now(), 0, 'test'), occurredAt: Date.now(),
    });
    await new DexieSyncStorage(t.db).append([event]);
    await vi.waitFor(() => expect(t.el.textContent).toContain(sv.join.intro));
    await t.join('bo');
    await vi.waitFor(() => expect(t.el.querySelector('[role="alert"]')?.textContent).toContain('Synka eller logga in som anna först'));
    expect(t.accepts()).toEqual([]);
  });

  it('a taken name is shown under its field, and another name then works', async () => {
    const t = await setup({ accept: ({ username }) => (username === 'anna' ? json(409, { error: 'username_taken' }) : json(201, {})) });
    await vi.waitFor(() => expect(t.el.textContent).toContain(sv.join.intro));
    await t.join('anna');
    await vi.waitFor(() => expect(t.el.querySelector('mat-error')?.textContent).toContain(sv.account.errors.username_taken));
    await t.join('bo');
    await vi.waitFor(() => expect(t.el.textContent).toContain(sv.phone.scan));
    expect(t.accepts()).toHaveLength(2);
  });

  it('a sign-in that fails after joining is retried as a sign-in, not as a second join', async () => {
    let signIns = 0;
    const t = await setup({
      login: () => {
        signIns++;
        if (signIns === 1) throw new TypeError('Failed to fetch');
        return json(200, { user: bo, householdId: anna.householdId });
      },
    });
    await vi.waitFor(() => expect(t.el.textContent).toContain(sv.join.intro));
    await t.join('bo');
    await vi.waitFor(() => expect(t.el.querySelector('[role="alert"]')?.textContent).toContain(sv.login.offline));
    await t.join('bo');
    await vi.waitFor(() => expect(t.el.textContent).toContain(sv.phone.scan));
    expect(t.accepts()).toHaveLength(1);
    expect(signIns).toBe(2);
  });
});
