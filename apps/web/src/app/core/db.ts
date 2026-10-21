import { Injectable } from '@angular/core';
import type { EventInput, HlcState, RejectedEvent, StoredEvent } from '@promus/shared';
import Dexie, { type Table } from 'dexie';
import type { Lang } from './i18n';
import type { ThemeMode } from './theme';

export type Session = { userId: string; username: string; householdId: string };

/** `pushed` is 0 or 1: booleans are not valid IndexedDB keys. */
export type OutboxRow = { id: string; hlc: string; pushed: 0 | 1; event: EventInput };
export type RejectedRow = RejectedEvent & { id: string };

export type Meta = {
  cursor: number;
  serverOffset: number;
  hlc: HlcState;
  deviceId: string;
  session: Session;
  currentListId: string;
  lang: Lang | 'system';
  theme: ThemeMode;
  persistRequested: boolean;
};
type MetaKey = keyof Meta;

@Injectable({ providedIn: 'root', useFactory: () => new PromusDb('promus') })
export class PromusDb extends Dexie {
  declare readonly events: Table<StoredEvent, string>;
  declare readonly outbox: Table<OutboxRow, string>;
  declare readonly rejected: Table<RejectedRow, string>;
  declare readonly meta: Table<{ key: MetaKey; value: Meta[MetaKey] }, MetaKey>;

  constructor(name: string) {
    super(name);
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

  /** Clears every table in one transaction, so open tabs see it through liveQuery and keep working. */
  async wipe(): Promise<void> {
    await this.transaction('rw', this.tables, () => Promise.all(this.tables.map((t) => t.clear())));
  }
}
