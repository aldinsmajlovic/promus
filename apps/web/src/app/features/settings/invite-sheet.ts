import { Clipboard } from '@angular/cdk/clipboard';
import { Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MAT_BOTTOM_SHEET_DATA } from '@angular/material/bottom-sheet';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { Actions } from '../../core/actions';
import { ORIGIN, isLocalOrigin } from '../../core/platform';
import { QrCode } from '../../shared/qr-code';

export type InviteSheetData = { url: string };

/** An invite link to scan, share or copy. */
@Component({
  selector: 'app-invite-sheet',
  imports: [MatButton, MatIcon, TranslocoDirective, QrCode],
  template: `
    <ng-container *transloco="let t">
      <h2>{{ t('invite.title') }}</h2>
      <p>{{ t('invite.intro') }}</p>
      @if (local) {
        <p>{{ t('phone.local') }}</p>
      } @else {
        <app-qr-code [text]="data.url" />
      }
      <p class="url">{{ data.url }}</p>
      <div class="actions">
        @if (canShare) {
          <button matButton="filled" type="button" (click)="share()"><mat-icon svgIcon="share" />{{ t('invite.share') }}</button>
        }
        <button matButton="outlined" type="button" (click)="copy()"><mat-icon svgIcon="content_copy" />{{ t('invite.copy') }}</button>
      </div>
    </ng-container>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
      padding-block: 0.5rem 1rem;
      font: var(--mat-sys-body-medium);
    }
    h2 {
      margin: 0;
      font: var(--mat-sys-title-large);
    }
    p {
      margin: 0;
    }
    .url {
      overflow-wrap: anywhere;
      color: var(--mat-sys-on-surface-variant);
    }
    .actions {
      display: flex;
      gap: 0.5rem;
    }
  `,
})
export class InviteSheet {
  protected readonly data = inject<InviteSheetData>(MAT_BOTTOM_SHEET_DATA);
  private readonly clipboard = inject(Clipboard);
  private readonly snackBar = inject(MatSnackBar);
  private readonly transloco = inject(TranslocoService);
  private readonly actions = inject(Actions);
  protected readonly local = isLocalOrigin(inject(ORIGIN));
  protected readonly canShare = typeof navigator.share === 'function';

  protected share(): void {
    navigator.share({ url: this.data.url }).catch((err: unknown) => {
      // closing the share sheet without picking anything
      if (!(err instanceof DOMException && err.name === 'AbortError')) this.actions.failed(err);
    });
  }

  protected copy(): void {
    if (!this.clipboard.copy(this.data.url)) {
      this.actions.failed(new Error('copying to the clipboard failed'));
      return;
    }
    this.snackBar.open(this.transloco.translate('snack.copied'), undefined, { duration: 3000, verticalPosition: 'top' });
  }
}
