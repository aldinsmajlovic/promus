import { Component, inject } from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
import { MatToolbar } from '@angular/material/toolbar';
import { Router } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { version } from '../../../../../../package.json';
import { Actions } from '../../core/actions';
import { injectBack } from '../../core/back';
import { PendingChangesError } from '../../core/db';
import { type Lang, LangService } from '../../core/i18n';
import { SessionService } from '../../core/session';
import { Store } from '../../core/store';
import { type ThemeMode, ThemeService } from '../../core/theme';

@Component({
  selector: 'app-settings-page',
  imports: [
    MatToolbar,
    MatIconButton,
    MatButton,
    MatIcon,
    MatButtonToggleGroup,
    MatButtonToggle,
    TranslocoDirective,
  ],
  templateUrl: './settings.page.html',
  styles: `
    :host {
      display: block;
      max-width: 640px;
      margin-inline: auto;
    }
    mat-toolbar {
      gap: 0.25rem;
      padding-inline: 0.25rem 1rem;
    }
    h1 {
      margin: 0;
      font: inherit;
    }
    section {
      padding: 1rem;
    }
    h2 {
      margin: 0 0 0.75rem;
      font: var(--mat-sys-title-small);
      letter-spacing: var(--mat-sys-title-small-tracking);
      color: var(--mat-sys-primary);
    }
    mat-button-toggle-group {
      display: flex;
    }
    mat-button-toggle {
      flex: 1;
    }
    .account {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .user {
      flex: 1;
      overflow: hidden;
      font: var(--mat-sys-body-large);
      letter-spacing: var(--mat-sys-body-large-tracking);
      text-overflow: ellipsis;
    }
    .pending,
    .version {
      margin: 0;
      font: var(--mat-sys-body-small);
      letter-spacing: var(--mat-sys-body-small-tracking);
      color: var(--mat-sys-on-surface-variant);
    }
    .pending {
      text-align: end;
    }
    .pending:not(:empty) {
      margin-top: 0.5rem;
    }
    .version {
      padding: 1rem;
    }
  `,
})
export class SettingsPage {
  private readonly session = inject(SessionService);
  private readonly store = inject(Store);
  private readonly actions = inject(Actions);
  private readonly router = inject(Router);
  protected readonly lang = inject(LangService);
  protected readonly theme = inject(ThemeService);
  protected readonly user = this.session.session;
  protected readonly pending = this.store.pendingCount;
  protected readonly version = version;
  protected readonly back = injectBack();
  protected readonly langs: { value: Lang | 'system'; label: string }[] = [
    { value: 'system', label: 'settings.system' },
    { value: 'sv', label: 'settings.sv' },
    { value: 'en', label: 'settings.en' },
  ];
  protected readonly themes: { value: ThemeMode; label: string }[] = [
    { value: 'system', label: 'settings.system' },
    { value: 'light', label: 'settings.light' },
    { value: 'dark', label: 'settings.dark' },
  ];

  // sv and en need only one and other
  protected pendingKey(n: number): string {
    return n === 1 ? 'settings.pending.one' : 'settings.pending.other';
  }

  protected setLang(pref: Lang | 'system'): void {
    this.lang.set(pref).catch((err: unknown) => this.actions.failed(err));
  }

  protected setTheme(mode: ThemeMode): void {
    this.theme.set(mode).catch((err: unknown) => this.actions.failed(err));
  }

  protected async signOut(): Promise<void> {
    try {
      await this.session.logout();
    } catch (err) {
      // another tab queued a change a moment ago: reading it shows the count and disables Sign out
      if (err instanceof PendingChangesError) await this.store.load();
      else this.actions.failed(err);
      return;
    }
    await this.router.navigateByUrl('/login', { replaceUrl: true });
  }
}
