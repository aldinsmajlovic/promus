import { Location } from '@angular/common';
import { inject } from '@angular/core';
import { Router } from '@angular/router';

/**
 * Leaves a page the way it was opened, so Back from where it lands doesn't reopen it; opened directly,
 * it goes home in its place. Call it in an injection context, such as a field initializer.
 */
export function injectBack(): () => void {
  const router = inject(Router);
  const location = inject(Location);
  return () => {
    if (router.lastSuccessfulNavigation()?.previousNavigation) location.back();
    else void router.navigateByUrl('/', { replaceUrl: true });
  };
}
