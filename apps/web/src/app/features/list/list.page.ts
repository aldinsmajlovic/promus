import {
  type AnimationCallbackEvent,
  Component,
  DOCUMENT,
  ElementRef,
  Injector,
  PendingTasks,
  type Signal,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatIconButton } from '@angular/material/button';
import { MatRipple } from '@angular/material/core';
import { MatDivider } from '@angular/material/divider';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { type EntryView, type Member, listView } from '@promus/shared';
import { Actions } from '../../core/actions';
import { CurrentList } from '../../core/current-list';
import { PromusDb } from '../../core/db';
import { Household } from '../../core/household';
import { Store, type UndoToken } from '../../core/store';
import { Face } from '../../shared/face';
import { EditSheet, type EditSheetData } from './edit-sheet';
import { ListMenu } from './list-menu';
import { ProfileButton } from './profile-button';

type Rows = Signal<readonly ElementRef<HTMLElement>[]>;

@Component({
  selector: 'app-list-page',
  imports: [
    MatIconButton,
    MatIcon,
    MatDivider,
    MatRipple,
    RouterLink,
    TranslocoDirective,
    ProfileButton,
    ListMenu,
    Face,
  ],
  templateUrl: './list.page.html',
  styleUrl: './list.page.scss',
})
export class ListPage {
  private readonly store = inject(Store);
  private readonly current = inject(CurrentList);
  private readonly db = inject(PromusDb);
  private readonly sheet = inject(MatBottomSheet);
  private readonly actions = inject(Actions);
  private readonly injector = inject(Injector);
  private readonly doc = inject(DOCUMENT);
  private readonly lang = toSignal(inject(TranslocoService).langChanges$, { requireSync: true });
  protected readonly household = inject(Household);
  private readonly activeRows = viewChildren('activeRow', { read: ElementRef });
  private readonly doneRows = viewChildren('doneRow', { read: ElementRef });
  private readonly doneToggle = viewChild('doneToggle', { read: ElementRef });
  private readonly dock = viewChild('dock', { read: ElementRef });

  protected readonly list = this.current.list;
  protected readonly view = computed(() => {
    const list = this.list();
    if (!list) return { active: [], done: [] };
    return listView(this.store.state(), list.id, this.store.now(), this.current.collator());
  });
  /** Undefined until meta `doneFolded` is read; then Done shows, open unless folded on this device. */
  protected readonly doneOpen = signal<boolean | undefined>(undefined);
  protected readonly sharedWith = computed(() =>
    new Intl.ListFormat(this.lang(), { type: 'conjunction' }).format(this.household.others().map((m) => m.username)),
  );
  // the list the last render showed in full, Done included: rows arriving in it or leaving it move, a list that
  // loads or switches just shows. Angular runs the enter and leave animations after rendering, before this is
  // updated in the read phase. Done waits on its own meta read, so its first rows would arrive if this were set before.
  private shown: string | undefined;

  constructor() {
    void this.household.refresh();
    inject(PendingTasks).run(async () => {
      const folded = await this.db.getMeta('doneFolded').catch((err: unknown) => {
        console.error('reading doneFolded failed', err);
        return false;
      });
      this.doneOpen.set(!folded);
    });
    afterRenderEffect({
      read: () => {
        this.shown = this.doneOpen() === undefined ? undefined : this.list()?.id;
      },
    });
  }

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

  protected toggleDone(): void {
    const open = !this.doneOpen();
    this.doneOpen.set(open);
    this.db.setMeta('doneFolded', !open).catch((err: unknown) => this.actions.failed(err));
  }

  /** Who added an active row, when that was someone else in the household. */
  protected addedBy(e: EntryView): Member | undefined {
    return e.addedBy && e.addedBy !== this.household.you() ? this.household.byId().get(e.addedBy) : undefined;
  }

  protected arriving(): string {
    return this.list()?.id === this.shown ? 'arrive' : '';
  }

  /**
   * A row checked off pops its circle, strikes its name and folds, hidden from screen readers meanwhile since
   * its Done copy is already there; a removed one just goes.
   */
  protected leave({ target, animationComplete }: AnimationCallbackEvent, e: EntryView): void {
    const checked = this.view().done.some((d) => d.itemId === e.itemId);
    if (!checked || this.list()?.id !== this.shown) return animationComplete();
    target.setAttribute('aria-hidden', 'true');
    target.classList.add('checked-off');
    // none under reduced motion
    void Promise.allSettled(target.getAnimations().map((a) => a.finished)).then(animationComplete);
  }

  /**
   * The row leaves its section and takes focus with it: hand focus to the row now in its place, the
   * new last one, or the Done toggle or Add or find when the section is empty.
   */
  private async move(action: Promise<UndoToken | null>, rows: Rows, index: number): Promise<void> {
    // a checked-off row stays a moment to animate out, with focus still on it
    const row = rows()[index]?.nativeElement;
    if (!(await this.actions.run(action))) return;
    afterNextRender(
      () => {
        // focus went somewhere else meanwhile, on purpose
        const focused = this.doc.activeElement;
        if (focused !== this.doc.body && focused !== row) return;
        const left = rows();
        const next = left[Math.min(index, left.length - 1)] ?? this.doneToggle() ?? this.dock();
        next?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }
}
