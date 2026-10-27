import { Injectable, InjectionToken } from '@angular/core';
import type { EventInput, Member, HlcState, RejectedEvent, SharesResponse, StoredEvent } from '@promus/shared';
import Dexie, { type Table } from 'dexie';
import type { Lang } from './i18n';
import type { ThemeMode } from './theme';

export type Session = { userId: string; username: string; householdId: string };

/**
 * The link a guest route serves, or null for the household. `guestGuard` fills in `shareId` before anything opens
 * that route's database.
 */
export const GUEST = new InjectionToken<{ shareId: string } | null>('GUEST', { factory: () => null });

/** `pushed` is 0 or 1: booleans are not valid IndexedDB keys. */
export type OutboxRow = { id: string; hlc: string; pushed: 0 | 1; event: EventInput };
export type RejectedRow = RejectedEvent & { id: string };

export type Meta = {
  cursor: number;
  serverOffset: number;
  hlc: HlcState;
  deviceId: string;
  /** In a guest's database, `userId` is the guest's id and `username` their name, '' for "Guest". */
  session: Session;
  /** Only in a guest's database, one per link: `promus-guest-<shareId>`. */
  guest: { shareId: string; token: string; listId: string; householdId: string; sharedBy: string; expiresAt: number };
  members: Member[];
  shares: SharesResponse;
  currentListId: string;
  lang: Lang | 'system';
  theme: ThemeMode;
  persistRequested: boolean;
  doneFolded: boolean;
};
type MetaKey = keyof Meta;
// the device's choices, not the user's data: a wipe keeps them
const DEVICE_KEYS: MetaKey[] = ['lang', 'theme', 'doneFolded'];

/** Wiping now would drop events the server hasn't accepted yet. */
export class PendingChangesError extends Error {
  constructor() {
    super('unsynced changes would be lost');
    this.name = 'PendingChangesError';
  }
}

@Injectable({ providedIn: 'root', useFactory: () => new PromusDb('promus') })
export class PromusDb extends Dexie {
  declare readonly events: Table<StoredEvent, string>;
  declare readonly outbox: Table<OutboxRow, string>;
  declare readonly rejected: Table<RejectedRow, string>;
  declare readonly meta: Table<{ key: MetaKey; value: Meta[MetaKey] }, MetaKey>;

  constructor(name: string) {
    // strict: Chrome reports a commit only once it is on disk; with its relaxed default a power loss can
    // drop committed transactions, and the outbox holds the only copy of unsynced changes
    super(name, { chromeTransactionDurability: 'strict' });
    this.version(1).stores({
      events: 'id, seq',
      outbox: 'id, hlc, pushed',
      rejected: 'id',
      meta: 'key',
    });
  }

  async getMeta<K extends MetaKey>(key: K): Promise<Meta[K] | undefined> {
    return (await this.meta.get(key))?.value as Meta[K] | undefined;
  }

  async setMeta<K extends MetaKey>(key: K, value: Meta[K]): Promise<void> {
    await this.meta.put({ key, value });
  }

  /**
   * Clears every table but the device's language and theme in one transaction, so open tabs see it
   * through liveQuery and keep working. Throws PendingChangesError, and clears nothing, while the
   * outbox holds unpushed events.
   */
  async wipe(): Promise<void> {
    await this.transaction('rw', this.tables, async () => {
      // checked inside the transaction: no tab can queue an event between the check and the clear
      if ((await this.outbox.where('pushed').equals(0).count()) > 0) throw new PendingChangesError();
      await Promise.all(
        this.tables.map((t) =>
          t.name === this.meta.name ? this.meta.where('key').noneOf(DEVICE_KEYS).delete() : t.clear(),
        ),
      );
    });
  }
}
