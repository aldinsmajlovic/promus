import { Clipboard } from '@angular/cdk/clipboard';
import { Component, inject, input } from '@angular/core';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatSnackBar, type MatSnackBarConfig } from '@angular/material/snack-bar';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import type { EntryView } from '@promus/shared';
import { Actions } from '../../core/actions';
import { ApiClient } from '../../core/api';
import { GUEST } from '../../core/db';
import { Shares } from '../../core/shares';
import { SyncService } from '../../core/sync.service';
import { ShareSheet, type ShareSheetData } from './share-sheet';

// at the top: the share sheet takes the bottom of the screen
const SNACK: MatSnackBarConfig = { duration: 5000, verticalPosition: 'top' };

/**
 * What's left to get, under the list's name: one per line, or a Markdown checklist.
 * ponytail: names go in unescaped, so a `*` or `_` in one can turn Markdown emphasis on; escape them if that bites.
 */
export function listText(name: string, entries: readonly EntryView[], format: 'text' | 'markdown'): string {
  const lines = entries.map((e) => `${e.name}${e.quantity > 1 ? ` ×${e.quantity}` : ''}${e.note ? ` (${e.note})` : ''}`);
  return format === 'text'
    ? [name, '', ...lines].join('\n')
    : [`# ${name}`, '', ...lines.map((l) => `- [ ] ${l}`)].join('\n');
}

/** Share in the band: the list's link, made now unless it has a live one, or what's left to get as text. */
@Component({
  selector: 'app-share-button',
  imports: [MatIconButton, MatIcon, MatMenu, MatMenuItem, MatMenuTrigger, TranslocoDirective],
  template: `
    <ng-container *transloco="let t">
      <button matIconButton [matMenuTriggerFor]="menu" [attr.aria-label]="t('share.share')">
        <mat-icon svgIcon="share" />
      </button>
      <mat-menu #menu="matMenu" xPosition="before">
        <!-- a guest's list is the household's to share -->
        @if (!guest) {
          <button mat-menu-item (click)="share()"><mat-icon svgIcon="link" />{{ t('share.link') }}</button>
        }
        <button mat-menu-item (click)="copy('text')">
          <mat-icon svgIcon="content_copy" />{{ t('share.copyText') }}
        </button>
        <button mat-menu-item (click)="copy('markdown')">
          <mat-icon svgIcon="checklist" />{{ t('share.copyMarkdown') }}
        </button>
      </mat-menu>
    </ng-container>
  `,
})
export class ShareButton {
  readonly list = input.required<{ id: string; name: string }>();
  /** The rows left to get, as the list shows them. */
  readonly entries = input.required<readonly EntryView[]>();
  private readonly api = inject(ApiClient);
  private readonly sheet = inject(MatBottomSheet);
  private readonly sync = inject(SyncService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly transloco = inject(TranslocoService);
  private readonly clipboard = inject(Clipboard);
  private readonly actions = inject(Actions);
  private readonly shares = inject(Shares);
  protected readonly guest = inject(GUEST) !== null;

  protected copy(format: 'text' | 'markdown'): void {
    if (!this.clipboard.copy(listText(this.list().name, this.entries(), format))) {
      this.actions.failed(new Error('copying to the clipboard failed'));
      return;
    }
    this.snackBar.open(this.transloco.translate('snack.listCopied'), undefined, { duration: 3000 });
  }

  /** Opens the list's link, made now unless it has a live one; Undo ends a link made now. */
  protected async share(): Promise<void> {
    const list = this.list();
    let made: Awaited<ReturnType<ApiClient['createShare']>>;
    try {
      // a list the server hasn't seen yet can't be shared; syncNow never rejects
      if (this.sync.status().pending > 0) await this.sync.syncNow();
      made = await this.api.createShare(list.id);
    } catch (err) {
      this.actions.failed(err);
      return;
    }
    const t = this.transloco;
    const data: ShareSheetData = { listName: list.name, share: made.share };
    this.sheet.open(ShareSheet, { data, ariaLabel: t.translate('share.title', { list: list.name }) });
    if (!made.created) return;
    void this.shares.refresh();
    this.snackBar
      .open(t.translate('snack.shareMade'), t.translate('snack.undo'), SNACK)
      .onAction()
      .subscribe(() => {
        // whichever sheet is open now: this one may be closed, and the link opened again
        this.sheet.dismiss();
        this.api.endShare(made.share.id).then(
          () => this.shares.refresh(),
          (err: unknown) => this.actions.failed(err, SNACK),
        );
      });
  }
}
