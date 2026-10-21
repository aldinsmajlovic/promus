import { Component, type TemplateRef, computed, inject, viewChild } from '@angular/core';
import { MatBadge } from '@angular/material/badge';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatDialog, MatDialogActions, MatDialogClose, MatDialogTitle } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { Router } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { SyncService } from '../../core/sync.service';

/** Shown only when something needs attention: unsynced changes, a running sync, an error or no session. */
@Component({
  selector: 'app-sync-indicator',
  imports: [
    MatIconButton,
    MatButton,
    MatIcon,
    MatBadge,
    MatDialogTitle,
    MatDialogActions,
    MatDialogClose,
    TranslocoDirective,
  ],
  template: `
    <ng-container *transloco="let t">
      @if (look(); as look) {
        @let pending = sync.status().pending;
        <button
          matIconButton
          [class.error]="look.icon === 'error'"
          [matBadge]="pending"
          [matBadgeHidden]="!pending"
          [attr.aria-label]="pending ? t(look.label) + ', ' + t(pendingKey(pending), { n: pending }) : t(look.label)"
          (click)="tap()"
        >
          <mat-icon [svgIcon]="look.icon" />
        </button>
      }
      <ng-template #failed>
        <!-- the reason is the title, so it names the dialog for screen readers -->
        <h2 mat-dialog-title>{{ t(sync.status().messageKey ?? 'sync.failed') }}</h2>
        <mat-dialog-actions>
          <button matButton mat-dialog-close>{{ t('dialog.close') }}</button>
          <button matButton mat-dialog-close (click)="sync.syncNow()">{{ t('sync.retry') }}</button>
        </mat-dialog-actions>
      </ng-template>
    </ng-container>
  `,
  styles: `
    :host {
      /* the badge on the button's top right, over the icon's corner, as in the mockups */
      --mat-badge-container-overlap-offset: -1.125rem -1rem;
    }
    .error {
      --mat-icon-button-icon-color: var(--mat-sys-error);
    }
  `,
})
export class SyncIndicator {
  protected readonly sync = inject(SyncService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly failed = viewChild.required<TemplateRef<unknown>>('failed');

  protected readonly look = computed(() => {
    const { kind, pending } = this.sync.status();
    if (kind === 'error') return { icon: 'error', label: 'sync.error' };
    if (kind === 'auth') return { icon: 'login', label: 'sync.auth' };
    if (kind === 'syncing') return { icon: 'sync', label: 'sync.syncing' };
    if (pending === 0) return null;
    return kind === 'offline' ? { icon: 'cloud_off', label: 'sync.offline' } : { icon: 'sync', label: 'sync.waiting' };
  });

  // sv and en need only one and other
  protected pendingKey(n: number): string {
    return n === 1 ? 'sync.pending.one' : 'sync.pending.other';
  }

  protected tap(): void {
    const { kind } = this.sync.status();
    if (kind === 'auth') void this.router.navigateByUrl('/login');
    else if (kind === 'error') this.dialog.open(this.failed());
    else void this.sync.syncNow();
  }
}
