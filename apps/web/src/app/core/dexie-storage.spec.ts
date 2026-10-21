import { newId } from '@promus/shared';
import { syncStorageContract } from '@promus/shared/testing';
import { PromusDb } from './db';
import { DexieSyncStorage } from './dexie-storage';

syncStorageContract('dexie', async () => new DexieSyncStorage(new PromusDb(`contract-${newId()}`)));
