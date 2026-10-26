import { BreakpointObserver } from '@angular/cdk/layout';
import { InjectionToken, type Signal, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

/** A computer: the list and Add or find side by side. Narrower gets the phone layout. */
export const WIDE = new InjectionToken<Signal<boolean>>('WIDE', {
  providedIn: 'root',
  factory: () =>
    toSignal(inject(BreakpointObserver).observe('(min-width: 1024px)').pipe(map((s) => s.matches)), {
      initialValue: false,
    }),
});
