import { Clipboard } from '@angular/cdk/clipboard';
import { Component, inject } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import type { Share } from '@promus/shared';
import { Actions } from '../../core/actions';
import { ApiClient } from '../../core/api';
import { ORIGIN } from '../../core/platform';
import { Shares } from '../../core/shares';
import { QrCode } from '../../shared/qr-code';

export type ShareSheetData = { listName: string; share: Share };

/** The day a link works until, as "Mon 9 Nov". */
export const untilDay = (at: number, lang: string): string =>
  new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short' }).format(at);

/** A list's link to scan, share or copy, until when it works, and End link. */
@Component({
  selector: 'app-share-sheet',
  imports: [MatButton, MatIcon, TranslocoDirective, QrCode],
  template: `
    <ng-container *transloco="let t">
      <div class="handle"></div>
      <h2 class="brand">{{ t('share.title', { list: data.listName }) }}</h2>
      <p class="intro">{{ t('share.intro') }}</p>
      <app-qr-code [text]="url" />
      <p class="url">{{ url }}</p>
      <div class="actions">
        @if (canShare) {
          <button matButton="filled" type="button" (click)="share()"><mat-icon svgIcon="share" />{{ t('share.share') }}</button>
        }
        <button matButton="tonal" type="button" (click)="copy()"><mat-icon svgIcon="content_copy" />{{ t('share.copy') }}</button>
      </div>
      <div class="until">
        <span>{{ t('share.until') }} <b>{{ until }}</b></span>
        <button matButton type="button" (click)="end()">{{ t('share.end') }}</button>
      </div>
    </ng-container>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      padding-block-end: 0.5rem;
      font: var(--mat-sys-body-medium);
    }
    // no font shorthand or family: the global .brand sets the face
    h2 {
      margin: 0 0 0.375rem;
      color: var(--promus-text);
      font-size: 1.5rem;
      font-weight: 600;
    }
    p {
      margin: 0;
    }
    .intro {
      margin-block-end: 1rem;
    }
    app-qr-code {
      width: 10.5rem;
      align-self: center;
    }
    .url {
      margin-block: 0.5rem 1rem;
      overflow: hidden;
      color: var(--mat-sys-on-surface-variant);
      text-align: center;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .actions {
      display: flex;
      gap: 0.625rem;
    }
    .actions button {
      flex: 1;
    }
    .until {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-block-start: 1rem;
      padding-block-start: 0.5rem;
      border-block-start: 1px solid var(--mat-sys-outline-variant);
      color: var(--mat-sys-on-surface-variant);
    }
    b {
      color: var(--promus-text);
      font-weight: 600;
    }
  `,
})
export class ShareSheet {
  protected readonly data = inject<ShareSheetData>(MAT_BOTTOM_SHEET_DATA);
  private readonly ref = inject(MatBottomSheetRef);
  private readonly api = inject(ApiClient);
  private readonly shares = inject(Shares);
  private readonly clipboard = inject(Clipboard);
  private readonly snackBar = inject(MatSnackBar);
  private readonly transloco = inject(TranslocoService);
  private readonly actions = inject(Actions);
  protected readonly url = `${inject(ORIGIN)}/share#${this.data.share.token}`;
  protected readonly until = untilDay(this.data.share.expiresAt, this.transloco.getActiveLang());
  protected readonly canShare = typeof navigator.share === 'function';

  protected share(): void {
    navigator.share({ url: this.url }).catch((err: unknown) => {
      // closing the share sheet without picking anything
      if (!(err instanceof DOMException && err.name === 'AbortError')) this.actions.failed(err);
    });
  }

  protected copy(): void {
    if (!this.clipboard.copy(this.url)) {
      this.actions.failed(new Error('copying to the clipboard failed'));
      return;
    }
    this.snackBar.open(this.transloco.translate('snack.copied'), undefined, { duration: 3000, verticalPosition: 'top' });
  }

  protected end(): void {
    this.ref.dismiss();
    const { id } = this.data.share;
    const t = this.transloco;
    this.api.endShare(id).then(
      () => {
        void this.shares.refresh();
        this.snackBar
          .open(t.translate('snack.shareEnded'), t.translate('snack.undo'), { duration: 5000 })
          .onAction()
          .subscribe(() => {
            // share_invalid once its 14 days have run out, or the list has a newer link
            this.api.restoreShare(id).then(
              () => this.shares.refresh(),
              (err: unknown) => this.actions.failed(err),
            );
          });
      },
      (err: unknown) => this.actions.failed(err),
    );
  }
}
