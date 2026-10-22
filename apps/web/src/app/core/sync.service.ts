import { DOCUMENT, Injectable, computed, inject, signal } from '@angular/core';
import { AuthError, NetworkError, syncOnce } from '@promus/shared';
import { ApiClient } from './api';
import { PromusDb } from './db';
import { DexieSyncStorage } from './dexie-storage';
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

function failure(err: unknown): Outcome {
  if (err instanceof NetworkError) return { kind: 'offline' };
  if (err instanceof AuthError) return { kind: 'auth' };
  console.error('sync failed', err);
  return { kind: 'error', messageKey: 'sync.failed' };
}

/** Push then pull, in the background: on start, when visible, when online, every 60 s and after actions. */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly store = inject(Store);
  private readonly storage = inject(DexieSyncStorage);
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
    if (!(await this.db.getMeta('session'))) {
      this.outcome.set({ kind: 'idle' });
      return;
    }
    this.outcome.set({ kind: 'syncing' });
    let outcome: Outcome = { kind: 'idle' };
    try {
      await syncOnce(this.storage, this.api, () => Date.now());
      await this.store.load();
    } catch (err) {
      outcome = failure(err);
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
