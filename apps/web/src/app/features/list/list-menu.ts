import { Component, Injector, afterNextRender, effect, inject, signal, viewChild } from '@angular/core';
import type { ElementRef } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatRipple } from '@angular/material/core';
import { MatDivider } from '@angular/material/divider';
import { MatError, MatFormField } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { TranslocoDirective } from '@jsverse/transloco';
import { Actions, refuse } from '../../core/actions';
import { CurrentList } from '../../core/current-list';
import { Shares } from '../../core/shares';
import { Store, ValidationError } from '../../core/store';
import { RowGestures } from './row-gestures';

type ListSummary = ReturnType<CurrentList['lists']>[number];
type Mode =
  { kind: 'lists' } | { kind: 'new' } | { kind: 'actions'; list: ListSummary } | { kind: 'rename'; list: ListSummary };

/** The list name in the toolbar, a menu for switching lists; New list, Rename and Delete are in it too. */
@Component({
  selector: 'app-list-menu',
  imports: [
    ReactiveFormsModule,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MatDivider,
    MatIcon,
    MatRipple,
    MatFormField,
    MatInput,
    MatError,
    TranslocoDirective,
    RowGestures,
  ],
  templateUrl: './list-menu.html',
  styleUrl: './list-menu.scss',
})
export class ListMenu {
  private readonly store = inject(Store);
  private readonly actions = inject(Actions);
  protected readonly current = inject(CurrentList);
  protected readonly shares = inject(Shares);
  private readonly injector = inject(Injector);
  private readonly menu = viewChild.required(MatMenu);
  private readonly trigger = viewChild.required(MatMenuTrigger);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  protected readonly mode = signal<Mode>({ kind: 'lists' });
  protected readonly name = new FormControl('', { nonNullable: true });
  // a second Enter must not create a second list
  private saving = false;

  constructor() {
    effect(() => {
      const field = this.field()?.nativeElement;
      field?.focus();
      field?.select();
    });
  }

  protected open(mode: Mode): void {
    this.name.reset(mode.kind === 'rename' ? mode.list.name : '');
    this.mode.set(mode);
    // the pressed item is gone, and focus with it
    if (mode.kind === 'actions')
      afterNextRender(() => this.menu().focusFirstItem('keyboard'), { injector: this.injector });
  }

  /** Material's menu closes on any key it handles and any click: a field must keep both. */
  protected key(event: KeyboardEvent): void {
    if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
    if (event.key === 'Enter') void this.submit();
  }

  protected delete(list: ListSummary): void {
    void this.actions.run(this.store.deleteList(list.id));
  }

  private async submit(): Promise<void> {
    const mode = this.mode();
    if (this.saving || (mode.kind !== 'new' && mode.kind !== 'rename')) return;
    this.saving = true;
    try {
      if (mode.kind === 'new') {
        const created = await this.actions.run(this.store.createList(this.name.value));
        if (created) this.current.select(created.listId);
      } else {
        await this.actions.run(this.store.renameList(mode.list.id, this.name.value));
      }
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      refuse(this.name, err);
      return;
    } finally {
      this.saving = false;
    }
    this.trigger().closeMenu();
  }
}
