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
      <h2 class="brand">{{ data.name }}</h2>
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
    // no font shorthand or family: the global .brand sets the face
    h2 {
      margin: 0 0 1rem;
      color: var(--promus-text);
      font-size: 1.375rem;
      font-weight: 600;
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
  protected readonly data = inject<EditSheetData>(MAT_BOTTOM_SHEET_DATA);
  private readonly ref = inject<MatBottomSheetRef<EditSheet>>(MatBottomSheetRef);
  private readonly store = inject(Store);
  private readonly actions = inject(Actions);
  private readonly name = new FormControl(this.data.name, { nonNullable: true });
  private readonly note = new FormControl(this.data.note ?? '', { nonNullable: true });
  protected readonly fields = [
    { label: 'edit.name', control: this.name },
    { label: 'edit.note', control: this.note },
  ];
  // committed but not yet offered: the next undo covers them, so a note saved before a refused name
  // is undone together with whatever closes the sheet
  private readonly committed: UndoToken[] = [];
  // set once a close path has taken over, so dismissing does not save again
  private settled = false;

  constructor() {
    const escape = this.ref.keydownEvents().pipe(filter((e) => e.key === 'Escape'));
    merge(this.ref.backdropClick(), escape).subscribe(() => void this.close());
    // Back closes the sheet without close(): keep the valid edits then too, and drop a refused one
    this.ref.afterDismissed().subscribe(() => {
      if (this.settled) return;
      const saved = this.save().catch((err: unknown) => {
        if (!(err instanceof ValidationError)) throw err;
      });
      void this.actions.run(saved.then(() => this.takeUndo()));
    });
  }

  protected async close(): Promise<void> {
    try {
      await this.actions.run(this.save().then(() => this.takeUndo()));
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      refuse(err.code === 'note_too_long' ? this.note : this.name, err);
      return;
    }
    this.settled = true;
    this.ref.dismiss();
  }

  protected remove(): void {
    this.leave(this.store.remove(this.data.listId, this.data.itemId));
  }

  protected archive(): void {
    this.leave(this.store.archiveItem(this.data.itemId));
  }

  /** Closes the sheet for `action`, dropping unsaved edits; its undo also covers what was saved. */
  private leave(action: Promise<UndoToken | null>): void {
    this.settled = true;
    this.ref.dismiss();
    void this.actions.run(action.then((token) => this.takeUndo(token)));
  }

  /** Writes each field on its own; rejects with the first refusal once both were tried. */
  private async save(): Promise<void> {
    const { listId, itemId } = this.data;
    let refused: ValidationError | null = null;
    for (const write of [
      () => this.store.setNote(listId, itemId, this.note.value),
      () => this.store.renameItem(itemId, this.name.value),
    ]) {
      try {
        const token = await write();
        if (token) this.committed.push(token);
      } catch (err) {
        if (!(err instanceof ValidationError)) throw err;
        refused ??= err;
      }
    }
    if (refused) throw refused;
  }

  /** One undo for everything committed since the last one, `last` included: the newest message, every inverse. */
  private takeUndo(last: UndoToken | null = null): UndoToken | null {
    const tokens = this.committed.splice(0);
    if (last) tokens.push(last);
    const newest = tokens.at(-1);
    return newest ? { ...newest, inverse: tokens.reverse().flatMap((t) => t.inverse) } : null;
  }
}
