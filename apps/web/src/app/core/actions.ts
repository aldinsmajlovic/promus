import { Injectable, PendingTasks, inject } from '@angular/core';
import type { FormControl } from '@angular/forms';
import { MatSnackBar, type MatSnackBarConfig } from '@angular/material/snack-bar';
import { TranslocoService } from '@jsverse/transloco';
import { LIMITS } from '@promus/shared';
import { Store, type UndoToken, ValidationError } from './store';

const SNACK_MS = 5000;

const REFUSALS: Record<ValidationError['code'], { key: string; params: Record<string, number> }> = {
  name_empty: { key: 'errors.nameEmpty', params: {} },
  name_too_long: { key: 'errors.nameTooLong', params: { max: LIMITS.nameMax } },
  name_taken: { key: 'errors.nameTaken', params: {} },
  note_too_long: { key: 'errors.noteTooLong', params: { max: LIMITS.noteMax } },
};

/** Marks the field with the Store's refusal; its `<mat-error>` shows `getError('refused')`. */
export function refuse(control: FormControl<string>, err: ValidationError): void {
  control.setErrors({ refused: REFUSALS[err.code] });
  control.markAsTouched();
}

/** Runs Store actions for the UI: each one gets an undo snackbar, each failure a message. */
@Injectable({ providedIn: 'root' })
export class Actions {
  private readonly store = inject(Store);
  private readonly snackBar = inject(MatSnackBar);
  private readonly transloco = inject(TranslocoService);
  private readonly tasks = inject(PendingTasks);

  /**
   * Rejects with a ValidationError, for the field that caused it; any other failure is shown and resolves null.
   * `snack` places its snackbars, e.g. at the top.
   */
  async run<T extends UndoToken | null>(action: Promise<T>, snack: MatSnackBarConfig = {}): Promise<T | null> {
    // keeps the app unstable until the action settles; ending it also runs change detection, which
    // (zoneless) is what shows a refusal set on a field after the await
    const done = this.tasks.add();
    try {
      const token = await action;
      if (token) this.offerUndo(token, snack);
      return token;
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      this.failed(err, snack);
      return null;
    } finally {
      done();
    }
  }

  failed(err: unknown, snack: MatSnackBarConfig = {}): void {
    console.error('action failed', err);
    this.snackBar.open(this.transloco.translate('errors.actionFailed'), undefined, { ...snack, duration: SNACK_MS });
  }

  private offerUndo(token: UndoToken, snack: MatSnackBarConfig): void {
    const t = this.transloco;
    this.snackBar
      .open(t.translate(token.messageKey, token.params), t.translate('snack.undo'), { ...snack, duration: SNACK_MS })
      .onAction()
      .subscribe(() => void this.run(this.store.undo(token).then(() => null), snack));
  }
}
