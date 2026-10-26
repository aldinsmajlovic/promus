import { Component, computed, inject } from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { Actions } from '../../core/actions';
import { injectBack } from '../../core/back';
import { PendingChangesError } from '../../core/db';
import { SessionService } from '../../core/session';
import { Store } from '../../core/store';
import { syncBadge } from '../../core/sync-badge';
import { SyncService } from '../../core/sync.service';
import { Face } from '../../shared/face';

/** You, whether your changes have reached the server, and signing out. */
@Component({
  selector: 'app-account-page',
  imports: [MatButton, MatIconButton, MatIcon, RouterLink, TranslocoDirective, Face],
  templateUrl: './account.page.html',
  styleUrl: './account.page.scss',
})
export class AccountPage {
  private readonly session = inject(SessionService);
  private readonly store = inject(Store);
  private readonly sync = inject(SyncService);
  private readonly actions = inject(Actions);
  private readonly router = inject(Router);
  protected readonly user = this.session.session;
  protected readonly pending = this.store.pendingCount;
  protected readonly back = injectBack();
  protected readonly kind = computed(() => this.sync.status().kind);
  /** Why the sync needs attention, in words; the unsynced count has its own line. */
  protected readonly statusKey = computed(() => {
    const kind = this.kind();
    if (kind === 'offline') return { key: 'login.offline', params: {} };
    if (kind !== 'error' && kind !== 'auth') return null;
    return syncBadge(this.sync.status());
  });

  // sv and en need only one and other
  protected pendingKey(n: number): string {
    return n === 1 ? 'settings.pending.one' : 'settings.pending.other';
  }

  protected retry(): void {
    this.sync.syncNow().catch((err: unknown) => this.actions.failed(err));
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
