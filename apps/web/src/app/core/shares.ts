import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthError, NetworkError, type Share, type SharesResponse } from '@promus/shared';
import { ApiClient } from './api';
import { GUEST, PromusDb } from './db';

/** The household's live links, and every guest it has had, cached in `meta` so they show offline. */
@Injectable({ providedIn: 'root' })
export class Shares {
  private readonly api = inject(ApiClient);
  private readonly db = inject(PromusDb);
  private readonly guest = inject(GUEST) !== null;
  private readonly state = signal<SharesResponse>({ shares: [], guests: [] });
  readonly data = this.state.asReadonly();
  private readonly names = computed(() => new Map(this.state().guests.map((g) => [g.id, g.name])));
  private last: Promise<void> = Promise.resolve();

  /** Never rejects: the cached links stay when the server can't be asked. */
  refresh(): Promise<void> {
    // a guest's page never asks the household's endpoints
    if (this.guest) return this.last;
    return (this.last = this.load());
  }

  /** The newest refresh, so a lookup can wait for an answer already on its way. */
  settled(): Promise<void> {
    return this.last;
  }

  private async load(): Promise<void> {
    try {
      this.state.set((await this.db.getMeta('shares')) ?? { shares: [], guests: [] });
      const data = await this.api.shares();
      this.state.set(data);
      await this.db.setMeta('shares', data);
    } catch (err) {
      // offline or signed out (the badge on your initial says so): keep what we have
      if (!(err instanceof NetworkError || err instanceof AuthError)) console.error('shares failed', err);
    }
  }

  /** The list's link, unless it has run out since it was cached. */
  liveFor(listId: string): Share | null {
    return this.state().shares.find((s) => s.listId === listId && s.expiresAt > Date.now()) ?? null;
  }

  /** A guest's name: null for "Guest", undefined for a guest this household doesn't know. */
  guestName(id: string): string | null | undefined {
    return this.names().get(id);
  }
}
