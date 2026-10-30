import { DOCUMENT, DestroyRef, Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { ApiError, AuthError, NetworkError, type SyncApi, syncOnce } from '@promus/shared';
import { ApiClient } from './api';
import { PromusDb } from './db';
import { DexieSyncStorage, StaleSyncError } from './dexie-storage';
import { Store } from './store';

export type SyncStatus = {
  kind: 'idle' | 'syncing' | 'offline' | 'error' | 'auth';
  pending: number;
  rejected: number;
  messageKey?: string;
};

type Outcome = Pick<SyncStatus, 'kind' | 'messageKey'>;

/** Where push and pull go: the household's endpoints, or a guest's link. */
export const SYNC_API = new InjectionToken<SyncApi>('SYNC_API', {
  factory: (): SyncApi => {
    const api = inject(ApiClient);
    const db = inject(PromusDb);
    // the session is read at each call: it can change between runs
    return {
      push: (events) => api.push(events),
      pull: async (after, limit) => api.pull(after, limit, (await db.getMeta('session'))?.householdId),
    };
  },
});

/**
 * In place of the `auth` status: called with the server's 401 once the run is done with the database, and what it
 * throws becomes the status.
 */
export const SYNC_AUTH_FAILED = new InjectionToken<(err: AuthError) => Promise<void>>('SYNC_AUTH_FAILED');

/**
 * Called once a run is done with the database when the server says the user is no longer in the household; the next
 * sync runs after it. Without it, that answer is an error like any other.
 */
export const SYNC_REMOVED = new InjectionToken<() => Promise<void>>('SYNC_REMOVED');

const SOON_MS = 2000;
const EVERY_MS = 15_000;

const messageOf = (err: unknown): string => {
  if (!(err instanceof ApiError)) return 'sync.failed';
  if (err.code === 'payload_too_large') return 'sync.tooLarge';
  // pull_stalled is a 502 too
  if (err.status >= 500 || err.code === 'internal') return 'sync.serverError';
  return 'sync.failed';
};

function failure(err: unknown): Outcome {
  if (err instanceof NetworkError) return { kind: 'offline' };
  if (err instanceof AuthError) return { kind: 'auth' };
  console.error('sync failed', err);
  return { kind: 'error', messageKey: messageOf(err) };
}

/** Push then pull, in the background: on start, when visible, when online, every 15 s and after actions. */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly store = inject(Store);
  private readonly api = inject(SYNC_API);
  private readonly authFailed = inject(SYNC_AUTH_FAILED, { optional: true });
  private readonly removed = inject(SYNC_REMOVED, { optional: true });
  private readonly db = inject(PromusDb);
  private readonly doc = inject(DOCUMENT);
  private readonly outcome = signal<Outcome>({ kind: 'idle' });
  private readonly rejected = signal(0);
  private readonly pulled = signal(0);
  /** How many syncs have pulled changes: what they changed may need asking about. */
  readonly pulls = this.pulled.asReadonly();
  readonly status = computed<SyncStatus>(() => ({
    ...this.outcome(),
    pending: this.store.pendingCount(),
    rejected: this.rejected(),
  }));

  private inFlight: Promise<void> | null = null;
  private soonTimer: ReturnType<typeof setTimeout> | undefined;
  private running: AbortController | null = null;
  private rerun = false;

  constructor() {
    // a guest route's instance goes with its route
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  start(): void {
    if (this.running) return;
    const running = new AbortController();
    this.running = running;
    const doc = this.doc;
    const ifVisible = () => {
      if (doc.visibilityState === 'visible') void this.syncNow();
    };
    doc.addEventListener('visibilitychange', ifVisible, { signal: running.signal });
    doc.defaultView?.addEventListener('online', () => void this.syncNow(), { signal: running.signal });
    const every = setInterval(ifVisible, EVERY_MS);
    running.signal.addEventListener('abort', () => {
      clearInterval(every);
      clearTimeout(this.soonTimer);
    });
    void this.syncNow();
  }

  stop(): void {
    this.running?.abort();
    this.running = null;
  }

  /** A sync 2 s after the last call; does nothing while stopped. */
  soon(): void {
    if (!this.running) return;
    clearTimeout(this.soonTimer);
    this.soonTimer = setTimeout(() => {
      // a running sync may be past its push already: run once more after it
      if (this.inFlight) this.rerun = true;
      else void this.syncNow();
    }, SOON_MS);
  }

  /** One sync at a time: a call while one runs gets that one. Never rejects; see `status`. */
  syncNow(): Promise<void> {
    this.inFlight ??= this.run()
      .catch((err: unknown) => this.outcome.set(failure(err)))
      .finally(() => {
        this.inFlight = null;
        const again = this.rerun && this.running !== null;
        this.rerun = false;
        if (again) void this.syncNow();
      });
    return this.inFlight;
  }

  private async run(): Promise<void> {
    const before = await this.countRejected();
    // signed out: a still-valid cookie (logout while offline) must not pull the data back in. Not
    // `auth`: that is for a session the server ended, and would flash the sign-in icon after login
    const session = await this.db.getMeta('session');
    if (!session) {
      this.outcome.set({ kind: 'idle' });
      return;
    }
    this.outcome.set({ kind: 'syncing' });
    let outcome: Outcome = { kind: 'idle' };
    let authError: AuthError | null = null;
    let wasRemoved = false;
    try {
      // this run's writes land only in the session it starts in
      const { pulled } = await syncOnce(new DexieSyncStorage(this.db, session), this.api, () => Date.now());
      await this.store.load();
      if (pulled > 0) this.pulled.update((n) => n + 1);
    } catch (err) {
      // not a failure: the session changed under the run, which wrote nothing; the next run starts afresh
      if (err instanceof StaleSyncError) this.rerun = true;
      else if (err instanceof AuthError && this.authFailed) authError = err;
      else if (err instanceof ApiError && err.status === 403 && err.code === 'not_a_member' && this.removed) {
        wasRemoved = true;
      }
      else outcome = failure(err);
    } finally {
      // the store keeps every refusal for diagnostics; new ones are the error, even if a later step failed
      const refused = (await this.countRejected()) > before;
      this.outcome.set(refused ? { kind: 'error', messageKey: 'sync.rejected' } : outcome);
    }
    // last: it may delete the database
    if (authError) await this.authFailed?.(authError);
    if (wasRemoved) {
      await this.removed?.();
      // a start() from inside the run gets this run's promise, so ask for the next one
      this.rerun = true;
    }
  }

  private async countRejected(): Promise<number> {
    // a guest's undo outside its link (an archive, say) is refused by design: no news to the guest
    const count = await this.db.rejected.filter((r) => !(r.code === 'out_of_scope' && r.event.undoOf)).count();
    this.rejected.set(count);
    return count;
  }
}
