import { Injectable, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { AuthError, NetworkError, normalizeName } from '@promus/shared';
import { ApiClient } from './api';
import { PendingChangesError, PromusDb, type Session } from './db';
import { DexieSyncStorage } from './dexie-storage';
import type { Lang } from './i18n';

/** Another user signed in while the cached user's changes are still queued; the UI shows `messageKey`. */
export class PendingOtherUserError extends Error {
  readonly messageKey: string;
  readonly params: { username: string };

  /** `otherAccount`: the server knows the name as another account, so these changes can never sync. */
  constructor(username: string, otherAccount = false) {
    super(`${username} has unsynced changes`);
    this.name = 'PendingOtherUserError';
    this.messageKey = otherAccount ? 'login.pendingOtherAccount' : 'login.pendingOtherUser';
    this.params = { username };
  }
}

/** Signed in, but the browser didn't keep the Secure cookie: the page isn't served over HTTPS. */
export class CookieRejectedError extends Error {
  readonly messageKey = 'https.cookie';

  constructor() {
    super('the browser dropped the session cookie');
    this.name = 'CookieRejectedError';
  }
}

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly db = inject(PromusDb);
  private readonly api = inject(ApiClient);
  private readonly storage = inject(DexieSyncStorage);
  private readonly transloco = inject(TranslocoService);
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
    // before the server sets the new user's cookie: with it, a sync would push the cached user's
    // queued events as the new user's, and the server would refuse (and the outbox drop) them
    await this.assertCanSignIn(username);
    const cached = await this.db.getMeta('session');
    const { user, householdId: served } = await this.api.login(username, password);
    // some browsers count http://localhost as secure and still drop a Secure cookie there
    await this.api.me().catch((err: unknown) => {
      throw err instanceof AuthError ? new CookieRejectedError() : err;
    });
    if (cached?.userId !== user.id) {
      await this.db.wipe().catch(async (err: unknown) => {
        if (!(err instanceof PendingChangesError)) throw err;
        // another account behind the cached name: keep its queued events and session, end the new one
        await this.endServerSession();
        const sameName = normalizeName(user.username) === normalizeName(cached?.username ?? '');
        throw new PendingOtherUserError(cached?.username ?? '', sameName);
      });
    }
    // after the checks above: a refused sign-in must not leave a household behind
    const householdId = served ?? (await this.api.createHousehold(this.lang())).householdId;
    // removed from the old household and given another: what's here belongs to the old one
    if (cached?.userId === user.id && cached.householdId !== householdId) await this.db.wipe({ discardPending: true });
    const session = { userId: user.id, username: user.username, householdId };
    await this.db.setMeta('session', session);
    this.current.set(session);
    return session;
  }

  /**
   * For someone removed from their household: drops everything local, queued changes too (they can't
   * go anywhere), and asks for a household of their own. Null without a session. If the server can't be
   * reached the device stays signed out, and the error propagates.
   */
  async startOver(): Promise<{ session: Session; created: boolean } | null> {
    const cached = await this.db.getMeta('session');
    if (cached === undefined) return null;
    await this.db.wipe({ discardPending: true });
    this.current.set(null);
    const { householdId, created } = await this.api.createHousehold(this.lang());
    const session = { ...cached, householdId };
    await this.db.setMeta('session', session);
    this.current.set(session);
    return { session, created };
  }

  private lang(): Lang {
    return this.transloco.getActiveLang() as Lang;
  }

  /** Throws PendingOtherUserError while another user's changes wait here. Before anything that signs in. */
  async assertCanSignIn(username: string): Promise<void> {
    const cached = await this.db.getMeta('session');
    const otherName = cached !== undefined && normalizeName(username) !== normalizeName(cached.username);
    if (otherName && (await this.storage.pendingCount()) > 0) throw new PendingOtherUserError(cached.username);
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
