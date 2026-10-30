import { Component, Injector, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheet, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatIconButton } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatError, MatFormField, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatActionList, MatListItem, MatListItemIcon } from '@angular/material/list';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { LIMITS } from '@promus/shared';
import { filter, merge } from 'rxjs';
import { Actions, refuse } from '../../core/actions';
import { GUEST } from '../../core/db';
import { Household } from '../../core/household';
import { WIDE } from '../../core/layout';
import { parsePrice, priceText } from '../../core/price';
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
  quantity: number;
  /** The item's, in öre. */
  price: number | null;
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

/** Name, note, quantity and price save when the sheet closes; a refused value keeps it open with the reason. */
@Component({
  selector: 'app-edit-sheet',
  host: { '[class.in-dialog]': '!!dialog' },
  imports: [
    ReactiveFormsModule,
    MatFormField,
    MatLabel,
    MatError,
    MatSuffix,
    MatInput,
    MatIcon,
    MatIconButton,
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
            <!-- tells the others who someone is: nothing to say to yourself -->
            @if (b.guest && !b.you) {
              <span>{{ t('edit.guestOnList') }}</span>
            }
          </span>
        </div>
      }
      <h2 class="brand">{{ data.name }}</h2>
      @for (field of fields; track field.label) {
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>{{ t(field.label) }}</mat-label>
          <input
            matInput
            autocapitalize="sentences"
            enterkeyhint="done"
            [formControl]="field.control"
            (keydown.enter)="close()"
          />
          @let refused = field.control.getError('refused');
          <mat-error>{{ refused && t(refused.key, refused.params) }}</mat-error>
        </mat-form-field>
      }
      <div class="amounts">
        <div class="stepper" role="group" [attr.aria-label]="t('edit.quantity')">
          <button matIconButton [disabled]="quantity() <= 1" [attr.aria-label]="t('edit.fewer')" (click)="step(-1)">
            <mat-icon svgIcon="remove" />
          </button>
          <span class="count">
            <span class="label" aria-hidden="true">{{ t('edit.quantity') }}</span>
            <output aria-live="polite">{{ quantity() }}</output>
          </span>
          <button
            matIconButton
            [disabled]="quantity() >= quantityMax"
            [attr.aria-label]="t('edit.more')"
            (click)="step(1)"
          >
            <mat-icon svgIcon="add" />
          </button>
        </div>
        <mat-form-field class="price" subscriptSizing="dynamic">
          <mat-label>{{ t('edit.price') }}</mat-label>
          <input matInput [formControl]="price" inputmode="decimal" enterkeyhint="done" (keydown.enter)="close()" />
          <span matTextSuffix>{{ t('edit.currency') }}</span>
          @let priceRefused = price.getError('refused');
          <mat-error>{{ priceRefused && t(priceRefused.key, priceRefused.params) }}</mat-error>
        </mat-form-field>
      </div>
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
    // Material makes a dialog's host display: contents, as weighty as :host above, so which won hung on which
    // stylesheet came last: after a bottom sheet, the dialog lost its padding. This one outweighs both.
    :host(.in-dialog) {
      display: block;
      padding: 1.5rem 1.5rem 0.5rem;
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
    .amounts {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      margin-block-end: 1rem;
    }
    .amounts mat-form-field {
      flex: 1;
      min-width: 0;
      margin-block-end: 0;
    }
    // as tall and as round as the text box beside it
    .stepper {
      display: flex;
      align-items: center;
      height: 3.5rem;
      padding-inline: 0.25rem;
      border-radius: 0.75rem;
      background: var(--promus-field);
    }
    .count {
      display: flex;
      flex-direction: column;
      align-items: center;
      min-width: 2.75rem;
    }
    .count .label {
      color: var(--promus-muted);
      font-size: 0.75rem;
      line-height: 1rem;
    }
    output {
      color: var(--promus-text);
      font-size: 1rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
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
  protected readonly price = new FormControl(priceText(this.data.price, inject(TranslocoService).getActiveLang()), {
    nonNullable: true,
  });
  protected readonly quantity = signal(this.data.quantity);
  protected readonly quantityMax = LIMITS.quantityMax;
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
      refuse(err.code === 'note_too_long' ? this.note : err.code === 'price_invalid' ? this.price : this.name, err);
      return;
    }
    this.settled = true;
    this.ref.dismiss();
  }

  protected step(by: number): void {
    this.quantity.update((q) => q + by);
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

  /** Writes each field on its own; rejects with the first refusal once all were tried. */
  private async save(): Promise<void> {
    const { listId, itemId } = this.data;
    let refused: ValidationError | null = null;
    for (const write of [
      () => this.store.setNote(listId, itemId, this.note.value),
      () => this.store.setQuantity(listId, itemId, this.quantity()),
      () => this.store.setPrices([{ itemId, price: parsePrice(this.price.value) }]),
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
