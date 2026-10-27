import { ApplicationRef, DestroyRef, EnvironmentInjector, Injector, type Provider, inject } from '@angular/core';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { type CanActivateFn, RedirectCommand, Router, type Routes } from '@angular/router';
import { ApiError, type AuthError } from '@promus/shared';
import Dexie from 'dexie';
import { firstValueFrom } from 'rxjs';
import { Actions } from './actions';
import { ApiClient } from './api';
import { CurrentList } from './current-list';
import { GUEST, PromusDb } from './db';
import { DexieSyncStorage } from './dexie-storage';
import { Household } from './household';
import { SessionService } from './session';
import { Shares } from './shares';
import { Store } from './store';
import { SYNC_API, SYNC_AUTH_FAILED, SyncService } from './sync.service';

// the person goes in the navigation's state, never the URL: the server logs paths
const ENDED = '/share/ended';

/**
 * Whether the link says it's over (`share_invalid`); a live link, or any other 4xx, is for the name step. Offline or
 * on a server error it throws, and the next sync asks again.
 */
const linkEnded = (api: ApiClient, token: string): Promise<boolean> =>
  api.checkShare(token).then(
    () => false,
    (err: unknown) => {
      if (!(err instanceof ApiError) || err.status >= 500) throw err;
      return err.code === 'share_invalid';
    },
  );

/**
 * The link's own database. Closed for good when its page is left or another tab deletes it, so a late read can't make
 * it again.
 */
function guestDb(): PromusDb {
  const db = new PromusDb(`promus-guest-${inject(GUEST)?.shareId}`);
  // false: Dexie's own handler would close it to reopen on the next read.
  // ponytail: when another tab deletes it, this tab stays on the list: its sync fails every 15 s and every action says
  // "Couldn't save the change" until a reload. Upgrade path: go to the ended page on versionchange
  db.on('versionchange', () => {
    db.close();
    return false;
  });
  inject(DestroyRef).onDestroy(() => db.close());
  return db;
}

/**
 * A 401 on a guest's sync. `share_ended` deletes the link's data and shows the ended page; so does an expired
 * link, whose cookie went with it, once the link says it's over. A live link without its cookie asks for the name
 * again. The household's data is never touched.
 */
function authFailed(): (err: AuthError) => Promise<void> {
  const db = inject(PromusDb);
  const api = inject(ApiClient);
  const router = inject(Router);
  const sheet = inject(MatBottomSheet);
  const dialog = inject(MatDialog);
  const snackBar = inject(MatSnackBar);
  const app = inject(ApplicationRef);
  // SyncService injects this, so it's looked up when called
  const injector = inject(Injector);
  return async (err) => {
    const guest = await db.getMeta('guest');
    const live = guest !== undefined && err.code !== 'share_ended' && !(await linkEnded(api, guest.token));
    injector.get(SyncService).stop();
    // nothing of the list stays on screen over the page that follows. An item's options save what was typed in them
    // as they close, into this page's database: the page, and its database, wait for that save to end
    const sheetRef = sheet._openedBottomSheetRef;
    const closed = Promise.all([
      sheetRef && firstValueFrom(sheetRef.afterDismissed()),
      firstValueFrom(dialog.afterAllClosed),
    ]);
    sheet.dismiss();
    dialog.closeAll();
    snackBar.dismiss();
    await closed;
    // a save holds the app unstable until it has written every field: Actions.run makes it a pending task
    await app.whenStable();
    if (guest && live) {
      await router.navigate(['/share'], { fragment: guest.token, replaceUrl: true });
      return;
    }
    // what never reached the server goes too: the link that would take it is over. Without its meta nothing says so
    if (guest) await db.delete();
    await router.navigate([ENDED], { state: { sharedBy: guest?.sharedBy ?? null }, replaceUrl: true });
  };
}

/**
 * The route `s/:shareId`: the link's own database, `promus-guest-<shareId>`, and fresh instances of every service
 * that holds events, the session, members or links. The device's language, theme and Done fold stay the root's.
 */
function guestProviders(): Provider[] {
  return [
    { provide: GUEST, useFactory: () => ({ shareId: '' }) },
    { provide: PromusDb, useFactory: guestDb },
    { provide: DexieSyncStorage, useFactory: () => new DexieSyncStorage(inject(PromusDb)) },
    { provide: SYNC_API, useFactory: () => inject(ApiClient).guestSync(inject(GUEST)?.shareId ?? '') },
    { provide: SYNC_AUTH_FAILED, useFactory: authFailed },
    SessionService,
    Store,
    SyncService,
    Actions,
    CurrentList,
    Shares,
    Household,
  ];
}

/** Opens the link from its database alone, so offline too; a link this browser has no data for has ended. */
const guestGuard: CanActivateFn = async (route) => {
  // the route's injector: injecting after an await isn't allowed, and SyncService would open the database early
  const injector = inject(EnvironmentInjector);
  const link = injector.get(GUEST);
  // ponytail: the router keeps one injector while the route stays active, so going from one link's page straight to
  // another's (nothing in the app does) would keep the first link's. Upgrade path: a full page load on a change
  if (link && !link.shareId) link.shareId = route.paramMap.get('shareId') ?? '';
  const db = injector.get(PromusDb);
  // checked first: reading meta would make the database
  if (!(await Dexie.exists(db.name)) || !(await db.getMeta('guest'))) {
    return new RedirectCommand(injector.get(Router).parseUrl(ENDED), { state: { sharedBy: null }, replaceUrl: true });
  }
  await injector.get(SessionService).load();
  injector.get(SyncService).start();
  return true;
};

/** Under `s/:shareId`: the list, and on a phone its Add or find, both in the link's own data. */
export const GUEST_ROUTES: Routes = [
  {
    path: '',
    providers: guestProviders(),
    canActivate: [guestGuard],
    children: [
      { path: '', loadComponent: () => import('../features/list/list.page').then((m) => m.ListPage) },
      { path: 'add', loadComponent: () => import('../features/add/add.page').then((m) => m.AddPage) },
    ],
  },
];
