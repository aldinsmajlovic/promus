import type { SyncStatus } from './sync.service';

export type SyncBadge = { mark: string; key: string; params: Record<string, number> };

/** What needs attention, or null: an unsynced list is expected now and then, so it stays quiet. */
export function syncBadge(status: SyncStatus): SyncBadge | null {
  if (status.kind === 'auth') return { mark: '!', key: 'sync.signedOut', params: {} };
  if (status.kind === 'error') return { mark: '!', key: status.messageKey ?? 'sync.failed', params: {} };
  const n = status.pending;
  if (n <= 0) return null;
  // sv and en need only one and other
  return { mark: String(n), key: n === 1 ? 'sync.pending.one' : 'sync.pending.other', params: { n } };
}
