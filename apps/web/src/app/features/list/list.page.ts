import { Component, PendingTasks, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatFabAnchor, MatIconButton } from '@angular/material/button';
import { MatRipple } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatDivider } from '@angular/material/divider';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatToolbar } from '@angular/material/toolbar';
import { RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { type EntryView, listSummaries, listView } from '@promus/shared';
import { Actions } from '../../core/actions';
import { PromusDb } from '../../core/db';
import { Store } from '../../core/store';
import { EditSheet, type EditSheetData } from './edit-sheet';
import { NameDialog, type NameDialogData } from './name-dialog';
import { SyncIndicator } from './sync-indicator';

type List = { id: string; name: string };

@Component({
  selector: 'app-list-page',
  imports: [
    MatToolbar,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MatIconButton,
    MatFabAnchor,
    MatIcon,
    MatDivider,
    MatRipple,
    RouterLink,
    TranslocoDirective,
    SyncIndicator,
  ],
  templateUrl: './list.page.html',
  styleUrl: './list.page.scss',
})
export class ListPage {
  private readonly store = inject(Store);
  private readonly db = inject(PromusDb);
  private readonly sheet = inject(MatBottomSheet);
  private readonly dialog = inject(MatDialog);
  private readonly actions = inject(Actions);

  private readonly lang = toSignal(inject(TranslocoService).langChanges$, { requireSync: true });
  private readonly collator = computed(() => new Intl.Collator(this.lang(), { numeric: true }));
  // undefined until read from meta, so the first render already shows the right list
  private readonly savedId = signal<string | null | undefined>(undefined);
  protected readonly lists = computed(() => listSummaries(this.store.state(), this.collator()));
  /** The saved list, or the first one when it is missing or deleted. */
  protected readonly list = computed(() => {
    const id = this.savedId();
    const lists = this.lists();
    return id === undefined ? null : (lists.find((l) => l.id === id) ?? lists[0] ?? null);
  });
  protected readonly view = computed(() => {
    const list = this.list();
    return list ? listView(this.store.state(), list.id, this.store.now(), this.collator()) : { active: [], done: [] };
  });
  protected readonly doneOpen = signal(false);
  protected readonly switcherOpen = signal(false);

  constructor() {
    inject(PendingTasks).run(async () => {
      const id = await this.db.getMeta('currentListId').catch((err: unknown) => {
        console.error('reading the current list failed', err);
        return null;
      });
      this.savedId.set(id ?? null);
    });
  }

  protected select(listId: string): void {
    this.savedId.set(listId);
    this.db.setMeta('currentListId', listId).catch((err: unknown) => this.actions.failed(err));
  }

  protected check(listId: string, e: EntryView): void {
    void this.actions.run(this.store.check(listId, e.itemId));
  }

  protected uncheck(listId: string, e: EntryView): void {
    void this.actions.run(this.store.uncheck(listId, e.itemId));
  }

  protected edit(listId: string, e: EntryView): void {
    const data: EditSheetData = { listId, itemId: e.itemId, name: e.name, note: e.note };
    // it closes itself after saving, so a refused value keeps it open; no keyboard until a field is tapped
    this.sheet.open(EditSheet, { data, ariaLabel: e.name, disableClose: true, autoFocus: 'dialog' });
  }

  protected newList(): void {
    this.askName('list.new', '', async (name) => {
      const created = await this.actions.run(this.store.createList(name));
      if (created) this.select(created.listId);
    });
  }

  protected renameList(list: List): void {
    this.askName('list.rename', list.name, (name) => this.actions.run(this.store.renameList(list.id, name)));
  }

  protected deleteList(list: List): void {
    void this.actions.run(this.store.deleteList(list.id));
  }

  private askName(title: string, name: string, save: NameDialogData['save']): void {
    const data: NameDialogData = { title, name, save };
    this.dialog.open(NameDialog, { data, width: '20rem' });
  }
}
