import { DOCUMENT, Injectable, computed, inject, signal } from '@angular/core';
import { ApiError, AuthError, NetworkError, syncOnce } from '@promus/shared';
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

const SOON_MS = 2000;
const EVERY_MS = 60_000;

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

/** Push then pull, in the background: on start, when visible, when online, every 60 s and after actions. */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly store = inject(Store);
  private readonly api = inject(ApiClient);
  private readonly db = inject(PromusDb);
  private readonly doc = inject(DOCUMENT);
  private readonly outcome = signal<Outcome>({ kind: 'idle' });
  private readonly rejected = signal(0);
  readonly status = computed<SyncStatus>(() => ({
    ...this.outcome(),
    pending: this.store.pendingCount(),
    rejected: this.rejected(),
  }));

  private inFlight: Promise<void> | null = null;
  private soonTimer: ReturnType<typeof setTimeout> | undefined;
  private running: AbortController | null = null;
  private rerun = false;

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
    try {
      // this run's writes land only in the session it starts in
      await syncOnce(new DexieSyncStorage(this.db, session), this.api, () => Date.now());
      await this.store.load();
    } catch (err) {
      // not a failure: the session changed under the run, which wrote nothing; the next run starts afresh
      if (err instanceof StaleSyncError) this.rerun = true;
      else outcome = failure(err);
    } finally {
      // the store keeps every refusal for diagnostics; new ones are the error, even if a later step failed
      const refused = (await this.countRejected()) > before;
      this.outcome.set(refused ? { kind: 'error', messageKey: 'sync.rejected' } : outcome);
    }
  }

  private async countRejected(): Promise<number> {
    const count = await this.db.rejected.count();
    this.rejected.set(count);
    return count;
  }
}
