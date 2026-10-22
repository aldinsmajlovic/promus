import { Component, effect, inject, input, output, signal } from '@angular/core';
import { type AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatError, MatFormField, MatHint, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { TranslocoDirective } from '@jsverse/transloco';
import { MIN_PASSWORD_LENGTH } from '@promus/shared';

export type AccountValue = { setupCode: string; username: string; password: string };

/** A refusal to show: under its field, or above the button when `field` is null. */
export type FormError = { field: keyof AccountValue | null; key: string; params?: Record<string, string> };

type Message = { key: string; params?: Record<string, string | number> };

/** A new account's username and password, for the setup wizard (with its code) and for joining. */
@Component({
  selector: 'app-account-form',
  imports: [
    ReactiveFormsModule,
    MatFormField,
    MatLabel,
    MatHint,
    MatError,
    MatSuffix,
    MatInput,
    MatButton,
    MatIconButton,
    MatIcon,
    TranslocoDirective,
  ],
  template: `
    <form *transloco="let t" [formGroup]="form" (ngSubmit)="submit()">
      @if (setupCode()) {
        <mat-form-field>
          <mat-label>{{ t('setup.code') }}</mat-label>
          <input
            matInput
            formControlName="setupCode"
            autocomplete="one-time-code"
            autocapitalize="characters"
            spellcheck="false"
            enterkeyhint="next"
          />
          <mat-hint>{{ t('setup.codeHint') }}</mat-hint>
          @if (message(form.controls.setupCode); as m) {
            <mat-error>{{ t(m.key, m.params) }}</mat-error>
          }
        </mat-form-field>
      }
      <mat-form-field>
        <mat-label>{{ t('account.username') }}</mat-label>
        <input
          matInput
          formControlName="username"
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
          enterkeyhint="next"
        />
        @if (message(form.controls.username); as m) {
          <mat-error>{{ t(m.key, m.params) }}</mat-error>
        }
      </mat-form-field>
      <mat-form-field>
        <mat-label>{{ t('account.password') }}</mat-label>
        <input
          matInput
          [type]="show() ? 'text' : 'password'"
          formControlName="password"
          autocomplete="new-password"
          enterkeyhint="go"
        />
        <button
          matIconButton
          matSuffix
          type="button"
          [attr.aria-label]="t(show() ? 'account.hide' : 'account.show')"
          [attr.aria-pressed]="show()"
          (click)="show.set(!show())"
        >
          <mat-icon [svgIcon]="show() ? 'visibility_off' : 'visibility'" />
        </button>
        <mat-hint>{{ t('account.minLength', { n: minLength }) }}</mat-hint>
        @if (message(form.controls.password); as m) {
          <mat-error>{{ t(m.key, m.params) }}</mat-error>
        }
      </mat-form-field>
      <!-- always there, so screen readers announce what appears in it -->
      <p class="error" role="alert">
        @if (general(); as e) {
          {{ t(e.key, e.params) }}
        }
      </p>
      <button matButton="filled" type="submit" [disabled]="busy()">{{ t(submitLabel()) }}</button>
    </form>
  `,
  styles: `
    form {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .error {
      margin: 0;
      font: var(--mat-sys-body-medium);
      color: var(--mat-sys-error);
    }
  `,
})
export class AccountForm {
  readonly setupCode = input(false);
  readonly busy = input(false);
  readonly error = input<FormError | null>(null);
  /** The submit button's translation key. */
  readonly submitLabel = input.required<string>();
  readonly submitted = output<AccountValue>();

  protected readonly minLength = MIN_PASSWORD_LENGTH;
  protected readonly show = signal(false);
  protected readonly general = signal<FormError | null>(null);
  protected readonly form = inject(NonNullableFormBuilder).group({
    setupCode: [''],
    username: ['', Validators.required],
    password: ['', [Validators.required, Validators.minLength(MIN_PASSWORD_LENGTH)]],
  });

  constructor() {
    effect(() => {
      const e = this.error();
      this.general.set(e && e.field === null ? e : null);
      if (!e?.field) return;
      const control = this.form.controls[e.field];
      control.setErrors({ server: e });
      control.markAsTouched();
    });
  }

  protected message(control: AbstractControl): Message | null {
    if (!control.errors || !control.touched) return null;
    const server = control.getError('server') as FormError | null;
    if (server) return server;
    if (control === this.form.controls.setupCode) return { key: 'account.errors.setupCode' };
    if (control === this.form.controls.username) return { key: 'account.errors.username_invalid' };
    return { key: 'account.minLength', params: { n: this.minLength } };
  }

  protected submit(): void {
    if (this.busy()) return;
    const { setupCode } = this.form.controls;
    // required only while it shows
    setupCode.setErrors(this.setupCode() && setupCode.value.trim() === '' ? { required: true } : null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.general.set(null);
    this.submitted.emit(this.form.getRawValue());
  }
}
