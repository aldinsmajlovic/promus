import { Injectable, PendingTasks, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { listSummaries } from '@promus/shared';
import { Actions } from './actions';
import { PromusDb } from './db';
import { Store } from './store';

/** The list the screens show, kept in meta `currentListId`. */
@Injectable({ providedIn: 'root' })
export class CurrentList {
  private readonly store = inject(Store);
  private readonly db = inject(PromusDb);
  private readonly actions = inject(Actions);
  private readonly lang = toSignal(inject(TranslocoService).langChanges$, { requireSync: true });
  /** Sorts names the way the UI language does. */
  readonly collator = computed(() => new Intl.Collator(this.lang(), { numeric: true }));
  // undefined until read from meta
  private readonly savedId = signal<string | null | undefined>(undefined);
  readonly lists = computed(() => listSummaries(this.store.state(), this.collator()));
  /**
   * The saved list, or the first one when it is missing or deleted; null when there are no lists, and
   * undefined until both the saved id and the Store are loaded, so no other list's name shows first.
   */
  readonly list = computed(() => {
    const id = this.savedId();
    if (id === undefined || !this.store.ready()) return undefined;
    const lists = this.lists();
    return lists.find((l) => l.id === id) ?? lists[0] ?? null;
  });

  constructor() {
    inject(PendingTasks).run(async () => {
      const id = await this.db.getMeta('currentListId').catch((err: unknown) => {
        console.error('reading the current list failed', err);
        return null;
      });
      this.savedId.set(id ?? null);
    });
  }

  select(listId: string): void {
    this.savedId.set(listId);
    this.db.setMeta('currentListId', listId).catch((err: unknown) => this.actions.failed(err));
  }
}
