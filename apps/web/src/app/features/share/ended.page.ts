import { Component, inject } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { Router } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { SHARE_MAX_GUESTS, SHARE_TTL_MS } from '@promus/shared';
import { initialOf } from '../../shared/face';
import { LangSwitch } from '../../shared/lang-switch';

/**
 * A link that has ended, or one that's full: who to ask for a new one, and nothing of the list. Who shared it comes
 * in the navigation's state, never the URL; a reload loses it, and the page then names no one.
 */
@Component({
  selector: 'app-ended-page',
  imports: [MatIcon, TranslocoDirective, LangSwitch],
  template: `
    <ng-container *transloco="let t">
      <div class="frame">
        <header class="band hero">
          @if (sharedBy; as name) {
            <span class="face tone-1" aria-hidden="true">{{ initialOf(name) }}</span>
          }
          <h1 class="brand">{{ t(full ? 'guest.full' : 'guest.ended') }}</h1>
          <p class="lede">{{ sharedBy ? t('guest.askName', { name: sharedBy }) : t('guest.ask') }}</p>
        </header>

        <main class="sheet pad">
          <div class="why">
            <span class="icon"><mat-icon svgIcon="link_off" /></span>
            <p>{{ full ? t('guest.fullWhy', { max }) : t('guest.endedWhy', { days }) }}</p>
          </div>
          <app-lang-switch />
        </main>
      </div>
    </ng-container>
  `,
  styles: `
    .face {
      --face-size: 3rem;
      margin-block-end: 0.5rem;
    }
    .why {
      padding: 1.5rem 0.75rem 0;
      color: var(--promus-muted);
      text-align: center;
    }
    .icon {
      display: grid;
      place-items: center;
      width: 4rem;
      height: 4rem;
      margin: 0 auto 1rem;
      border-radius: 50%;
      background: var(--promus-tint);
      color: var(--promus-tint-ink);
    }
    mat-icon {
      width: 2rem;
      height: 2rem;
    }
  `,
})
export class EndedPage {
  private readonly state = inject(Router).currentNavigation()?.extras.state as
    | { sharedBy?: string | null; full?: boolean }
    | undefined;
  protected readonly sharedBy = this.state?.sharedBy ?? null;
  protected readonly full = this.state?.full === true;
  protected readonly max = SHARE_MAX_GUESTS;
  protected readonly days = SHARE_TTL_MS / 86_400_000;
  protected readonly initialOf = initialOf;
}
