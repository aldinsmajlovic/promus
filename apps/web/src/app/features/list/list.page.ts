import {
  type AnimationCallbackEvent,
  Component,
  DOCUMENT,
  ElementRef,
  Injectable,
  Injector,
  PendingTasks,
  runInInjectionContext,
  type Signal,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatRipple } from '@angular/material/core';
import { MatDivider } from '@angular/material/divider';
import { MatIcon } from '@angular/material/icon';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { type EntryView, type Person, listView } from '@promus/shared';
import { Actions } from '../../core/actions';
import { CurrentList } from '../../core/current-list';
import { GUEST, PromusDb } from '../../core/db';
import { Household } from '../../core/household';
import { WIDE } from '../../core/layout';
import { formatPrice } from '../../core/price';
import { Shares } from '../../core/shares';
import { Store, type UndoToken } from '../../core/store';
import { Face } from '../../shared/face';
import { AddOrFind } from '../add/add-or-find';
import { type EditSheetData, openItemOptions } from './edit-sheet';
import { ListMenu } from './list-menu';
import { PeopleMenu } from './people-menu';
import { ProfileButton } from './profile-button';
import { RowGestures } from './row-gestures';

type Rows = Signal<readonly ElementRef<HTMLElement>[]>;

/**
 * Whether Done is open on this device, kept in meta `doneFolded`. Read once, so a list page coming back from
 * Add or find shows Done at once.
 */
@Injectable({ providedIn: 'root' })
class DoneFold {
  private readonly db = inject(PromusDb);
  private readonly actions = inject(Actions);
  // undefined until read from meta
  private readonly state = signal<boolean | undefined>(undefined);
  readonly open = this.state.asReadonly();

  constructor() {
    inject(PendingTasks).run(async () => {
      const folded = await this.db.getMeta('doneFolded').catch((err: unknown) => {
        console.error('reading doneFolded failed', err);
        return false;
      });
      this.state.set(!folded);
    });
  }

  toggle(): void {
    const open = !this.state();
    this.state.set(open);
    this.db.setMeta('doneFolded', !open).catch((err: unknown) => this.actions.failed(err));
  }
}

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
    PeopleMenu,
    Face,
    RowGestures,
    AddOrFind,
  ],
  templateUrl: './list.page.html',
  styleUrl: './list.page.scss',
})
export class ListPage {
  private readonly store = inject(Store);
  private readonly current = inject(CurrentList);
  private readonly fold = inject(DoneFold);
  private readonly actions = inject(Actions);
  private readonly injector = inject(Injector);
  private readonly doc = inject(DOCUMENT);
  private readonly household = inject(Household);
  private readonly shares = inject(Shares);
  private readonly lang = toSignal(inject(TranslocoService).langChanges$, { requireSync: true });
  /** A guest's list: no list menu, and Add or find in the link's own data. */
  protected readonly guest = inject(GUEST) !== null;
  protected readonly wide = inject(WIDE);
  protected readonly activeRows = viewChildren('activeRow', { read: ElementRef });
  protected readonly doneRows = viewChildren('doneRow', { read: ElementRef });
  private readonly doneToggle = viewChild('doneToggle', { read: ElementRef });
  private readonly dock = viewChild('dock', { read: ElementRef });
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  protected readonly list = this.current.list;
  protected readonly view = computed(() => {
    const list = this.list();
    if (!list) return { active: [], done: [] };
    return listView(this.store.state(), list.id, this.store.now(), this.current.collator());
  });
  /** Undefined until meta `doneFolded` is first read; then Done shows, open unless folded on this device. */
  protected readonly doneOpen = this.fold.open;
  protected readonly members = computed((): Person[] =>
    this.household.members().map((m) => ({ id: m.id, name: m.username, guest: false })),
  );
  /** The household, and the guests of the list's link; the template checks that it's still live. */
  protected readonly withGuests = computed((): Person[] => {
    const { shares, guests } = this.shares.data();
    const link = shares.find((s) => s.listId === this.list()?.id);
    const theirs = guests.filter((g) => g.shareId === link?.id);
    return [...this.members(), ...theirs.map((g) => ({ id: g.id, name: g.name, guest: true }))];
  });
  /**
   * Everyone on the list, and until when its link works: a guest's from the link, the household's from its links.
   * Checked on every render, not cached: a link runs out without anything in it changing.
   */
  protected people(listId: string): { people: Person[]; until: number | null } {
    const me = this.household.guestMe();
    if (this.guest) return { people: me?.people ?? [], until: me?.share.expiresAt ?? null };
    const link = this.shares.liveFor(listId);
    return { people: link ? this.withGuests() : this.members(), until: link?.expiresAt ?? null };
  }

  // the list the last render showed in full, Done included: rows arriving in it or leaving it move, a list that
  // loads or switches just shows. Angular runs the enter and leave animations after rendering, before this is
  // updated in the read phase. On a cold start Done waits on its meta read, so its first rows would arrive if this
  // were set before.
  private shown: string | undefined;

  constructor() {
    void this.household.refresh();
    void this.shares.refresh();
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

  /**
   * A swiped row slides on out from where the finger left it, since the gesture has already snapped it back;
   * it comes back if the removal fails.
   */
  protected async remove(listId: string, e: EntryView, index: number, rows: Rows, row: HTMLElement): Promise<void> {
    row.classList.add('swept');
    const removed = await this.move(this.store.remove(listId, e.itemId), rows, index);
    if (!removed) row.classList.remove('swept');
  }

  protected edit(listId: string, e: EntryView, row: HTMLElement): void {
    const { itemId, name, note, addedBy, quantity, price } = e;
    const data: EditSheetData = { listId, itemId, name, note, addedBy, quantity, price };
    runInInjectionContext(this.injector, () => openItemOptions(data, row));
  }

  /** A row's second line: its note, and what it costs. */
  protected noteLine(e: EntryView): string {
    const cost = e.price === null ? null : formatPrice(e.price * e.quantity, this.lang());
    return [e.note, cost].filter(Boolean).join(' · ');
  }

  protected toggleDone(): void {
    this.fold.toggle();
  }

  /** Who added an active row, when that was someone else: in the household, or a guest. */
  protected addedBy(e: EntryView): Person | undefined {
    return e.addedBy && e.addedBy !== this.household.you() ? this.household.person(e.addedBy) : undefined;
  }

  protected arriving(): string {
    return this.list()?.id === this.shown ? 'arrive' : '';
  }

  /**
   * A row checked off pops its circle, strikes its name and folds, inert meanwhile since its Done copy is already
   * there: hidden from screen readers, and its focus moves on. A swiped one stays until its slide out has finished;
   * any other just goes.
   */
  protected leave({ target, animationComplete }: AnimationCallbackEvent, e: EntryView): void {
    if (target.querySelector('.swept')) return this.afterAnimations(target, animationComplete);
    const checked = this.view().done.some((d) => d.itemId === e.itemId);
    if (!checked || this.list()?.id !== this.shown) return animationComplete();
    target.setAttribute('inert', '');
    target.classList.add('checked-off');
    this.afterAnimations(target, animationComplete);
  }

  /** A Done row goes at once, folding the section included, unless it was swiped: then it slides out. */
  protected leaveDone({ target, animationComplete }: AnimationCallbackEvent): void {
    if (target.querySelector('.swept')) this.afterAnimations(target, animationComplete);
    else animationComplete();
  }

  /** None are running under reduced motion. */
  private afterAnimations(target: Element, done: () => void): void {
    void Promise.allSettled(target.getAnimations({ subtree: true }).map((a) => a.finished)).then(done);
  }

  /**
   * The row leaves its section and takes focus with it: hand focus to the row now in its place, the
   * new last one, or the Done toggle or Add or find when the section is empty.
   */
  private async move(action: Promise<UndoToken | null>, rows: Rows, index: number): Promise<boolean> {
    // a checked-off row stays a moment to animate out, with focus still on it
    const row = rows()[index]?.nativeElement;
    if (!(await this.actions.run(action))) return false;
    afterNextRender(
      () => {
        // focus went somewhere else meanwhile, on purpose
        const focused = this.doc.activeElement;
        if (focused !== this.doc.body && focused !== row) return;
        const left = rows();
        const next = left[Math.min(index, left.length - 1)] ?? this.doneToggle() ?? this.dock();
        (next?.nativeElement ?? this.panel()?.nativeElement.querySelector('input'))?.focus();
      },
      { injector: this.injector },
    );
    return true;
  }
}
