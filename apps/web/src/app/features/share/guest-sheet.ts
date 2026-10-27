import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { ApiError, GUEST_NAME_MAX, cleanGuestName } from '@promus/shared';
import { Actions } from '../../core/actions';
import { ApiClient } from '../../core/api';
import { GUEST, PromusDb } from '../../core/db';
import { Household } from '../../core/household';
import { SessionService } from '../../core/session';
import { LangSwitch } from '../../shared/lang-switch';

/** A name the server refused as too long, in the shape `refuse()` sets, so the field shows it the same way. */
export const TOO_LONG = { refused: { key: 'errors.nameTooLong', params: { max: GUEST_NAME_MAX } } };

/** A guest's own sheet, from their initial: the name the others see, and the language. */
@Component({
  selector: 'app-guest-sheet',
  imports: [
    ReactiveFormsModule,
    MatButton,
    MatFormField,
    MatLabel,
    MatHint,
    MatError,
    MatInput,
    TranslocoDirective,
    LangSwitch,
  ],
  template: `
    <ng-container *transloco="let t">
      <div class="handle"></div>
      <h2 class="brand">{{ t('guest.sheetTitle') }}</h2>
      <form [formGroup]="form" (ngSubmit)="save()">
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>{{ t('guest.yourName') }}</mat-label>
          <input
            matInput
            formControlName="name"
            [maxlength]="max"
            [placeholder]="t('guest.name')"
            autocomplete="off"
            autocapitalize="words"
            enterkeyhint="done"
          />
          <mat-hint>{{ t('guest.nameHint') }}</mat-hint>
          @let refused = name.getError('refused');
          <mat-error>{{ refused && t(refused.key, refused.params) }}</mat-error>
        </mat-form-field>
        <button matButton="filled" type="submit" [disabled]="busy()">{{ t('guest.save') }}</button>
      </form>
      <app-lang-switch />
    </ng-container>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding-block-end: 0.5rem;
    }
    .handle {
      width: 2rem;
      height: 0.25rem;
      margin: 0.5rem auto 0;
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-on-surface-variant);
      opacity: 0.4;
    }
    // no font shorthand or family: the global .brand sets the face
    h2 {
      margin: 0;
      color: var(--promus-text);
      font-size: 1.5rem;
      font-weight: 600;
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }
  `,
})
export class GuestSheet {
  private readonly ref = inject(MatBottomSheetRef);
  private readonly api = inject(ApiClient);
  private readonly db = inject(PromusDb);
  private readonly session = inject(SessionService);
  private readonly household = inject(Household);
  private readonly actions = inject(Actions);
  private readonly snackBar = inject(MatSnackBar);
  private readonly transloco = inject(TranslocoService);
  private readonly shareId = inject(GUEST)?.shareId ?? '';
  // '' is "Guest"
  private readonly before = this.session.session()?.username ?? '';
  protected readonly form = new FormGroup({ name: new FormControl(this.before, { nonNullable: true }) });
  protected readonly name = this.form.controls.name;
  protected readonly max = GUEST_NAME_MAX;
  protected readonly busy = signal(false);

  protected async save(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.rename(this.name.value);
    } catch (err) {
      this.busy.set(false);
      if (err instanceof ApiError && err.code === 'name_too_long') {
        this.name.setErrors(TOO_LONG);
        this.name.markAsTouched();
      } else this.actions.failed(err);
      return;
    }
    this.ref.dismiss();
    const t = this.transloco;
    const name = this.session.session()?.username || t.translate('guest.name');
    const before = this.before;
    this.snackBar
      .open(t.translate('snack.renamed', { name }), t.translate('snack.undo'), { duration: 5000 })
      .onAction()
      .subscribe(() => this.rename(before).catch((err: unknown) => this.actions.failed(err)));
  }

  /** The face follows: the session's name on this phone, and who's on the list as the link says now. */
  private async rename(name: string): Promise<void> {
    await this.api.renameGuest(this.shareId, name);
    const session = this.session.session();
    if (session) await this.db.setMeta('session', { ...session, username: cleanGuestName(name) ?? '' });
    await this.session.load();
    await this.household.refresh();
  }
}
