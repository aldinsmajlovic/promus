import { compareEvents, fold, hlcNow, hlcReceive, parseHlc } from '../index.ts';
import type { EventInput, HlcState, HouseholdState, RejectedEvent, StoredEvent, SyncStorage } from '../index.ts';

type OutboxRow = { event: EventInput; pushed: boolean };

const maxHlc = (events: Iterable<{ hlc: string }>): string | null => {
  let max: string | null = null;
  for (const { hlc } of events) if (max === null || hlc > max) max = hlc;
  return max;
};

/** SyncStorage in memory. `now` is the client's wall clock; new hlcs use now() + the server offset. */
export class MemorySyncStorage implements SyncStorage {
  readonly nodeId: string;
  readonly pulled = new Map<string, StoredEvent>();
  readonly outbox = new Map<string, OutboxRow>();
  readonly rejected = new Map<string, RejectedEvent>();
  private readonly now: () => number;
  private hlc: HlcState = { wall: 0, counter: 0 };
  private serverOffset = 0;
  private cursor = 0;

  constructor(opts: { nodeId: string; now: () => number }) {
    this.nodeId = opts.nodeId;
    this.now = opts.now;
  }

  nextHlc(): string {
    const next = hlcNow(this.hlc, this.now() + this.serverOffset, this.nodeId);
    this.hlc = next.state;
    return next.hlc;
  }

  append(events: EventInput[]): void {
    for (const event of events) this.outbox.set(event.id, { event, pushed: false });
  }

  pendingCount(): number {
    return this.pending().length;
  }

  state(): HouseholdState {
    return fold([...this.pulled.values(), ...[...this.outbox.values()].map((r) => r.event)]);
  }

  private pending(): EventInput[] {
    return [...this.outbox.values()].filter((r) => !r.pushed).map((r) => r.event).sort(compareEvents);
  }

  async pendingEvents(limit: number): Promise<EventInput[]> {
    return this.pending().slice(0, limit);
  }

  async markPushed(ids: string[]): Promise<void> {
    for (const id of ids) {
      const row = this.outbox.get(id);
      if (row) row.pushed = true;
    }
  }

  async reject(items: RejectedEvent[]): Promise<void> {
    for (const item of items) {
      this.outbox.delete(item.event.id);
      this.rejected.set(item.event.id, item);
    }
  }

  async restamp(ids: string[], serverOffsetMs: number): Promise<void> {
    this.serverOffset = serverOffsetMs;
    // lower the clock past the bad future values: only events others may have seen count
    const pushed = [...this.outbox.values()].filter((r) => r.pushed).map((r) => r.event);
    const top = maxHlc([...this.pulled.values(), ...pushed]);
    const { wall, counter } = top === null ? { wall: 0, counter: 0 } : parseHlc(top);
    this.hlc = { wall, counter };
    const targets = new Set(ids);
    const rows = [...this.outbox.values()].filter((r) => targets.has(r.event.id));
    for (const row of rows.sort((x, y) => compareEvents(x.event, y.event))) {
      row.event = { ...row.event, hlc: this.nextHlc() };
    }
  }

  async getCursor(): Promise<number> {
    return this.cursor;
  }

  async applyPulled(events: StoredEvent[], lastSeq: number): Promise<void> {
    for (const e of events) {
      this.pulled.set(e.id, e);
      this.outbox.delete(e.id);
    }
    this.cursor = lastSeq;
    const top = maxHlc(events);
    if (top !== null) this.hlc = hlcReceive(this.hlc, top, this.now() + this.serverOffset);
  }

  async setServerOffset(ms: number): Promise<void> {
    this.serverOffset = ms;
  }
}
