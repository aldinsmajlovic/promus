import { Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { TranslocoDirective } from '@jsverse/transloco';
import { refuse } from '../../core/actions';
import { ValidationError } from '../../core/store';

/** `save` rejects with a ValidationError to keep the dialog open with the reason. */
export type NameDialogData = { title: string; name: string; save: (name: string) => Promise<unknown> };

/** One name field, for creating and renaming lists. */
@Component({
  selector: 'app-name-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormField,
    MatLabel,
    MatError,
    MatInput,
    MatButton,
    TranslocoDirective,
  ],
  template: `
    <form *transloco="let t" (submit)="submit($event)">
      <h2 mat-dialog-title>{{ t(data.title) }}</h2>
      <mat-dialog-content>
        <mat-form-field>
          <mat-label>{{ t('edit.name') }}</mat-label>
          <input matInput [formControl]="name" enterkeyhint="done" />
          @let refused = name.getError('refused');
          <mat-error>{{ refused && t(refused.key, refused.params) }}</mat-error>
        </mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions>
        <button matButton type="button" mat-dialog-close>{{ t('dialog.cancel') }}</button>
        <button matButton type="submit">{{ t('dialog.save') }}</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    mat-form-field {
      display: block;
    }
  `,
})
export class NameDialog {
  protected readonly data = inject<NameDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef);
  protected readonly name = new FormControl(this.data.name, { nonNullable: true });
  // a second tap on Save must not create a second list
  private saving = false;

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving) return;
    this.saving = true;
    try {
      await this.data.save(this.name.value);
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      refuse(this.name, err);
      return;
    } finally {
      this.saving = false;
    }
    this.ref.close();
  }
}
