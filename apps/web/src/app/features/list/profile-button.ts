import { Component, Injector, computed, inject } from '@angular/core';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { GUEST } from '../../core/db';
import { SessionService } from '../../core/session';
import { syncBadge } from '../../core/sync-badge';
import { SyncService } from '../../core/sync.service';
import { Face } from '../../shared/face';
import { GuestSheet } from '../share/guest-sheet';

/**
 * Your initial, a link to Settings, or for a guest their own sheet; a badge on it only when the sync needs
 * attention.
 */
@Component({
  selector: 'app-profile-button',
  imports: [RouterLink, TranslocoDirective, Face],
  template: `
    <ng-container *transloco="let t">
      @if (you(); as you) {
        @let b = badge();
        @let status = b ? ', ' + t(b.key, b.params) : '';
        <!-- a guest without a name is Guest, G -->
        @let name = you.username || t('guest.name');
        @if (guest) {
          <button type="button" [attr.aria-label]="t('guest.profile', { name }) + status" (click)="open()">
            <app-face [member]="{ id: you.userId, username: name }" [badge]="b?.mark ?? null" />
          </button>
        } @else {
          <a routerLink="/settings" [attr.aria-label]="t('list.profile', { name }) + status">
            <app-face [member]="{ id: you.userId, username: name }" [badge]="b?.mark ?? null" />
          </a>
        }
      }
    </ng-container>
  `,
  styles: `
    a,
    button {
      display: inline-flex;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: none;
      text-decoration: none;
      cursor: pointer;
    }
  `,
})
export class ProfileButton {
  private readonly sync = inject(SyncService);
  private readonly sheet = inject(MatBottomSheet);
  private readonly transloco = inject(TranslocoService);
  // the guest's page's own, so the sheet changes the guest's data
  private readonly injector = inject(Injector);
  protected readonly guest = inject(GUEST) !== null;
  protected readonly you = inject(SessionService).session;
  protected readonly badge = computed(() => syncBadge(this.sync.status()));

  protected open(): void {
    this.sheet.open(GuestSheet, { injector: this.injector, ariaLabel: this.transloco.translate('guest.sheetTitle') });
  }
}
