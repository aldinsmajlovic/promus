import { Component, inject } from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar, type MatSnackBarConfig } from '@angular/material/snack-bar';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { Actions } from '../../core/actions';
import { ApiClient } from '../../core/api';
import { injectBack } from '../../core/back';
import { Household } from '../../core/household';
import { ORIGIN } from '../../core/platform';
import { Face } from '../../shared/face';
import { InviteSheet, type InviteSheetData } from './invite-sheet';

// at the top: the invite sheet takes the bottom of the screen
const SNACK: MatSnackBarConfig = { duration: 5000, verticalPosition: 'top' };

/** Who shares this household's lists, and inviting someone new. Members are cached for offline. */
@Component({
  selector: 'app-household-page',
  imports: [MatButton, MatIconButton, MatIcon, TranslocoDirective, Face],
  templateUrl: './household.page.html',
  styleUrl: './household.page.scss',
})
export class HouseholdPage {
  private readonly api = inject(ApiClient);
  private readonly sheet = inject(MatBottomSheet);
  private readonly snackBar = inject(MatSnackBar);
  private readonly transloco = inject(TranslocoService);
  private readonly actions = inject(Actions);
  private readonly origin = inject(ORIGIN);
  private readonly household = inject(Household);
  protected readonly members = this.household.members;
  protected readonly you = this.household.you;
  protected readonly back = injectBack();

  constructor() {
    void this.household.refresh();
  }

  protected async invite(): Promise<void> {
    let invite: { id: string; token: string };
    try {
      invite = await this.api.createInvite();
    } catch (err) {
      this.actions.failed(err, SNACK);
      return;
    }
    const data: InviteSheetData = { url: `${this.origin}/join#${invite.token}` };
    const ref = this.sheet.open(InviteSheet, { data });
    const t = this.transloco;
    this.snackBar
      .open(t.translate('snack.inviteCreated'), t.translate('snack.undo'), SNACK)
      .onAction()
      .subscribe(() => {
        ref.dismiss();
        this.api.revokeInvite(invite.id).then(
          () => this.snackBar.open(t.translate('snack.inviteRevoked'), undefined, SNACK),
          (err: unknown) => this.actions.failed(err, SNACK),
        );
      });
  }
}
