import { Component, computed, inject, signal } from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuContent, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatSnackBar, type MatSnackBarConfig } from '@angular/material/snack-bar';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { ApiError, type Member } from '@promus/shared';
import { Actions } from '../../core/actions';
import { ApiClient } from '../../core/api';
import { injectBack } from '../../core/back';
import { Household } from '../../core/household';
import { SessionService } from '../../core/session';
import { StartOver } from '../../core/start-over';
import { Store } from '../../core/store';
import { SyncService } from '../../core/sync.service';
import { Face } from '../../shared/face';
import { RowGestures } from '../list/row-gestures';
import { injectInvite } from './invite-sheet';

const SNACK: MatSnackBarConfig = { duration: 5000 };

/**
 * Who shares this household's lists, inviting someone new, and leaving. The owner taps, holds or right-clicks a
 * member to remove them. Members are cached for offline.
 */
@Component({
  selector: 'app-household-page',
  imports: [
    MatButton,
    MatIconButton,
    MatIcon,
    MatMenu,
    MatMenuContent,
    MatMenuItem,
    MatMenuTrigger,
    TranslocoDirective,
    Face,
    RowGestures,
  ],
  templateUrl: './household.page.html',
  styleUrl: './household.page.scss',
})
export class HouseholdPage {
  private readonly household = inject(Household);
  private readonly api = inject(ApiClient);
  private readonly session = inject(SessionService);
  private readonly sync = inject(SyncService);
  private readonly startOver = inject(StartOver);
  private readonly actions = inject(Actions);
  private readonly snackBar = inject(MatSnackBar);
  private readonly transloco = inject(TranslocoService);
  protected readonly members = this.household.current;
  protected readonly isOwner = this.household.isOwner;
  protected readonly you = this.household.you;
  protected readonly pending = inject(Store).pendingCount;
  protected readonly back = injectBack();
  protected readonly invite = injectInvite();
  /** From the tap on Leave until it is undone, failed or over: a second tap would sync into a 403. */
  protected readonly leaving = signal(false);
  private readonly owner = computed(() => this.members().find((m) => m.role === 'owner')?.username ?? '');

  constructor() {
    void this.household.refresh();
  }

  // sv and en need only one and other
  protected pendingKey(n: number): string {
    return n === 1 ? 'settings.pending.one' : 'settings.pending.other';
  }

  protected async remove(member: Member): Promise<void> {
    const householdId = this.session.session()?.householdId;
    if (!householdId) return;
    try {
      await this.api.removeMember(householdId, member.id);
      await this.household.refresh();
    } catch (err) {
      this.actions.failed(err, SNACK);
      return;
    }
    const name = member.username;
    this.snackBar
      .open(this.transloco.translate('snack.memberRemoved', { name }), this.transloco.translate('snack.undo'), SNACK)
      .onAction()
      .subscribe(() => {
        void this.restore(householdId, member.id).catch((err: unknown) => {
          if (err instanceof ApiError && err.code === 'member_moved') {
            this.snackBar.open(this.transloco.translate('snack.memberMoved', { name }), undefined, SNACK);
          } else {
            this.actions.failed(err, SNACK);
          }
        });
      });
  }

  private async restore(householdId: string, userId: string): Promise<void> {
    await this.api.restoreMember(householdId, userId);
    await this.household.refresh();
  }

  protected async leave(): Promise<void> {
    const session = this.session.session();
    if (!session) return;
    const { householdId, userId } = session;
    const owner = this.owner();
    this.leaving.set(true);
    // stopped first, so no sync can pull after the removal commits and none reruns after this one
    this.sync.stop();
    // what is unsynced is gone once they are out, and the button is off while there is any
    await this.sync.syncNow();
    // not_a_member in that sync: already removed, and starting over has run
    if (this.session.session()?.householdId !== householdId) {
      this.leaving.set(false);
      return;
    }
    try {
      await this.api.removeMember(householdId, userId);
    } catch (err) {
      this.sync.start();
      this.leaving.set(false);
      this.actions.failed(err, SNACK);
      return;
    }
    const ref = this.snackBar.open(
      this.transloco.translate('snack.left', { owner }),
      this.transloco.translate('snack.undo'),
      SNACK,
    );
    ref.onAction().subscribe(() => {
      this.restore(householdId, userId).then(
        () => {
          this.sync.start();
          this.leaving.set(false);
        },
        async (err: unknown) => {
          // starting over closes open snackbars, so the failure is shown after it
          await this.startOver.run('left');
          this.actions.failed(err, SNACK);
        },
      );
    });
    // Undo dismisses it too
    ref.afterDismissed().subscribe(({ dismissedByAction }) => {
      if (!dismissedByAction) void this.startOver.run('left');
    });
  }
}
