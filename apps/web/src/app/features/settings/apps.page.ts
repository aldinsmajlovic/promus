import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuContent, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatSnackBar, type MatSnackBarConfig } from '@angular/material/snack-bar';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { type ApiToken, AuthError, NetworkError } from '@promus/shared';
import { Actions } from '../../core/actions';
import { ApiClient } from '../../core/api';
import { injectBack } from '../../core/back';
import { API_DOCS_URL } from '../../core/docs';
import { RowGestures } from '../list/row-gestures';
import { injectConnect } from './token-sheet';

const SNACK: MatSnackBarConfig = { duration: 5000 };
const DAY_MS = 86_400_000;

const startOfDay = (ms: number): number => new Date(ms).setHours(0, 0, 0, 0);

/**
 * The apps with a token: when each was last used, connecting a new one, and disconnecting. Tap, hold or
 * right-click an app to disconnect it.
 */
@Component({
  selector: 'app-apps-page',
  imports: [MatButton, MatIconButton, MatIcon, MatMenu, MatMenuContent, MatMenuItem, MatMenuTrigger, TranslocoDirective, RowGestures],
  templateUrl: './apps.page.html',
  styleUrl: './apps.page.scss',
})
export class AppsPage {
  private readonly api = inject(ApiClient);
  private readonly actions = inject(Actions);
  private readonly snackBar = inject(MatSnackBar);
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
  protected readonly tokens = signal<ApiToken[] | null>(null);
  protected readonly back = injectBack();
  protected readonly connect = injectConnect();
  protected readonly docs = API_DOCS_URL;

  constructor() {
    void this.refresh();
  }

  protected refresh = async (): Promise<void> => {
    try {
      this.tokens.set(await this.api.tokens());
    } catch (err) {
      // offline or signed out: what was shown stays
      if (!(err instanceof NetworkError || err instanceof AuthError)) console.error('tokens failed', err);
    }
  };

  /** The translation key and params for when a token was last used, by the device's calendar day. */
  protected lastUsed(t: ApiToken): { key: string; params: Record<string, string> } {
    if (t.lastUsedAt === null) return { key: 'apps.neverUsed', params: {} };
    const days = Math.round((startOfDay(Date.now()) - startOfDay(t.lastUsedAt)) / DAY_MS);
    if (days <= 0) return { key: 'apps.usedToday', params: {} };
    if (days === 1) return { key: 'apps.usedYesterday', params: {} };
    const date = new Intl.DateTimeFormat(this.lang(), { day: 'numeric', month: 'short' }).format(t.lastUsedAt);
    return { key: 'apps.usedOn', params: { date } };
  }

  protected async disconnect(token: ApiToken): Promise<void> {
    try {
      await this.api.revokeToken(token.id);
    } catch (err) {
      this.actions.failed(err, SNACK);
      await this.refresh(); // the row may already be gone
      return;
    }
    await this.refresh();
    this.snackBar
      .open(
        this.transloco.translate('snack.appDisconnected', { name: token.name }),
        this.transloco.translate('snack.undo'),
        SNACK,
      )
      .onAction()
      .subscribe(() => {
        this.api.restoreToken(token.id).then(this.refresh, (err: unknown) => this.actions.failed(err, SNACK));
      });
  }
}
