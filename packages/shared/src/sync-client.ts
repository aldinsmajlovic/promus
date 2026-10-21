import { ApiError } from './errors.ts';
import { LIMITS } from './events.ts';
import type { EventInput, PullResponse, PushResponse, RejectCode, StoredEvent } from './events.ts';

export type RejectedEvent = { event: EventInput; code: RejectCode; message: string };

export interface SyncStorage {
  /** Events not yet pushed, ordered by hlc. */
  pendingEvents(limit: number): Promise<EventInput[]>;
  markPushed(ids: string[]): Promise<void>;
  reject(items: RejectedEvent[]): Promise<void>;
  /** New hlcs from now + serverOffsetMs. Only for events no other device has seen. */
  restamp(ids: string[], serverOffsetMs: number): Promise<void>;
  getCursor(): Promise<number>;
  /** One atomic step: store the events, drop outbox rows with the same ids, save the cursor. */
  applyPulled(events: StoredEvent[], lastSeq: number): Promise<void>;
  setServerOffset(ms: number): Promise<void>;
}

export interface SyncApi {
  push(events: EventInput[]): Promise<PushResponse>;
  pull(after: number, limit: number): Promise<PullResponse>;
}

/** Push, then pull. `now` is the client's wall clock. Errors from `api` propagate unchanged. */
export async function syncOnce(
  storage: SyncStorage,
  api: SyncApi,
  now: () => number,
): Promise<{ pushed: number; pulled: number; rejected: number }> {
  let pushed = 0;
  let rejected = 0;
  let pulled = 0;
  // a round that accepts nothing ends the loop, except once after a re-stamp, to push the re-stamped events
  let retried = false;
  for (;;) {
    const batch = await storage.pendingEvents(LIMITS.pushMaxEvents);
    if (batch.length === 0) break;
    const res = await api.push(batch);
    const offset = res.serverTime - now();
    await storage.setServerOffset(offset);
    const byId = new Map<string | null, EventInput>(batch.map((e) => [e.id, e]));
    // only ids from this batch: anything else from a misbehaving server is neither progress nor pushed
    const accepted = res.accepted.filter((id) => byId.has(id));
    await storage.markPushed(accepted);
    const skewed: string[] = [];
    const refused: RejectedEvent[] = [];
    for (const { id, code, message } of res.rejected) {
      const event = byId.get(id);
      // without a known id, a rejection can't be matched to an outbox row
      if (!event) continue;
      if (code === 'clock_skew') skewed.push(event.id);
      else refused.push({ event, code, message });
    }
    if (skewed.length > 0) await storage.restamp(skewed, offset);
    if (refused.length > 0) await storage.reject(refused);
    pushed += accepted.length;
    rejected += refused.length;
    if (accepted.length > 0) retried = false;
    else if (skewed.length > 0 && !retried) retried = true;
    else break;
  }
  let after = await storage.getCursor();
  for (;;) {
    const page = await api.pull(after, LIMITS.pullMaxLimit);
    if (page.hasMore && page.lastSeq <= after) {
      throw new ApiError(502, 'pull_stalled', `pull after ${after} has more but did not advance`);
    }
    await storage.setServerOffset(page.serverTime - now());
    await storage.applyPulled(page.events, page.lastSeq);
    pulled += page.events.length;
    after = page.lastSeq;
    if (!page.hasMore) break;
  }
  return { pushed, pulled, rejected };
}
