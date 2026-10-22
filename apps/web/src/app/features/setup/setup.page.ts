import { Component, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { Router } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { ApiError } from '@promus/shared';
import { ApiClient } from '../../core/api';
import { type Lang, LangService } from '../../core/i18n';
import { SECURE_CONTEXT } from '../../core/platform';
import { CookieRejectedError, SessionService } from '../../core/session';
import { SyncService } from '../../core/sync.service';
import { AccountForm, type AccountValue, type FormError, formErrorOf } from '../../shared/account-form';
import { HttpsNotice } from '../../shared/https-notice';
import { PhoneCard } from '../../shared/phone-card';

/** The first account on a new server: language, then the account with the code from the log, then the phone. */
@Component({
  selector: 'app-setup-page',
  imports: [MatButton, MatButtonToggleGroup, MatButtonToggle, TranslocoDirective, AccountForm, HttpsNotice, PhoneCard],
  template: `
    <ng-container *transloco="let t">
      <h1 class="brand">Promus</h1>
      @if (!secure || cookieRejected()) {
        <app-https-notice [reason]="cookieRejected() ? 'https.cookie' : 'https.how'" />
      } @else {
        @switch (step()) {
          @case ('lang') {
            <h2 id="lang">{{ t('setup.language') }}</h2>
            <mat-button-toggle-group aria-labelledby="lang" [value]="lang()" (change)="setLang($event.value)">
              <mat-button-toggle value="sv">{{ t('settings.sv') }}</mat-button-toggle>
              <mat-button-toggle value="en">{{ t('settings.en') }}</mat-button-toggle>
            </mat-button-toggle-group>
            <button matButton="filled" type="button" (click)="step.set('account')">{{ t('setup.next') }}</button>
          }
          @case ('account') {
            <h2>{{ t('setup.title') }}</h2>
            <p>{{ t('setup.intro') }}</p>
            <app-account-form [setupCode]="true" submitLabel="setup.create" [busy]="busy()" [error]="error()" (submitted)="create($event)" />
          }
          @case ('phone') {
            <h2>{{ t('setup.phoneTitle') }}</h2>
            <app-phone-card />
            <button matButton="filled" type="button" (click)="done()">{{ t('setup.done') }}</button>
          }
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
    mat-button-toggle-group {
      display: flex;
    }
    mat-button-toggle {
      flex: 1;
    }
  `,
})
export class SetupPage {
  private readonly api = inject(ApiClient);
  private readonly session = inject(SessionService);
  private readonly sync = inject(SyncService);
  private readonly router = inject(Router);
  private readonly langs = inject(LangService);
  private readonly transloco = inject(TranslocoService);
  protected readonly secure = inject(SECURE_CONTEXT);
  protected readonly step = signal<'lang' | 'account' | 'phone'>('lang');
  /** The language in use: it names the first list too. */
  protected readonly lang = signal(this.transloco.getActiveLang() as Lang);
  protected readonly busy = signal(false);
  protected readonly error = signal<FormError | null>(null);
  protected readonly cookieRejected = signal(false);

  protected setLang(lang: Lang): void {
    this.lang.set(lang);
    this.langs.set(lang).catch((err: unknown) => console.error('language not saved', err));
  }

  protected async create({ setupCode, username, password }: AccountValue): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.setup({ setupCode, username, password, locale: this.lang() });
      await this.session.login(username, password);
    } catch (err) {
      this.busy.set(false);
      if (err instanceof ApiError && err.code === 'already_set_up') {
        await this.router.navigateByUrl('/login', { replaceUrl: true });
      } else if (err instanceof ApiError && err.code === 'setup_code_invalid') {
        this.error.set({ field: 'setupCode', key: 'setup.codeInvalid' });
      } else if (err instanceof CookieRejectedError) {
        this.cookieRejected.set(true);
      } else {
        this.error.set(formErrorOf(err));
      }
      return;
    }
    this.busy.set(false);
    this.step.set('phone');
    void this.sync.syncNow();
  }

  protected async done(): Promise<void> {
    await this.router.navigateByUrl('/', { replaceUrl: true });
  }
}
