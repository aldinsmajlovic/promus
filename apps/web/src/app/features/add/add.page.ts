import { Component, inject } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslocoDirective } from '@jsverse/transloco';
import { injectBack } from '../../core/back';
import { CurrentList } from '../../core/current-list';
import { AddOrFind } from './add-or-find';

@Component({
  selector: 'app-add-page',
  imports: [MatIconButton, MatIcon, TranslocoDirective, AddOrFind],
  templateUrl: './add.page.html',
  styleUrl: './add.page.scss',
})
export class AddPage {
  protected readonly list = inject(CurrentList).list;
  /** Back to the list the way it was opened, so Back from there doesn't reopen this view. */
  protected readonly close = injectBack();
}
