import { DestroyRef, Injectable, Injector, inject, signal } from '@angular/core';
import {
  LIMITS,
  applyEvent,
  cleanName,
  emptyState,
  entryKey,
  eventInputSchema,
  fold,
  inverseOf,
  makeEvent,
  newId,
  normalizeName,
  resolveItemId,
} from '@promus/shared';
import type { Draft, EventInput, HouseholdState, ItemState } from '@promus/shared';
import { liveQuery } from 'dexie';
import { GUEST, PromusDb } from './db';
import { DexieSyncStorage } from './dexie-storage';
import { requestPersistence } from './persist';
import { SyncService } from './sync.service';

/**
 * `messageKey` and `params` make the snackbar text, e.g. `snack.checked` with `{ name }`. `householdId` is
 * the household the action changed: only its session can undo it.
 */
export type UndoToken = { messageKey: string; params: Record<string, string>; householdId: string; inverse: Draft[] };

/** No action without the session this state was loaded for: signed out, or another user signed in. */
export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

export class ValidationError extends Error {
  readonly code: 'name_empty' | 'name_too_long' | 'name_taken' | 'note_too_long' | 'already_on_list';

  constructor(code: ValidationError['code']) {
    super(code);
    this.name = 'ValidationError';
    this.code = code;
  }
}

// one action: its events (as drafts) and the snackbar text
type Plan = { messageKey: string; name: string; drafts: Draft[] };
// what the data looked like at the last load; a difference means another tab or a sync changed it
type Seen = { events: number; outbox: number; cursor: number; householdId: string | null };

const sameSeen = (a: Seen | null, b: Seen | null): boolean =>
  a !== null &&
  b !== null &&
  a.events === b.events &&
  a.outbox === b.outbox &&
  a.cursor === b.cursor &&
  a.householdId === b.householdId;

const checkName = (name: string): string => {
  const clean = cleanName(name);
  if (clean === '') throw new ValidationError('name_empty');
  // .length, like the schema's max
  if (clean.length > LIMITS.nameMax) throw new ValidationError('name_too_long');
  return clean;
};

const valid = (event: EventInput): EventInput => {
  const result = eventInputSchema.safeParse(event);
  if (result.success) return event;
  console.error('refusing to write an invalid event', event, result.error);
  throw result.error;
};

// guests never archive or unarchive: an archived name goes back on the list as it is, and undoing a new item takes it
// off the list and keeps it
const guestMay = (d: Draft): boolean => d.type !== 'item.archived' && d.type !== 'item.unarchived';

const one = (messageKey: string, name: string, draft: Draft): Plan => ({ messageKey, name, drafts: [draft] });

const entryPlan = (
  type: 'entry.checked' | 'entry.unchecked' | 'entry.removed',
  messageKey: string,
  listId: string,
  item: ItemState,
): Plan => one(messageKey, item.name, { type, payload: { listId, itemId: item.id } });

const itemOf = (s: HouseholdState, itemId: string): ItemState | undefined => s.items.get(resolveItemId(s, itemId));

const entryOf = (s: HouseholdState, listId: string, itemId: string) => {
  const item = itemOf(s, itemId);
  const entry = item && s.entries.get(entryKey(listId, item.id));
  return item && entry ? { item, entry } : null;
};

/**
 * The client's source of truth. Every action is an event written to the outbox first; `state` is the
 * fold of the session household's events. Actions and loads run one at a time, so an action always
 * applies to the state it was planned on.
 */
@Injectable({ providedIn: 'root' })
export class Store {
  private readonly db = inject(PromusDb);
  private readonly storage = inject(DexieSyncStorage);
  private readonly guest = inject(GUEST) !== null;
  // SyncService injects the Store, so it is looked up on first use
  private readonly injector = inject(Injector);
  // a guest's page can be left while a sheet closing over it still saves
  private readonly destroyRef = inject(DestroyRef);
  private readonly current = signal<HouseholdState>(emptyState(), { equal: () => false });
  private readonly pending = signal(0);
  readonly state = this.current.asReadonly();
  readonly pendingCount = this.pending.asReadonly();
  private readonly folded = signal(false);
  /** False until the first load has folded what IndexedDB holds, so an empty `state` means "not yet". */
  readonly ready = this.folded.asReadonly();

  private householdId: string | null = null;
  private serverOffset = 0;
  private loaded: Seen | null = null;
  private latest: Seen | null = null;
  private checkQueued = false;
  private queue: Promise<unknown> = Promise.resolve();
  private persistence: Promise<boolean> | null = null;

  constructor() {
    const db = this.db;
    const sub = liveQuery(async () => {
      const [events, outbox, cursor, session, pending] = await Promise.all([
        db.events.count(),
        db.outbox.count(),
        db.getMeta('cursor'),
        db.getMeta('session'),
        this.storage.pendingCount(),
      ]);
      const seen: Seen = { events, outbox, cursor: cursor ?? 0, householdId: session?.householdId ?? null };
      return { seen, pending };
    }).subscribe({
      next: ({ seen, pending }) => {
        this.pending.set(pending);
        this.changed(seen);
      },
      error: (err: unknown) => console.error('store query failed', err),
    });
    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }

  /** The clock that state times use: the device's clock corrected by the server offset. */
  now(): number {
    return Date.now() + this.serverOffset;
  }

  /** Re-folds everything from IndexedDB. */
  load(): Promise<void> {
    return this.serial(() => this.read());
  }

  /**
   * Throws ValidationError; resolves to null when the item is already on the list. An archived item of
   * that name comes back, with its history and last note, rather than a new one beside it. A guest can't bring it
   * back, so for them an archived item already on the list is `already_on_list`.
   */
  addByName(listId: string, name: string): Promise<UndoToken | null> {
    return this.act((s) => {
      const clean = checkName(name);
      const normalized = normalizeName(clean);
      const existing = s.byName.get(normalized)?.values().next().value;
      if (existing !== undefined) return this.readd(s, listId, existing);
      // byName holds live items only
      const archived = [...s.items.values()].find((i) => i.archived && i.normalized === normalized);
      if (archived) {
        const readd = this.readd(s, listId, archived.id)?.drafts ?? [];
        // a guest never unarchives, so on the list already there is nothing left to do
        if (this.guest && !readd.length) throw new ValidationError('already_on_list');
        const unarchive: Draft = { type: 'item.unarchived', payload: { itemId: archived.id } };
        return { messageKey: 'snack.added', name: archived.name, drafts: [unarchive, ...readd] };
      }
      const itemId = newId();
      return {
        messageKey: 'snack.added',
        name: clean,
        drafts: [
          { type: 'item.created', payload: { itemId, name: clean } },
          { type: 'entry.added', payload: { listId, itemId } },
        ],
      };
    });
  }

  addItem(listId: string, itemId: string): Promise<UndoToken | null> {
    return this.act((s) => this.readd(s, listId, itemId));
  }

  check(listId: string, itemId: string): Promise<UndoToken | null> {
    return this.act((s) => {
      const found = entryOf(s, listId, itemId);
      return found?.entry.state === 'active' ? entryPlan('entry.checked', 'snack.checked', listId, found.item) : null;
    });
  }

  uncheck(listId: string, itemId: string): Promise<UndoToken | null> {
    return this.act((s) => {
      const found = entryOf(s, listId, itemId);
      const checked = found?.entry.state === 'checked';
      return checked ? entryPlan('entry.unchecked', 'snack.unchecked', listId, found.item) : null;
    });
  }

  remove(listId: string, itemId: string): Promise<UndoToken | null> {
    return this.act((s) => {
      const found = entryOf(s, listId, itemId);
      return found ? entryPlan('entry.removed', 'snack.removed', listId, found.item) : null;
    });
  }

  setNote(listId: string, itemId: string, note: string): Promise<UndoToken | null> {
    return this.act((s) => {
      const text = note.trim();
      if (text.length > LIMITS.noteMax) throw new ValidationError('note_too_long');
      const found = entryOf(s, listId, itemId);
      if (!found || (text || null) === found.entry.note) return null;
      const payload = { listId, itemId: found.item.id, note: text };
      return one('snack.noteSet', found.item.name, { type: 'entry.noteSet', payload });
    });
  }

  /** Throws ValidationError, `name_taken` too when another live item has that name in any case. */
  renameItem(itemId: string, name: string): Promise<UndoToken | null> {
    return this.act((s) => {
      const clean = checkName(name);
      const item = itemOf(s, itemId);
      if (!item || item.name === clean) return null;
      const named = s.byName.get(normalizeName(clean)) ?? [];
      if ([...named].some((id) => resolveItemId(s, id) !== item.id)) throw new ValidationError('name_taken');
      return one('snack.renamed', clean, { type: 'item.renamed', payload: { itemId: item.id, name: clean } });
    });
  }

  archiveItem(itemId: string): Promise<UndoToken | null> {
    return this.act((s) => {
      const item = itemOf(s, itemId);
      if (!item || item.archived) return null;
      return one('snack.archived', item.name, { type: 'item.archived', payload: { itemId: item.id } });
    });
  }

  /** Also resolves to the new list's id, so the UI can switch to it. */
  createList(name: string): Promise<UndoToken & { listId: string }> {
    return this.serial(async () => {
      const clean = checkName(name);
      const listId = newId();
      const plan = one('snack.listCreated', clean, { type: 'list.created', payload: { listId, name: clean } });
      return { ...(await this.run(plan)), listId };
    });
  }

  renameList(listId: string, name: string): Promise<UndoToken | null> {
    return this.act((s) => {
      const clean = checkName(name);
      const list = s.lists.get(listId);
      if (!list || list.deleted || list.name === clean) return null;
      return one('snack.listRenamed', clean, { type: 'list.renamed', payload: { listId, name: clean } });
    });
  }

  deleteList(listId: string): Promise<UndoToken | null> {
    return this.act((s) => {
      const list = s.lists.get(listId);
      if (!list || list.deleted) return null;
      return one('snack.listDeleted', list.name, { type: 'list.deleted', payload: { listId } });
    });
  }

  /** Throws SessionError when the signed-in household is not the token's. */
  undo(token: UndoToken): Promise<void> {
    return this.serial(async () => {
      if (token.householdId !== this.householdId) throw new SessionError('the undo is for another household');
      if (token.inverse.length > 0) await this.commit(token.inverse);
    });
  }

  private readd(s: HouseholdState, listId: string, itemId: string): Plan | null {
    const item = itemOf(s, itemId);
    if (!item || s.entries.get(entryKey(listId, item.id))?.state === 'active') return null;
    const payload = { listId, itemId: item.id, ...(item.lastNote ? { note: item.lastNote } : {}) };
    return one('snack.added', item.name, { type: 'entry.added', payload });
  }

  /** A guest's plan goes without its archives and unarchives, and one with nothing left changes nothing. */
  private act(plan: (s: HouseholdState) => Plan | null): Promise<UndoToken | null> {
    return this.serial(async () => {
      const p = plan(this.current());
      if (p && this.guest) p.drafts = p.drafts.filter(guestMay);
      return p?.drafts.length ? this.run(p) : null;
    });
  }

  private async run({ messageKey, name, drafts }: Plan): Promise<UndoToken> {
    const householdId = this.householdId;
    if (householdId === null) throw new SessionError('not signed in');
    return { messageKey, params: { name }, householdId, inverse: await this.commit(drafts) };
  }

  /**
   * Writes the drafts as events, then applies them; resolves to the drafts that undo them. A guest's archives and
   * unarchives are left out, also from an undo.
   */
  private async commit(all: Draft[]): Promise<Draft[]> {
    const drafts = this.guest ? all.filter(guestMay) : all;
    const householdId = this.householdId;
    if (householdId === null) throw new SessionError('not signed in');
    const db = this.db;
    const events = await db.transaction('rw', db.outbox, db.meta, async () => {
      // the state these drafts were planned on must still be the signed-in household's
      if ((await db.getMeta('session'))?.householdId !== householdId) throw new SessionError('the session changed');
      const clock = await this.storage.clock();
      const occurredAt = Date.now();
      const written = drafts.map(({ type, payload, undoOf }) =>
        valid(makeEvent(type, payload, { householdId, hlc: clock.next(), occurredAt, ...(undoOf ? { undoOf } : {}) })),
      );
      await this.storage.append(written);
      await clock.save();
      return written;
    });
    // new local events sort after everything folded so far (the hlc guarantees it), so applying them
    // in place equals a fresh fold
    const state = this.current();
    const inverse: Draft[] = [];
    for (const e of events) {
      inverse.unshift(...inverseOf(e, state));
      applyEvent(state, e);
    }
    this.current.set(state);
    this.pending.update((n) => n + events.length);
    if (this.loaded) this.loaded = { ...this.loaded, outbox: this.loaded.outbox + events.length };
    // a guest's page left meanwhile closed its database and its sync: the next page's send the outbox
    if (this.destroyRef.destroyed) return inverse;
    this.persistence ??= requestPersistence(db).catch((err: unknown) => {
      console.error('persistent storage request failed', err);
      return false;
    });
    this.injector.get(SyncService).soon();
    return inverse;
  }

  private changed(seen: Seen): void {
    this.latest = seen;
    if (this.checkQueued) return;
    this.checkQueued = true;
    this.serial(async () => {
      this.checkQueued = false;
      // ponytail: changes are seen through counts, cursor and household. Another tab's restamp keeps all
      // four equal and shows at the next load; a change counter in `meta` would catch it.
      if (!sameSeen(this.latest, this.loaded)) await this.read();
    }).catch((err: unknown) => {
      // a guest's page left mid-reload closed its database on purpose: nothing is shown to reload
      if (!this.destroyRef.destroyed) console.error('store reload failed', err);
    });
  }

  private async read(): Promise<void> {
    const db = this.db;
    const [events, outbox, cursor, session, offset] = await db.transaction('r', db.events, db.outbox, db.meta, () =>
      Promise.all([
        db.events.toArray(),
        db.outbox.toArray(),
        db.getMeta('cursor'),
        db.getMeta('session'),
        db.getMeta('serverOffset'),
      ]),
    );
    await this.storage.seed([...events, ...outbox]);
    const householdId = session?.householdId ?? null;
    const mine = [...events, ...outbox.map((r) => r.event)].filter((e) => e.householdId === householdId);
    this.current.set(fold(mine));
    this.pending.set(outbox.filter((r) => r.pushed === 0).length);
    this.householdId = householdId;
    this.serverOffset = offset ?? 0;
    this.loaded = { events: events.length, outbox: outbox.length, cursor: cursor ?? 0, householdId };
    this.folded.set(true);
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    // the caller gets run's outcome; the queue only needs to know it settled
    this.queue = run.catch(() => undefined);
    return run;
  }
}
