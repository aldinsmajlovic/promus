import { Clipboard } from '@angular/cdk/clipboard';
import { Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheet, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatSnackBar, type MatSnackBarConfig } from '@angular/material/snack-bar';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { TOKEN_NAME_MAX } from '@promus/shared';
import { Actions } from '../../core/actions';
import { ApiClient } from '../../core/api';
import { ORIGIN } from '../../core/platform';

export type TokenSheetData = { changed: () => void };

// at the top: the sheet takes the bottom of the screen
const SNACK: MatSnackBarConfig = { duration: 5000, verticalPosition: 'top' };

/**
 * Opens the sheet that makes an API token; `changed` runs whenever the list of tokens changes. Call it in an
 * injection context, such as a field initializer.
 */
export function injectConnect(): (changed: () => void) => Promise<void> {
  const sheet = inject(MatBottomSheet);
  return async (changed) => {
    sheet.open(TokenSheet, { data: { changed } satisfies TokenSheetData });
  };
}

/** A name for the app, then its token, shown once. Undo in the snackbar takes the token back. */
@Component({
  selector: 'app-token-sheet',
  imports: [ReactiveFormsModule, MatButton, MatError, MatFormField, MatIcon, MatInput, MatLabel, TranslocoDirective],
  template: `
    <ng-container *transloco="let t">
      @if (token(); as made) {
        <h2>{{ t('token.madeTitle', { name: made.name }) }}</h2>
        <p>{{ t('token.madeIntro', { name: made.name }) }}</p>
        <p class="box">{{ made.token }}</p>
        <p class="box origin">{{ origin }}</p>
        <div class="actions">
          <button matButton="outlined" type="button" (click)="copy(made.token)">
            <mat-icon svgIcon="content_copy" />{{ t('token.copy') }}
          </button>
        </div>
      } @else {
        <h2>{{ t('token.title') }}</h2>
        <p>{{ t('token.intro') }}</p>
        <form (submit)="$event.preventDefault(); make()">
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>{{ t('token.name') }}</mat-label>
            <input matInput [formControl]="name" [attr.maxlength]="max" autocomplete="off" />
            @if (name.hasError('empty')) {
              <mat-error>{{ t('errors.nameEmpty') }}</mat-error>
            }
          </mat-form-field>
          <div class="actions">
            <button matButton="filled" type="submit" [disabled]="busy()">{{ t('token.make') }}</button>
          </div>
        </form>
      }
    </ng-container>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
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
    form {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .box {
      padding: 0.75rem;
      border-radius: var(--promus-row-corner);
      background: var(--promus-field);
      font-family: ui-monospace, monospace;
      overflow-wrap: anywhere;
    }
    .origin {
      color: var(--mat-sys-on-surface-variant);
    }
    .actions {
      display: flex;
      gap: 0.5rem;
    }
  `,
})
export class TokenSheet {
  private readonly data = inject<TokenSheetData>(MAT_BOTTOM_SHEET_DATA);
  private readonly ref = inject<MatBottomSheetRef<TokenSheet>>(MatBottomSheetRef);
  private readonly api = inject(ApiClient);
  private readonly actions = inject(Actions);
  private readonly clipboard = inject(Clipboard);
  private readonly snackBar = inject(MatSnackBar);
  private readonly transloco = inject(TranslocoService);
  protected readonly origin = inject(ORIGIN);
  protected readonly max = TOKEN_NAME_MAX;
  protected readonly name = new FormControl('', { nonNullable: true });
  protected readonly busy = signal(false);
  protected readonly token = signal<{ name: string; token: string } | null>(null);

  protected async make(): Promise<void> {
    const name = this.name.value.trim();
    if (!name) {
      this.name.setErrors({ empty: true });
      this.name.markAsTouched();
      return;
    }
    this.busy.set(true);
    let made: { id: string; token: string };
    try {
      made = await this.api.createToken(name);
    } catch (err) {
      this.actions.failed(err, SNACK);
      return;
    } finally {
      this.busy.set(false);
    }
    this.token.set({ name, token: made.token });
    this.data.changed();
    this.snackBar
      .open(this.transloco.translate('snack.tokenMade'), this.transloco.translate('snack.undo'), SNACK)
      .onAction()
      .subscribe(() => {
        this.ref.dismiss();
        this.api.revokeToken(made.id).then(
          () => {
            this.data.changed();
            this.snackBar.open(this.transloco.translate('snack.tokenRevoked'), undefined, SNACK);
          },
          (err: unknown) => this.actions.failed(err, SNACK),
        );
      });
  }

  protected copy(token: string): void {
    if (!this.clipboard.copy(token)) {
      this.actions.failed(new Error('copying to the clipboard failed'), SNACK);
      return;
    }
    this.snackBar.open(this.transloco.translate('snack.tokenCopied'), undefined, { duration: 3000, verticalPosition: 'top' });
  }
}
