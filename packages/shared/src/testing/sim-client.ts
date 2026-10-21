import { makeEvent } from '../index.ts';
import type { EventInput, EventType, PayloadOf } from '../index.ts';
import { MemorySyncStorage } from './memory-storage.ts';

/** A simulated device: `now` is the reference clock, the device's own clock runs `clockOffsetMs` off it. */
export class SimClient {
  readonly storage: MemorySyncStorage;
  readonly householdId: string;
  readonly nodeId: string;
  readonly clockOffsetMs: number;
  readonly now: () => number;

  constructor(opts: { householdId: string; nodeId: string; now: () => number; clockOffsetMs?: number }) {
    this.householdId = opts.householdId;
    this.nodeId = opts.nodeId;
    this.clockOffsetMs = opts.clockOffsetMs ?? 0;
    this.now = () => opts.now() + this.clockOffsetMs;
    this.storage = new MemorySyncStorage({ nodeId: opts.nodeId, now: this.now });
  }

  act<T extends EventType>(type: T, payload: PayloadOf<T>, extra: { undoOf?: string } = {}): EventInput {
    const event = makeEvent(type, payload, {
      householdId: this.householdId,
      hlc: this.storage.nextHlc(),
      occurredAt: this.now(),
      ...extra,
    });
    this.storage.append([event]);
    return event;
  }
}
