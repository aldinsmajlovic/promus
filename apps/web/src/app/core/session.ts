import { Injectable, inject, signal } from '@angular/core';
import { ApiError, AuthError, NetworkError } from '@promus/shared';
import { ApiClient } from './api';
import { PendingChangesError, PromusDb, type Session } from './db';

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
    const { user, householdId } = await this.api.login(username, password);
    if (householdId === null) throw new ApiError(403, 'no_household');
    const cached = await this.db.getMeta('session');
    if (cached?.userId !== user.id) {
      await this.db.wipe().catch(async (err: unknown) => {
        if (!(err instanceof PendingChangesError)) throw err;
        // the queued events are the cached user's: keep them and that session, and end the new one
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

  private async endServerSession(): Promise<void> {
    await this.api.logout().catch((err: unknown) => {
      // already gone on the server, or the server is out of reach: nothing more to end
      if (!(err instanceof AuthError || err instanceof NetworkError)) throw err;
    });
  }
}
