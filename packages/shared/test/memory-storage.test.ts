import { expect, it } from 'vitest';
import { formatHlc, makeEvent, newId } from '../src/index.ts';
import { MemorySyncStorage, syncStorageContract } from '../src/testing/index.ts';

syncStorageContract('memory', async () => new MemorySyncStorage({ nodeId: 'contract', now: Date.now }));

it('local events sort after everything pulled', async () => {
  const T = 1_700_000_000_000;
  const s = new MemorySyncStorage({ nodeId: 'phone', now: () => T });
  const ahead = formatHlc(T + 30 * 60_000, 3, 'other');
  const e = makeEvent('item.created', { itemId: newId(), name: 'Mjölk' }, { householdId: newId(), hlc: ahead, occurredAt: T });
  await s.applyPulled([{ ...e, seq: 1, userId: newId(), receivedAt: T }], 1);
  expect(s.nextHlc() > ahead).toBe(true);
});
