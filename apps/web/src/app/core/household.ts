import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthError, type Member, NetworkError, type Person } from '@promus/shared';
import { ApiClient } from './api';
import { PromusDb } from './db';
import { SessionService } from './session';
import { Shares } from './shares';

/** The household's members, cached in `meta` so their faces show offline. */
@Injectable({ providedIn: 'root' })
export class Household {
  private readonly api = inject(ApiClient);
  private readonly db = inject(PromusDb);
  private readonly session = inject(SessionService);
  private readonly shares = inject(Shares);
  private readonly list = signal<Member[]>([]);
  // ids not known when first looked up, so each makes Shares ask the server once, not on every render
  private readonly asked = new Set<string>();
  readonly members = this.list.asReadonly();
  readonly you = computed(() => this.session.session()?.userId ?? null);
  readonly others = computed(() => this.list().filter((m) => m.id !== this.you()));
  readonly byId = computed(() => new Map(this.list().map((m) => [m.id, m])));

  /** A member, or a guest of one of the household's links; undefined for an id neither knows. */
  person(id: string): Person | undefined {
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
}
