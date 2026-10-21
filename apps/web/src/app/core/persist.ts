import type { PromusDb } from './db';

/**
 * Asks the browser once to keep this origin's storage, and records that in `meta`. Resolves to whether
 * storage is persisted. Without a StorageManager (an insecure context, say) it resolves to false.
 */
export async function requestPersistence(
  db: PromusDb,
  storage: StorageManager | undefined = navigator.storage,
): Promise<boolean> {
  if (!storage) return false;
  if (await db.getMeta('persistRequested')) return storage.persisted();
  const persisted = await storage.persist();
  await db.setMeta('persistRequested', true);
  return persisted;
}
