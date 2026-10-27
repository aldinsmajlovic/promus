import { Component, Injector, computed, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheet, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatActionList, MatListItem, MatListItemIcon } from '@angular/material/list';
import { TranslocoDirective } from '@jsverse/transloco';
import { filter, merge } from 'rxjs';
import { Actions, refuse } from '../../core/actions';
import { GUEST } from '../../core/db';
import { Household } from '../../core/household';
import { WIDE } from '../../core/layout';
import { Store, type UndoToken, ValidationError } from '../../core/store';
import { Face } from '../../shared/face';

/**
 * `addedBy` is null for an add this phone hasn't synced yet: yours. On a guest's phone it can also be an entry the
 * link brought without its add.
 */
export type EditSheetData = {
  listId: string;
  itemId: string;
  name: string;
  note: string | null;
  addedBy: string | null;
};

/** The row's options: a dialog beside it on a computer, a bottom sheet otherwise. Call in an injection context. */
export function openItemOptions(data: EditSheetData, row: HTMLElement): void {
  // the caller's injector, not the root's: a guest's page has its own Store
  const injector = inject(Injector);
  // it closes itself after saving, so a refused value keeps it open; no keyboard until a field is tapped
  if (!inject(WIDE)()) {
    inject(MatBottomSheet).open(EditSheet, {
      data,
      injector,
      ariaLabel: data.name,
      disableClose: true,
      autoFocus: 'dialog',
    });
    return;
  }
  const rect = row.getBoundingClientRect();
  const left = `${Math.min(rect.right + 8, innerWidth - 336)}px`;
  // the dialog grows away from the row's edge that is nearer the middle of the window, so it stays on screen
  const position =
    rect.top < innerHeight / 2 ? { left, top: `${rect.top}px` } : { left, bottom: `${innerHeight - rect.bottom}px` };
  inject(MatDialog).open(EditSheet, {
    data,
    injector,
    width: '20rem',
    ariaLabel: data.name,
    autoFocus: 'dialog',
    disableClose: true,
    position,
  });
}

/** Name and note save when the sheet closes; a refused value keeps it open with the reason. */
@Component({
  selector: 'app-edit-sheet',
  host: { '[class.in-dialog]': '!!dialog' },
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
    Face,
  ],
  template: `
    <ng-container *transloco="let t">
      @if (!dialog) {
        <div class="handle"></div>
      }
      @if (by(); as b) {
        @let byName = b.name ?? t('guest.name');
        <div class="by">
          <app-face [member]="{ id: b.id, username: byName }" [guest]="b.guest" />
          <span class="who">
            <b>{{ b.you ? t('edit.addedByYou') : t('list.addedBy', { name: byName }) }}</b>
            @if (b.guest) {
              <span>{{ t('edit.guestOnList') }}</span>
            }
          </span>
        </div>
      }
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
        <!-- a guest's suggestions are the household's: not theirs to change -->
        @if (!guest) {
          <button mat-list-item (click)="archive()">
            <mat-icon matListItemIcon svgIcon="history_toggle_off" />{{ t('edit.archive') }}
          </button>
        }
      </mat-action-list>
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
    }
    :host(.in-dialog) {
      padding: 1.5rem 1.5rem 0.5rem;
    }
    .handle {
      width: 2rem;
      height: 0.25rem;
      margin: 0.5rem auto 1rem;
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-on-surface-variant);
      opacity: 0.4;
    }
    .by {
      --face-size: 2.25rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-block-end: 1rem;
      padding-block-end: 1rem;
      border-block-end: 1px solid var(--mat-sys-outline-variant);
    }
    .who {
      display: flex;
      flex-direction: column;
    }
    b {
      color: var(--promus-text);
      font-size: 1.0625rem;
      font-weight: 600;
    }
    .who span {
      color: var(--promus-muted);
      font-size: 0.84375rem;
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
  private readonly sheet = inject<MatBottomSheetRef<EditSheet>>(MatBottomSheetRef, { optional: true });
  protected readonly dialog = inject<MatDialogRef<EditSheet>>(MatDialogRef, { optional: true });
  protected readonly data = inject<EditSheetData>(this.dialog ? MAT_DIALOG_DATA : MAT_BOTTOM_SHEET_DATA);
  // whichever container opened it
  private readonly ref = this.dialog
    ? {
        dismiss: () => this.dialog!.close(),
        backdropClick: () => this.dialog!.backdropClick(),
        keydownEvents: () => this.dialog!.keydownEvents(),
        afterDismissed: () => this.dialog!.afterClosed(),
      }
    : {
        dismiss: () => this.sheet!.dismiss(),
        backdropClick: () => this.sheet!.backdropClick(),
        keydownEvents: () => this.sheet!.keydownEvents(),
        afterDismissed: () => this.sheet!.afterDismissed(),
      };
  private readonly store = inject(Store);
  private readonly actions = inject(Actions);
  private readonly household = inject(Household);
  protected readonly guest = inject(GUEST) !== null;
  /** Who put it on the list, once known; on a guest's phone, no one rather than perhaps the wrong one. */
  protected readonly by = computed(() => {
    const you = this.household.you();
    const id = this.data.addedBy ?? (this.guest ? null : you);
    const person = id && this.household.person(id);
    return person ? { ...person, you: id === you } : undefined;
  });
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
