import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthError, type Member, NetworkError } from '@promus/shared';
import { ApiClient } from './api';
import { PromusDb } from './db';
import { SessionService } from './session';

/** The household's members, cached in `meta` so their faces show offline. */
@Injectable({ providedIn: 'root' })
export class Household {
  private readonly api = inject(ApiClient);
  private readonly db = inject(PromusDb);
  private readonly session = inject(SessionService);
  private readonly list = signal<Member[]>([]);
  readonly members = this.list.asReadonly();
  readonly you = computed(() => this.session.session()?.userId ?? null);
  readonly others = computed(() => this.list().filter((m) => m.id !== this.you()));
  readonly byId = computed(() => new Map(this.list().map((m) => [m.id, m])));

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
