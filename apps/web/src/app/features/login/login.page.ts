import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { Router } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { ApiError, NetworkError } from '@promus/shared';
import { PendingOtherUserError, SessionService } from '../../core/session';
import { SyncService } from '../../core/sync.service';

// a proper noun: the same in every language
const APP_NAME = 'Promus';

type Message = { key: string; params?: Record<string, string> };

function messageOf(err: unknown): Message {
  if (err instanceof PendingOtherUserError) return { key: err.messageKey, params: err.params };
  if (err instanceof NetworkError) return { key: 'login.offline' };
  if (err instanceof ApiError && err.code === 'invalid_credentials') return { key: 'login.invalid' };
  if (err instanceof ApiError && err.code === 'rate_limited') return { key: 'login.rateLimited' };
  console.error('login failed', err);
  return { key: 'errors.actionFailed' };
}

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, MatFormField, MatLabel, MatInput, MatButton, TranslocoDirective],
  templateUrl: './login.page.html',
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      justify-content: center;
      box-sizing: border-box;
      // the space above the keyboard: the viewport resizes for it (interactive-widget in index.html)
      min-height: 100dvh;
      max-width: 24rem;
      margin-inline: auto;
      padding: 2rem 1.5rem;
    }
    h1 {
      margin: 0 0 2.5rem;
      font: var(--mat-sys-display-medium);
      letter-spacing: var(--mat-sys-display-medium-tracking);
      color: var(--mat-sys-primary);
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .error {
      margin: 0;
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
      this.error.set(messageOf(err));
      return;
    } finally {
      this.busy.set(false);
    }
    await this.router.navigateByUrl('/', { replaceUrl: true });
    void this.sync.syncNow();
  }
}
