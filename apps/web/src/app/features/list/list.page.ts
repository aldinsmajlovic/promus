import {
  Component,
  DOCUMENT,
  ElementRef,
  Injector,
  type Signal,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatFabAnchor, MatIconButton } from '@angular/material/button';
import { MatRipple } from '@angular/material/core';
import { MatDivider } from '@angular/material/divider';
import { MatIcon } from '@angular/material/icon';
import { MatToolbar } from '@angular/material/toolbar';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { type EntryView, listView } from '@promus/shared';
import { Actions } from '../../core/actions';
import { CurrentList } from '../../core/current-list';
import { Store, type UndoToken } from '../../core/store';
import { EditSheet, type EditSheetData } from './edit-sheet';
import { ListMenu } from './list-menu';
import { ProfileButton } from './profile-button';

type Rows = Signal<readonly ElementRef<HTMLElement>[]>;

@Component({
  selector: 'app-list-page',
  imports: [
    MatToolbar,
    MatIconButton,
    MatFabAnchor,
    MatIcon,
    MatDivider,
    MatRipple,
    RouterLink,
    TranslocoDirective,
    ProfileButton,
    ListMenu,
  ],
  templateUrl: './list.page.html',
  styleUrl: './list.page.scss',
})
export class ListPage {
  private readonly store = inject(Store);
  private readonly current = inject(CurrentList);
  private readonly sheet = inject(MatBottomSheet);
  private readonly actions = inject(Actions);
  private readonly injector = inject(Injector);
  private readonly doc = inject(DOCUMENT);
  private readonly activeRows = viewChildren('activeRow', { read: ElementRef });
  private readonly doneRows = viewChildren('doneRow', { read: ElementRef });
  private readonly doneToggle = viewChild('doneToggle', { read: ElementRef });
  private readonly fab = viewChild('fab', { read: ElementRef });

  protected readonly list = this.current.list;
  protected readonly view = computed(() => {
    const list = this.list();
    if (!list) return { active: [], done: [] };
    return listView(this.store.state(), list.id, this.store.now(), this.current.collator());
  });
  protected readonly doneOpen = signal(false);

  protected check(listId: string, e: EntryView, index: number): void {
    void this.move(this.store.check(listId, e.itemId), this.activeRows, index);
  }

  protected uncheck(listId: string, e: EntryView, index: number): void {
    void this.move(this.store.uncheck(listId, e.itemId), this.doneRows, index);
  }

  protected edit(listId: string, e: EntryView): void {
    const data: EditSheetData = { listId, itemId: e.itemId, name: e.name, note: e.note };
    // it closes itself after saving, so a refused value keeps it open; no keyboard until a field is tapped
    this.sheet.open(EditSheet, { data, ariaLabel: e.name, disableClose: true, autoFocus: 'dialog' });
  }

  /**
   * The row leaves its section and takes focus with it: hand focus to the row now in its place, the
   * new last one, or the Done toggle or FAB when the section is empty.
   */
  private async move(action: Promise<UndoToken | null>, rows: Rows, index: number): Promise<void> {
    if (!(await this.actions.run(action))) return;
    afterNextRender(
      () => {
        // focus went somewhere else meanwhile, on purpose
        if (this.doc.activeElement !== this.doc.body) return;
        const left = rows();
        const next = left[Math.min(index, left.length - 1)] ?? this.doneToggle() ?? this.fab();
        next?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }
}
