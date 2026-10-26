import { Component, ElementRef, afterNextRender, computed, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import type { MatSnackBarConfig } from '@angular/material/snack-bar';
import { TranslocoDirective } from '@jsverse/transloco';
import { cleanName, frequentItems, normalizeName } from '@promus/shared';
import { Actions, refuse } from '../../core/actions';
import { CurrentList } from '../../core/current-list';
import { Store, ValidationError } from '../../core/store';
import { type SearchResult, resultOf, searchItems, segments } from './search';

// at the bottom it would sit on the field; `in-toolbar` keeps it off the rows and Close uncovered
export const SNACK: MatSnackBarConfig = { verticalPosition: 'top', panelClass: 'in-toolbar' };
const FLASH_MS = 600;

/** Adds items and finds the ones already on the list, which check off and back right here. */
@Component({
  selector: 'app-add-or-find',
  imports: [ReactiveFormsModule, MatIconButton, MatIcon, TranslocoDirective],
  templateUrl: './add-or-find.html',
  styleUrl: './add-or-find.scss',
})
export class AddOrFind {
  private readonly store = inject(Store);
  private readonly actions = inject(Actions);
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');
  private readonly list = inject(CurrentList).list;
  private readonly listId = computed(() => this.list()?.id);
  protected readonly query = new FormControl('', { nonNullable: true });
  protected readonly text = toSignal(this.query.valueChanges, { initialValue: '' });
  /** The row just added and the text it was found with: the field clears, the rows stay a moment. */
  protected readonly flash = signal<{ itemId: string; text: string } | null>(null);
  /** Added in this visit: while still on the list these rows say so and are inert, so a double tap can't add an item and check it off. */
  protected readonly added = signal<ReadonlySet<string>>(new Set());
  /** Adds that haven't settled: a second tap meanwhile does nothing. */
  private readonly adding = new Set<string>();
  private readonly needle = computed(() => this.text() || (this.flash()?.text ?? ''));
  // as the view opened: an added one keeps its place, so the next tap hits what it aims at
  private readonly usual = computed(() => {
    const listId = this.listId();
    if (!listId) return [];
    return untracked(() => frequentItems(this.store.state(), listId, this.store.now()).map((i) => i.id));
  });
  protected readonly view = computed(() => {
    const listId = this.listId();
    if (!listId) return { rows: [], create: null };
    const state = this.store.state();
    const now = this.store.now();
    const text = this.needle();
    let results: SearchResult[];
    let create: string | null = null;
    if (normalizeName(text) === '') {
      results = this.usual().flatMap((id) => {
        const item = state.items.get(id);
        return item && !item.archived ? [resultOf(state, item, listId, now)] : [];
      });
    } else {
      const found = searchItems(state, text, listId, now);
      results = found.results;
      if (!found.exact && this.text()) create = cleanName(text);
    }
    const added = this.added();
    return {
      rows: results.map((r) => ({ ...r, segments: segments(r.name, r.ranges), added: added.has(r.itemId) && r.state !== 'none' })),
      create,
    };
  });

  constructor() {
    afterNextRender(() => this.input().nativeElement.focus());
  }

  protected async tap(r: SearchResult): Promise<void> {
    const listId = this.listId();
    if (!listId || (r.state !== 'none' && this.added().has(r.itemId))) return;
    if (r.state === 'none') await this.add(r);
    else if (r.state === 'active') await this.actions.run(this.store.check(listId, r.itemId), SNACK);
    else await this.actions.run(this.store.uncheck(listId, r.itemId), SNACK);
  }

  private async add(r: SearchResult): Promise<void> {
    const listId = this.listId();
    if (!listId || this.adding.has(r.itemId)) return;
    // before the first await, so a second tap before the add resolves does nothing
    this.adding.add(r.itemId);
    this.added.update((a) => new Set(a).add(r.itemId));
    const text = this.needle();
    let token;
    try {
      token = await this.actions.run(this.store.addItem(listId, r.itemId), SNACK);
    } finally {
      this.adding.delete(r.itemId);
      // a failed add leaves nothing marked
      if (!token) this.added.update((a) => new Set([...a].filter((id) => id !== r.itemId)));
    }
    if (!token) return;
    this.cleared();
    const flash = { itemId: r.itemId, text };
    this.flash.set(flash);
    setTimeout(() => this.flash.update((f) => (f === flash ? null : f)), FLASH_MS);
  }

  /** Re-adds an exact match and creates anything else: a fuzzy match is only ever added by tapping it. */
  protected enter(): void {
    const listId = this.listId();
    if (!listId) return;
    const { exact } = searchItems(this.store.state(), this.query.value, listId, this.store.now());
    if (!exact) {
      void this.create();
    } else if (exact.state === 'active') {
      // the shape refuse() sets
      this.query.setErrors({ refused: { key: 'add.alreadyOnList', params: {} } });
      this.query.markAsTouched();
    } else {
      void this.add(exact);
    }
  }

  protected async create(): Promise<void> {
    const listId = this.listId();
    if (!listId) return;
    try {
      if (await this.actions.run(this.store.addByName(listId, this.query.value), SNACK)) this.cleared();
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      refuse(this.query, err);
    }
  }

  protected cleared(): void {
    this.query.setValue('');
    this.input().nativeElement.focus();
  }
}
