import { describe, expect, it } from 'vitest';
import { ApiError, newId, syncOnce } from '../src/index.ts';
import type { PushResponse, SyncApi } from '../src/index.ts';
import { SimClient } from '../src/testing/index.ts';

const now = () => 1_700_000_000_000;

function setup(push: SyncApi['push'], pull: SyncApi['pull'] = async (after) => ({ events: [], lastSeq: after, hasMore: false, serverTime: now() })) {
  const client = new SimClient({ householdId: newId(), nodeId: 'phone', now });
  client.act('item.created', { itemId: newId(), name: 'Mjölk' });
  const calls = { push: 0, pull: 0 };
  const api: SyncApi = {
    push: (events) => (calls.push++, push(events)),
    pull: (after, limit) => (calls.pull++, pull(after, limit)),
  };
  return { client, calls, sync: () => syncOnce(client.storage, api, client.now) };
}

describe('syncOnce', () => {
  it('a push that never succeeds ends the sync instead of looping', async () => {
    const { client, calls, sync } = setup(async (events) => ({
      accepted: [],
      rejected: events.map((e) => ({ id: e.id, code: 'clock_skew', message: 'future' })),
      serverTime: now(),
    }));
    expect(await sync()).toEqual({ pushed: 0, pulled: 0, rejected: 0 });
    expect(calls.push).toBe(2);
    expect(client.storage.pendingCount()).toBe(1);
  });

  it('accepted ids outside the pushed batch are not progress', async () => {
    const { client, calls, sync } = setup(async (): Promise<PushResponse> => ({ accepted: [newId()], rejected: [], serverTime: now() }));
    expect(await sync()).toEqual({ pushed: 0, pulled: 0, rejected: 0 });
    expect(calls.push).toBe(1);
    expect(client.storage.pendingCount()).toBe(1);
  });

  it('a pull that never advances fails instead of looping', async () => {
    const { calls, sync } = setup(
      async (events) => ({ accepted: events.map((e) => e.id), rejected: [], serverTime: now() }),
      async (after) => ({ events: [], lastSeq: after, hasMore: true, serverTime: now() }),
    );
    const err = await sync().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'pull_stalled' });
    expect(calls.pull).toBe(1);
  });
});
