import { Component, inject } from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslocoDirective } from '@jsverse/transloco';
import { injectBack } from '../../core/back';
import { Household } from '../../core/household';
import { Face } from '../../shared/face';
import { injectInvite } from './invite-sheet';

/** Who shares this household's lists, and inviting someone new. Members are cached for offline. */
@Component({
  selector: 'app-household-page',
  imports: [MatButton, MatIconButton, MatIcon, TranslocoDirective, Face],
  templateUrl: './household.page.html',
  styleUrl: './household.page.scss',
})
export class HouseholdPage {
  private readonly household = inject(Household);
  protected readonly members = this.household.members;
  protected readonly you = this.household.you;
  protected readonly back = injectBack();
  protected readonly invite = injectInvite();

  constructor() {
    void this.household.refresh();
  }
}
