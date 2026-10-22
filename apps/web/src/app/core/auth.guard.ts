import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { NetworkError } from '@promus/shared';
import { ApiClient } from './api';
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

/** null when the server can't say: offline, the app goes on as if it has accounts. */
async function setupNeeded(api: ApiClient): Promise<boolean | null> {
  try {
    return await api.setupNeeded();
  } catch (err) {
    if (!(err instanceof NetworkError)) console.error('setup check failed', err);
    return null;
  }
}

/** A server without accounts: its first one comes from the setup wizard, not the login form. */
export const setupNeededGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const api = inject(ApiClient);
  // a device that has signed in knows the server has accounts, and asks nothing offline
  if (await inject(SessionService).load()) return true;
  return (await setupNeeded(api)) === true ? router.parseUrl('/setup') : true;
};

/** The wizard only while the server has no accounts; offline, its form says so on submit. */
export const setupGuard: CanActivateFn = async () => {
  const router = inject(Router);
  return (await setupNeeded(inject(ApiClient))) === false ? router.parseUrl('/login') : true;
};
