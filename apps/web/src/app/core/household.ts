import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AuthError, type GuestMe, type Member, NetworkError, type Person } from '@promus/shared';
import { ApiClient } from './api';
import { GUEST, PromusDb } from './db';
import { SessionService } from './session';
import { Shares } from './shares';
import { SyncService } from './sync.service';

/**
 * The household's members, cached in `meta` so their faces show offline. On a guest's page, the people on the
 * link's list instead, from its `me`.
 */
@Injectable({ providedIn: 'root' })
export class Household {
  private readonly api = inject(ApiClient);
  private readonly db = inject(PromusDb);
  private readonly session = inject(SessionService);
  private readonly shares = inject(Shares);
  private readonly link = inject(GUEST);
  private readonly me = signal<GuestMe | null>(null);
  /** On a guest's page: who the guest is, who's on the list, and until when the link works. */
  readonly guestMe = this.me.asReadonly();
  private readonly list = signal<Member[]>([]);
  // ids not known when first looked up, so each makes Shares ask the server once, not on every render
  private readonly asked = new Set<string>();
  readonly members = this.list.asReadonly();
  readonly you = computed(() => this.session.session()?.userId ?? null);
  /** Who is in the household now: former members stay in `members` so their names stay on what they added. */
  readonly current = computed(() => this.list().filter((m) => !m.former));
  readonly isOwner = computed(() => this.current().some((m) => m.id === this.you() && m.role === 'owner'));
  readonly others = computed(() => this.current().filter((m) => m.id !== this.you()));
  readonly byId = computed(() => new Map(this.list().map((m) => [m.id, m])));

  constructor() {
    // the list page asks when it opens; after that only a pull that brought changes can have brought new people
    if (this.link) {
      const sync = inject(SyncService);
      effect(() => {
        if (sync.pulls()) untracked(() => void this.refresh());
      });
    }
  }

  /** A member, or a guest of one of the household's links; undefined for an id neither knows. */
  person(id: string): Person | undefined {
    if (this.link) return this.me()?.people.find((p) => p.id === id);
    const member = this.byId().get(id);
    if (member) return { id, name: member.username, guest: false };
    const name = this.shares.guestName(id);
    if (name !== undefined) return { id, name, guest: true };
    if (!this.asked.has(id)) {
      this.asked.add(id);
      // a guest who joined since the last answer: ask again once the one on its way is in, unless a newer one is
      const asking = this.shares.settled();
      void asking.then(() => {
        if (this.shares.settled() === asking && !this.person(id)) void this.shares.refresh();
      });
    }
    return undefined;
  }

  // ponytail: refreshed only when the list or Household opens; refresh on an unknown author if new members' faces lag
  /** Never rejects: the cached list stays when the server can't be asked. */
  async refresh(): Promise<void> {
    // a guest's page asks its link, never the household's endpoints
    if (this.link) return this.refreshMe(this.link.shareId);
    try {
      const cached = await this.db.getMeta('members');
      this.list.set(cached ?? []);
      const members = (await this.api.me()).households[0]?.members;
      if (!members) return;
      this.list.set(members);
      await this.db.setMeta('members', members);
    } catch (err) {
      // offline or signed out (the badge on your initial says so): keep what we have
      if (!(err instanceof NetworkError || err instanceof AuthError)) console.error('household members failed', err);
    }
  }

  private async refreshMe(shareId: string): Promise<void> {
    try {
      this.me.set((await this.db.getMeta('me')) ?? null);
      const me = await this.api.guestMe(shareId);
      this.me.set(me);
      await this.db.setMeta('me', me);
    } catch (err) {
      // offline, or the link has ended (the sync deals with that): keep what we have
      if (!(err instanceof NetworkError || err instanceof AuthError)) console.error('people on the list failed', err);
    }
  }
}
