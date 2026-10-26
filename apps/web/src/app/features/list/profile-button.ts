import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { SessionService } from '../../core/session';
import { syncBadge } from '../../core/sync-badge';
import { SyncService } from '../../core/sync.service';
import { Face } from '../../shared/face';

/** Your initial, a link to Settings; a badge on it only when the sync needs attention. */
@Component({
  selector: 'app-profile-button',
  imports: [RouterLink, TranslocoDirective, Face],
  template: `
    <ng-container *transloco="let t">
      @if (you(); as you) {
        @let b = badge();
        <a
          routerLink="/settings"
          [attr.aria-label]="t('list.profile', { name: you.username }) + (b ? ', ' + t(b.key, b.params) : '')"
        >
          <app-face [member]="{ id: you.userId, username: you.username }" [badge]="b?.mark ?? null" />
        </a>
      }
    </ng-container>
  `,
  styles: `
    a {
      display: inline-flex;
      border-radius: 50%;
      text-decoration: none;
    }
  `,
})
export class ProfileButton {
  private readonly sync = inject(SyncService);
  protected readonly you = inject(SessionService).session;
  protected readonly badge = computed(() => syncBadge(this.sync.status()));
}
