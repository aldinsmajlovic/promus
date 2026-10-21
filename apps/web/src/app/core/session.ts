import { Injectable, inject, signal } from '@angular/core';
import { ApiError, AuthError, NetworkError } from '@promus/shared';
import { ApiClient } from './api';
import { PromusDb, type Session } from './db';
import { DexieSyncStorage } from './dexie-storage';

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly db = inject(PromusDb);
  private readonly api = inject(ApiClient);
  private readonly storage = inject(DexieSyncStorage);
  private readonly current = signal<Session | null>(null);
  /** The signed-in user as cached in `meta`; `load()` reads it. */
  readonly session = this.current.asReadonly();

  async load(): Promise<Session | null> {
    const session = (await this.db.getMeta('session')) ?? null;
    this.current.set(session);
    return session;
  }

  /** Another user's local data is wiped first; the same user keeps theirs, pending changes included. */
  async login(username: string, password: string): Promise<Session> {
    const { user, householdId } = await this.api.login(username, password);
    if (householdId === null) throw new ApiError(403, 'no_household');
    const cached = await this.db.getMeta('session');
    if (cached?.userId !== user.id) await this.db.wipe();
    const session = { userId: user.id, username: user.username, householdId };
    await this.db.setMeta('session', session);
    this.current.set(session);
    return session;
  }

  /** Refuses while changes are unsynced: wiping would lose them. */
  async logout(): Promise<void> {
    if ((await this.storage.pendingCount()) > 0) throw new Error('unsynced changes would be lost');
    if (navigator.onLine) {
      await this.api.logout().catch((err: unknown) => {
        // already signed out on the server, or not reachable after all: signing out here still counts
        if (!(err instanceof AuthError || err instanceof NetworkError)) throw err;
      });
    }
    await this.db.wipe();
    this.current.set(null);
  }
}
