import { Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatActionList, MatListItem, MatListItemIcon } from '@angular/material/list';
import { TranslocoDirective } from '@jsverse/transloco';
import { filter, merge } from 'rxjs';
import { Actions, refuse } from '../../core/actions';
import { Store, type UndoToken, ValidationError } from '../../core/store';

export type EditSheetData = { listId: string; itemId: string; name: string; note: string | null };

/** Name and note save when the sheet closes; a refused value keeps it open with the reason. */
@Component({
  selector: 'app-edit-sheet',
  imports: [
    ReactiveFormsModule,
    MatFormField,
    MatLabel,
    MatError,
    MatInput,
    MatIcon,
    MatActionList,
    MatListItem,
    MatListItemIcon,
    TranslocoDirective,
  ],
  template: `
    <ng-container *transloco="let t">
      <div class="handle"></div>
      @for (field of fields; track field.label) {
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>{{ t(field.label) }}</mat-label>
          <input matInput [formControl]="field.control" enterkeyhint="done" (keydown.enter)="close()" />
          @let refused = field.control.getError('refused');
          <mat-error>{{ refused && t(refused.key, refused.params) }}</mat-error>
        </mat-form-field>
      }
      <mat-action-list>
        <button mat-list-item (click)="remove()">
          <mat-icon matListItemIcon svgIcon="remove_shopping_cart" />{{ t('edit.remove') }}
        </button>
        <button mat-list-item (click)="archive()">
          <mat-icon matListItemIcon svgIcon="history_toggle_off" />{{ t('edit.archive') }}
        </button>
      </mat-action-list>
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
    }
    .handle {
      width: 2rem;
      height: 0.25rem;
      margin: 0.5rem auto 1rem;
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-on-surface-variant);
      opacity: 0.4;
    }
    mat-form-field {
      display: block;
      margin-block-end: 1rem;
    }
    mat-action-list {
      margin-inline: -1rem;
    }
  `,
})
export class EditSheet {
  private readonly data = inject<EditSheetData>(MAT_BOTTOM_SHEET_DATA);
  private readonly ref = inject<MatBottomSheetRef<EditSheet>>(MatBottomSheetRef);
  private readonly store = inject(Store);
  private readonly actions = inject(Actions);
  private readonly name = new FormControl(this.data.name, { nonNullable: true });
  private readonly note = new FormControl(this.data.note ?? '', { nonNullable: true });
  protected readonly fields = [
    { label: 'edit.name', control: this.name },
    { label: 'edit.note', control: this.note },
  ];
  // kept across tries: a note saved before a refused name still belongs to the next undo
  private readonly saved: UndoToken[] = [];
  // set once the sheet has saved, or dropped the edits for a remove
  private settled = false;

  constructor() {
    const escape = this.ref.keydownEvents().pipe(filter((e) => e.key === 'Escape'));
    merge(this.ref.backdropClick(), escape).subscribe(() => void this.close());
    // Back closes the sheet without close(): keep the edits then too
    this.ref.afterDismissed().subscribe(() => {
      if (!this.settled) this.actions.run(this.save()).catch((err: unknown) => this.actions.failed(err));
    });
  }

  protected async close(): Promise<void> {
    try {
      await this.actions.run(this.save());
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      refuse(err.code === 'note_too_long' ? this.note : this.name, err);
      return;
    }
    this.settled = true;
    this.ref.dismiss();
  }

  protected remove(): void {
    this.settled = true;
    this.ref.dismiss();
    void this.actions.run(this.store.remove(this.data.listId, this.data.itemId));
  }

  protected archive(): void {
    this.settled = true;
    this.ref.dismiss();
    void this.actions.run(this.store.archiveItem(this.data.itemId));
  }

  /** One undo for everything the sheet changed: the newest change's message, all of their inverses. */
  private async save(): Promise<UndoToken | null> {
    const { listId, itemId } = this.data;
    for (const write of [
      () => this.store.setNote(listId, itemId, this.note.value),
      () => this.store.renameItem(itemId, this.name.value),
    ]) {
      const token = await write();
      if (token) this.saved.push(token);
    }
    const last = this.saved.at(-1);
    const token = last ? { ...last, inverse: this.saved.reverse().flatMap((t) => t.inverse) } : null;
    // offered with this undo; a second close has nothing left to offer
    this.saved.length = 0;
    return token;
  }
}
