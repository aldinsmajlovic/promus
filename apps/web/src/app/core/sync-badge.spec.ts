import { describe, expect, it } from 'vitest';
import { syncBadge } from './sync-badge';

describe('syncBadge', () => {
  it('an expired sign-in is a "!"', () => {
    expect(syncBadge({ kind: 'auth', pending: 3, rejected: 0 })).toEqual({
      mark: '!',
      key: 'sync.signedOut',
      params: {},
    });
  });

  it('an error is a "!" with its reason', () => {
    expect(syncBadge({ kind: 'error', pending: 0, rejected: 1, messageKey: 'sync.rejected' })).toEqual({
      mark: '!',
      key: 'sync.rejected',
      params: {},
    });
    expect(syncBadge({ kind: 'error', pending: 0, rejected: 0 })?.key).toBe('sync.failed');
  });

  it('unsynced changes are their count', () => {
    expect(syncBadge({ kind: 'offline', pending: 1, rejected: 0 })).toEqual({
      mark: '1',
      key: 'sync.pending.one',
      params: { n: 1 },
    });
    expect(syncBadge({ kind: 'syncing', pending: 2, rejected: 0 })).toEqual({
      mark: '2',
      key: 'sync.pending.other',
      params: { n: 2 },
    });
  });

  it('offline with nothing pending shows nothing', () => {
    expect(syncBadge({ kind: 'offline', pending: 0, rejected: 0 })).toBeNull();
  });
});
