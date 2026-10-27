import { Component, ElementRef, inject, viewChildren } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatError, MatFormField, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { TranslocoDirective } from '@jsverse/transloco';
import { filter, merge } from 'rxjs';
import { Actions, refuse } from '../../core/actions';
import { parsePrice } from '../../core/price';
import { Store, ValidationError } from '../../core/store';

/** The rows without a price. */
export type PriceSheetData = { itemId: string; name: string }[];

type Read = { prices: { itemId: string; price: number }[]; refused: { index: number; err: ValidationError } | null };

/**
 * A Price field for each row that has none, for after shopping, receipt in hand. Enter moves to the next field;
 * closing saves every price typed as one action, with one undo, or stays open on one that doesn't read.
 */
@Component({
  selector: 'app-price-sheet',
  imports: [ReactiveFormsModule, MatFormField, MatLabel, MatError, MatSuffix, MatInput, TranslocoDirective],
  template: `
    <ng-container *transloco="let t">
      <div class="handle"></div>
      <h2 class="brand">{{ t('prices.title') }}</h2>
      @for (f of fields; track f.itemId; let i = $index, last = $last) {
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>{{ f.name }}</mat-label>
          <input
            #input
            matInput
            [formControl]="f.control"
            inputmode="decimal"
            [attr.enterkeyhint]="last ? 'done' : 'next'"
            (keydown.enter)="next(i)"
          />
          <span matTextSuffix>{{ t('edit.currency') }}</span>
          @let refused = f.control.getError('refused');
          <mat-error>{{ refused && t(refused.key, refused.params) }}</mat-error>
        </mat-form-field>
      }
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
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
  `,
})
export class PriceSheet {
  private readonly ref = inject<MatBottomSheetRef<PriceSheet>>(MatBottomSheetRef);
  private readonly store = inject(Store);
  private readonly actions = inject(Actions);
  protected readonly fields = inject<PriceSheetData>(MAT_BOTTOM_SHEET_DATA).map(({ itemId, name }) => ({
    itemId,
    name,
    control: new FormControl('', { nonNullable: true }),
  }));
  private readonly inputs = viewChildren<ElementRef<HTMLInputElement>>('input');
  // set once close() has saved, so dismissing does not save again
  private settled = false;

  constructor() {
    const escape = this.ref.keydownEvents().pipe(filter((e) => e.key === 'Escape'));
    merge(this.ref.backdropClick(), escape).subscribe(() => this.close());
    // Back closes the sheet without close(): keep the prices that read, and drop one that doesn't
    this.ref.afterDismissed().subscribe(() => {
      if (!this.settled) this.save(this.read().prices);
    });
  }

  protected next(index: number): void {
    const input = this.inputs()[index + 1];
    if (input) input.nativeElement.focus();
    else this.close();
  }

  private close(): void {
    const { prices, refused } = this.read();
    if (refused) {
      refuse(this.fields[refused.index]!.control, refused.err);
      this.inputs()[refused.index]?.nativeElement.focus();
      return;
    }
    this.settled = true;
    this.ref.dismiss();
    this.save(prices);
  }

  /** The prices typed, and the first that doesn't read. Empty fields are left out. */
  private read(): Read {
    const read: Read = { prices: [], refused: null };
    this.fields.forEach(({ itemId, control }, index) => {
      try {
        const price = parsePrice(control.value);
        if (price !== null) read.prices.push({ itemId, price });
      } catch (err) {
        if (!(err instanceof ValidationError)) throw err;
        read.refused ??= { index, err };
      }
    });
    return read;
  }

  private save(prices: Read['prices']): void {
    if (prices.length) void this.actions.run(this.store.setPrices(prices));
  }
}
