import { Injectable, inject, signal } from '@angular/core';
import { ApiError, AuthError, NetworkError, normalizeName } from '@promus/shared';
import { ApiClient } from './api';
import { PendingChangesError, PromusDb, type Session } from './db';
import { DexieSyncStorage } from './dexie-storage';

/** Another user signed in while the cached user's changes are still queued; the UI shows `messageKey`. */
export class PendingOtherUserError extends Error {
  readonly messageKey = 'login.pendingOtherUser';
  readonly params: { username: string };

  constructor(username: string) {
    super(`${username} has unsynced changes`);
    this.name = 'PendingOtherUserError';
    this.params = { username };
  }
}

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

  /**
   * Another user's synced local data is wiped first; the same user keeps theirs, pending changes
   * included. Throws PendingOtherUserError while the cached user has unsynced changes.
   */
  async login(username: string, password: string): Promise<Session> {
    const cached = await this.db.getMeta('session');
    // before the server sets the new user's cookie: with it, a sync would push the cached user's
    // queued events as the new user's, and the server would refuse (and the outbox drop) them
    const otherName = cached !== undefined && normalizeName(username) !== normalizeName(cached.username);
    if (otherName && (await this.storage.pendingCount()) > 0) throw new PendingOtherUserError(cached.username);
    const { user, householdId } = await this.api.login(username, password);
    if (householdId === null) throw new ApiError(403, 'no_household');
    if (cached?.userId !== user.id) {
      await this.db.wipe().catch(async (err: unknown) => {
        if (!(err instanceof PendingChangesError)) throw err;
        // another account behind the cached name: keep its queued events and session, end the new one
        await this.endServerSession();
        throw new PendingOtherUserError(cached?.username ?? '');
      });
    }
    const session = { userId: user.id, username: user.username, householdId };
    await this.db.setMeta('session', session);
    this.current.set(session);
    return session;
  }

  /** Throws PendingChangesError, and changes nothing, while changes are unsynced. */
  async logout(): Promise<void> {
    // the wipe takes the session with it, so no action can be queued while the server call runs
    await this.db.wipe();
    this.current.set(null);
    await this.endServerSession();
  }

  /** Never rejects: by now the local outcome is settled, and a server error must not replace it. */
  private async endServerSession(): Promise<void> {
    await this.api.logout().catch((err: unknown) => {
      // already gone on the server, or out of reach: nothing more to end
      if (!(err instanceof AuthError || err instanceof NetworkError)) console.error('server logout failed', err);
    });
  }
}
