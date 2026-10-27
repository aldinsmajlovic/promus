import { Clipboard } from '@angular/cdk/clipboard';
import { Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar, type MatSnackBarConfig } from '@angular/material/snack-bar';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { Actions } from '../../core/actions';
import { ApiClient } from '../../core/api';
import { ORIGIN, isLocalOrigin } from '../../core/platform';
import { QrCode } from '../../shared/qr-code';

export type InviteSheetData = { url: string; ownHousehold: boolean };

// at the top: the invite sheet takes the bottom of the screen
const SNACK: MatSnackBarConfig = { duration: 5000, verticalPosition: 'top' };

/**
 * Creates an invite, to your household or to lists of their own, and shows its link; Undo revokes it. Call it
 * in an injection context, such as a field initializer.
 */
export function injectInvite(): (ownHousehold: boolean) => Promise<void> {
  const api = inject(ApiClient);
  const sheet = inject(MatBottomSheet);
  const snackBar = inject(MatSnackBar);
  const t = inject(TranslocoService);
  const actions = inject(Actions);
  const origin = inject(ORIGIN);
  return async (ownHousehold) => {
    let invite: { id: string; token: string };
    try {
      invite = await api.createInvite({ ownHousehold });
    } catch (err) {
      actions.failed(err, SNACK);
      return;
    }
    const data: InviteSheetData = { url: `${origin}/join#${invite.token}`, ownHousehold };
    const ref = sheet.open(InviteSheet, { data });
    snackBar
      .open(t.translate('snack.inviteCreated'), t.translate('snack.undo'), SNACK)
      .onAction()
      .subscribe(() => {
        ref.dismiss();
        api.revokeInvite(invite.id).then(
          () => snackBar.open(t.translate('snack.inviteRevoked'), undefined, SNACK),
          (err: unknown) => actions.failed(err, SNACK),
        );
      });
  };
}

/** An invite link to scan, share or copy. */
@Component({
  selector: 'app-invite-sheet',
  imports: [MatButton, MatIcon, TranslocoDirective, QrCode],
  template: `
    <ng-container *transloco="let t">
      <h2>{{ t(data.ownHousehold ? 'invite.ownTitle' : 'invite.title') }}</h2>
      <p>{{ t(data.ownHousehold ? 'invite.ownIntro' : 'invite.intro') }}</p>
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
