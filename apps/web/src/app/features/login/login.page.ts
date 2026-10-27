import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { Router } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { ApiError, NetworkError } from '@promus/shared';
import { SECURE_CONTEXT } from '../../core/platform';
import { CookieRejectedError, PendingOtherUserError, SessionService } from '../../core/session';
import { SyncService } from '../../core/sync.service';
import { HttpsNotice } from '../../shared/https-notice';
import { LangSwitch } from '../../shared/lang-switch';

// a proper noun: the same in every language
const APP_NAME = 'Promus';

type Message = { key: string; params?: Record<string, string> };

function messageOf(err: unknown): Message {
  if (err instanceof PendingOtherUserError) return { key: err.messageKey, params: err.params };
  if (err instanceof NetworkError) return { key: 'login.offline' };
  if (err instanceof ApiError && err.code === 'invalid_credentials') return { key: 'login.invalid' };
  if (err instanceof ApiError && err.code === 'rate_limited') return { key: 'login.rateLimited' };
  console.error('login failed', err);
  return { key: 'login.failed' };
}

@Component({
  selector: 'app-login-page',
  imports: [
    ReactiveFormsModule,
    MatFormField,
    MatLabel,
    MatIcon,
    MatInput,
    MatButton,
    TranslocoDirective,
    HttpsNotice,
    LangSwitch,
  ],
  templateUrl: './login.page.html',
  styles: `
    .mark {
      display: grid;
      place-items: center;
      width: 3.5rem;
      height: 3.5rem;
      margin-block-end: 0.5rem;
      border-radius: 50%;
      background: var(--promus-accent);
      color: var(--promus-band);
    }
    .mark mat-icon {
      width: 1.75rem;
      height: 1.75rem;
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .error {
      font: var(--mat-sys-body-medium);
      color: var(--mat-sys-error);
    }
  `,
})
export class LoginPage {
  private readonly session = inject(SessionService);
  private readonly sync = inject(SyncService);
  private readonly router = inject(Router);
  protected readonly appName = APP_NAME;
  protected readonly form = inject(NonNullableFormBuilder).group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<Message | null>(null);
  protected readonly secure = inject(SECURE_CONTEXT);
  protected readonly cookieRejected = signal(false);

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const { username, password } = this.form.getRawValue();
      await this.session.login(username, password);
    } catch (err) {
      if (err instanceof CookieRejectedError) this.cookieRejected.set(true);
      else this.error.set(messageOf(err));
      this.busy.set(false);
      return;
    }
    // busy until the page is left: a tap on the way home must not sign in again
    let left = false;
    try {
      left = await this.router.navigateByUrl('/', { replaceUrl: true });
    } finally {
      if (!left) this.busy.set(false);
    }
    void this.sync.syncNow();
  }
}
