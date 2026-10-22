import { Component, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { ApiError } from '@promus/shared';
import { ApiClient } from '../../core/api';
import { SECURE_CONTEXT } from '../../core/platform';
import { CookieRejectedError, SessionService } from '../../core/session';
import { SyncService } from '../../core/sync.service';
import { AccountForm, type AccountValue, type FormError, formErrorOf } from '../../shared/account-form';
import { HttpsNotice } from '../../shared/https-notice';
import { PhoneCard } from '../../shared/phone-card';

type State = 'checking' | 'form' | 'invalid' | 'phone';

/** An invite link, `/join#<token>`: the token stays in the fragment, which never reaches the server's logs. */
@Component({
  selector: 'app-join-page',
  imports: [MatButton, TranslocoDirective, AccountForm, HttpsNotice, PhoneCard],
  template: `
    <ng-container *transloco="let t">
      <h1 class="brand">Promus</h1>
      @if (!secure || cookieRejected()) {
        <app-https-notice [reason]="cookieRejected() ? 'https.cookie' : 'https.how'" />
      } @else {
        @switch (state()) {
          @case ('form') {
            <h2>{{ t('join.title') }}</h2>
            <p>{{ t('join.intro') }}</p>
            <app-account-form submitLabel="join.submit" [busy]="busy()" [error]="error()" (submitted)="join($event)" />
          }
          @case ('invalid') {
            <p role="alert">{{ t('join.invalid') }}</p>
          }
          @case ('phone') {
            <h2>{{ t('setup.phoneTitle') }}</h2>
            <app-phone-card />
            <button matButton="filled" type="button" (click)="done()">{{ t('setup.done') }}</button>
          }
        }
        <!-- offline while checking the link -->
        @if (state() === 'checking' && error(); as e) {
          <p role="alert">{{ t(e.key, e.params) }}</p>
        }
      }
    </ng-container>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      box-sizing: border-box;
      min-height: 100dvh;
      max-width: 24rem;
      margin-inline: auto;
      padding: 2rem 1.5rem;
    }
    h1 {
      margin: 0 0 1rem;
      font: var(--mat-sys-display-medium);
      letter-spacing: var(--mat-sys-display-medium-tracking);
      color: var(--mat-sys-primary);
    }
    h2 {
      margin: 0;
      font: var(--mat-sys-title-large);
    }
    p {
      margin: 0;
      font: var(--mat-sys-body-medium);
    }
  `,
})
export class JoinPage {
  private readonly api = inject(ApiClient);
  private readonly session = inject(SessionService);
  private readonly sync = inject(SyncService);
  private readonly router = inject(Router);
  private readonly token = inject(ActivatedRoute).snapshot.fragment ?? '';
  protected readonly secure = inject(SECURE_CONTEXT);
  protected readonly state = signal<State>('checking');
  protected readonly busy = signal(false);
  protected readonly error = signal<FormError | null>(null);
  protected readonly cookieRejected = signal(false);
  // the account exists once accept succeeds: a retry only signs in, the invite is spent
  private accepted = false;

  constructor() {
    if (!this.secure) return;
    if (this.token === '') {
      this.state.set('invalid');
      return;
    }
    this.api.checkInvite(this.token).then(
      () => this.state.set('form'),
      (err: unknown) => {
        if (err instanceof ApiError && err.code === 'invite_invalid') this.state.set('invalid');
        else this.error.set(formErrorOf(err));
      },
    );
  }

  protected async join({ username, password }: AccountValue): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      // before the invite is used up: a sign-in that this device refuses must leave it usable
      await this.session.assertCanSignIn(username);
      if (!this.accepted) {
        await this.api.acceptInvite({ token: this.token, username, password });
        this.accepted = true;
      }
      await this.session.login(username, password);
    } catch (err) {
      this.busy.set(false);
      if (err instanceof ApiError && err.code === 'invite_invalid') this.state.set('invalid');
      else if (err instanceof CookieRejectedError) this.cookieRejected.set(true);
      else this.error.set(formErrorOf(err));
      return;
    }
    this.busy.set(false);
    this.state.set('phone');
    void this.sync.syncNow();
  }

  protected async done(): Promise<void> {
    await this.router.navigateByUrl('/', { replaceUrl: true });
  }
}
