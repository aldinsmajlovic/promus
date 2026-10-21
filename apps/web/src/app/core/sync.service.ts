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

const SOON_MS = 2000;
const EVERY_MS = 60_000;

function failure(err: unknown): Pick<SyncStatus, 'kind' | 'messageKey'> {
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
  private readonly outcome = signal<Pick<SyncStatus, 'kind' | 'messageKey'>>({ kind: 'idle' });
  private readonly rejected = signal(0);
  readonly status = computed<SyncStatus>(() => ({
    ...this.outcome(),
    pending: this.store.pendingCount(),
    rejected: this.rejected(),
  }));

  private inFlight: Promise<void> | null = null;
  private soonTimer: ReturnType<typeof setTimeout> | undefined;
  private running: AbortController | null = null;

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
    this.soonTimer = setTimeout(() => void this.syncNow(), SOON_MS);
  }

  /** One sync at a time: a call while one runs gets that one. Never rejects; see `status`. */
  syncNow(): Promise<void> {
    this.inFlight ??= this.run().finally(() => (this.inFlight = null));
    return this.inFlight;
  }

  private async run(): Promise<void> {
    // signed out: a still-valid cookie (logout while offline) must not pull the data back in
    if (!(await this.db.getMeta('session'))) {
      this.outcome.set({ kind: 'auth' });
      return;
    }
    this.outcome.set({ kind: 'syncing' });
    try {
      await syncOnce(this.storage, this.api, () => Date.now());
      await this.store.load();
      const rejected = await this.db.rejected.count();
      this.rejected.set(rejected);
      this.outcome.set(rejected > 0 ? { kind: 'error', messageKey: 'sync.rejected' } : { kind: 'idle' });
    } catch (err) {
      this.outcome.set(failure(err));
    }
  }
}
