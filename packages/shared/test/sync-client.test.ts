import { describe, expect, it } from 'vitest';
import { newId, syncOnce } from '../src/index.ts';
import type { SyncApi } from '../src/index.ts';
import { SimClient } from '../src/testing/index.ts';

describe('syncOnce', () => {
  it('a push that never succeeds ends the sync instead of looping', async () => {
    const now = () => 1_700_000_000_000;
    const client = new SimClient({ householdId: newId(), nodeId: 'phone', now });
    client.act('item.created', { itemId: newId(), name: 'Mjölk' });
    let pushes = 0;
    const api: SyncApi = {
      push: async (events) => {
        pushes++;
        return { accepted: [], rejected: events.map((e) => ({ id: e.id, code: 'clock_skew', message: 'future' })), serverTime: now() };
      },
      pull: async (after) => ({ events: [], lastSeq: after, hasMore: false, serverTime: now() }),
    };
    expect(await syncOnce(client.storage, api, client.now)).toEqual({ pushed: 0, pulled: 0, rejected: 0 });
    expect(pushes).toBe(2);
    expect(client.storage.pendingCount()).toBe(1);
  });
});
