import { Location } from '@angular/common';
import { Component, ElementRef, afterNextRender, computed, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatError, MatFormField, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import {
  MatActionList,
  MatListItem,
  MatListItemIcon,
  MatListItemLine,
  MatListItemMeta,
  MatListItemTitle,
} from '@angular/material/list';
import type { MatSnackBarConfig } from '@angular/material/snack-bar';
import { MatToolbar } from '@angular/material/toolbar';
import { Router } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { cleanName, frequentItems, normalizeName } from '@promus/shared';
import { Actions, refuse } from '../../core/actions';
import { CurrentList } from '../../core/current-list';
import { Store, ValidationError } from '../../core/store';
import { type SearchResult, resultOf, searchItems, segments } from './search';

// at the bottom it would sit on the field; `below-toolbar` keeps Close uncovered
const SNACK: MatSnackBarConfig = { verticalPosition: 'top', panelClass: 'below-toolbar' };
const FLASH_MS = 600;

@Component({
  selector: 'app-add-page',
  imports: [
    ReactiveFormsModule,
    MatToolbar,
    MatIconButton,
    MatIcon,
    MatActionList,
    MatListItem,
    MatListItemIcon,
    MatListItemTitle,
    MatListItemLine,
    MatListItemMeta,
    MatFormField,
    MatInput,
    MatSuffix,
    MatError,
    TranslocoDirective,
  ],
  templateUrl: './add.page.html',
  styleUrl: './add.page.scss',
})
export class AddPage {
  private readonly store = inject(Store);
  private readonly actions = inject(Actions);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');
  protected readonly list = inject(CurrentList).list;
  private readonly listId = computed(() => this.list()?.id);
  protected readonly query = new FormControl('', { nonNullable: true });
  protected readonly text = toSignal(this.query.valueChanges, { initialValue: '' });
  /** The row just added and the text it was found with: the field clears, the rows stay a moment. */
  protected readonly flash = signal<{ itemId: string; text: string } | null>(null);
  private readonly needle = computed(() => this.text() || (this.flash()?.text ?? ''));
  // as the view opened: an added one keeps its place, with a check, so the next tap hits what it aims at
  private readonly usual = computed(() => {
    const listId = this.listId();
    if (!listId) return [];
    return untracked(() => frequentItems(this.store.state(), listId, this.store.now()).map((i) => i.id));
  });
  protected readonly view = computed(() => {
    const listId = this.listId();
    if (!listId) return { rows: [], create: null };
    const state = this.store.state();
    const text = this.needle();
    let results: SearchResult[];
    let create: string | null = null;
    if (normalizeName(text) === '') {
      results = this.usual().flatMap((id) => {
        const item = state.items.get(id);
        return item && !item.archived ? [resultOf(state, item, listId)] : [];
      });
    } else {
      const found = searchItems(state, text, listId, this.store.now());
      results = found.results;
      if (!found.exact && this.text()) create = cleanName(text);
    }
    return { rows: results.map((r) => ({ ...r, segments: segments(r.name, r.ranges) })), create };
  });

  constructor() {
    afterNextRender(() => this.input().nativeElement.focus());
  }

  protected async add(r: SearchResult): Promise<void> {
    const listId = this.listId();
    if (!listId || r.onList) return;
    const text = this.needle();
    if (!(await this.actions.run(this.store.addItem(listId, r.itemId), SNACK))) return;
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
    } else if (exact.onList) {
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

  /** Back to the list the way it was opened, so Back from there doesn't reopen this view. */
  protected close(): void {
    if (this.router.lastSuccessfulNavigation()?.previousNavigation) this.location.back();
    else void this.router.navigateByUrl('/', { replaceUrl: true });
  }
}
