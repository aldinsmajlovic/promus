import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session';
import { SyncService } from './sync.service';

// each one reads meta afresh: the session signal doesn't follow other tabs

/** The session cached in meta is enough, so the app opens offline. */
export const authGuard: CanActivateFn = async () => {
  const router = inject(Router);
  return (await inject(SessionService).load()) ? true : router.parseUrl('/login');
};

/** Signed in already: home, unless the sync status asks to sign in again (an expired session). */
export const loginGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const sync = inject(SyncService);
  const session = await inject(SessionService).load();
  return session && sync.status().kind !== 'auth' ? router.parseUrl('/') : true;
};
