import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { Actions } from './actions';
import { PromusDb } from './db';
import { Household } from './household';
import { injectCloseOverlays } from './overlays';
import { SessionService } from './session';
import { Store } from './store';
import { SyncService } from './sync.service';

/**
 * A device whose user is no longer in its household: closes what's open, deletes the household's data, gets a
 * household of its own and lands on its fresh list. A removal says whose household it was.
 */
@Injectable({ providedIn: 'root' })
export class StartOver {
  private readonly db = inject(PromusDb);
  private readonly session = inject(SessionService);
  private readonly sync = inject(SyncService);
  private readonly store = inject(Store);
  private readonly household = inject(Household);
  private readonly actions = inject(Actions);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly transloco = inject(TranslocoService);
  private readonly closeOverlays = injectCloseOverlays();

  async run(reason: 'removed' | 'left'): Promise<void> {
    this.sync.stop();
    await this.closeOverlays();
    // read before the wipe takes the members with it
    const owner = (await this.db.getMeta('members'))?.find((m) => m.role === 'owner' && !m.former)?.username;
    let started;
    try {
      started = await this.session.startOver();
    } catch (err) {
      this.actions.failed(err);
      await this.router.navigateByUrl('/login', { replaceUrl: true });
      return;
    }
    if (!started) {
      await this.router.navigateByUrl('/login', { replaceUrl: true });
      return;
    }
    await this.store.load();
    void this.household.refresh();
    this.sync.start();
    await this.router.navigateByUrl('/', { replaceUrl: true });
    // after the page change, which would dismiss it. Without a duration it stays until dismissed
    if (reason === 'removed' && started.created && owner) {
      this.snackBar.open(
        this.transloco.translate('snack.removedYou', { owner }),
        this.transloco.translate('snack.ok'),
      );
    }
  }
}
