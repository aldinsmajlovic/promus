import { Location } from '@angular/common';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { GUEST } from './db';

/**
 * Leaves a page the way it was opened, so Back from where it lands doesn't reopen it; opened directly,
 * it goes home in its place, a guest's being their link's list. Call it in an injection context, such as a
 * field initializer.
 */
export function injectBack(): () => void {
  const router = inject(Router);
  const location = inject(Location);
  const link = inject(GUEST);
  const home = link ? `/s/${link.shareId}` : '/';
  return () => {
    if (router.lastSuccessfulNavigation()?.previousNavigation) location.back();
    else void router.navigateByUrl(home, { replaceUrl: true });
  };
}
