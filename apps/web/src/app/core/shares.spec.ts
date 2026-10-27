import { TestBed } from '@angular/core/testing';
import { NetworkError, newId } from '@promus/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from './api';
import { PromusDb } from './db';
import { Shares } from './shares';

const DAY = 86_400_000;
const share = (listId: string, expiresAt = Date.now() + DAY) =>
  ({ id: newId(), listId, token: 'tok', expiresAt, createdBy: 'u1' });

const data = { shares: [share('l1')], guests: [{ id: 'g1', shareId: 's1', name: 'Jonas' }] };

function setup() {
  const db = new PromusDb(`shares-${newId()}`);
  const api = { shares: vi.fn<ApiClient['shares']>() };
  TestBed.configureTestingModule({
    providers: [
      { provide: PromusDb, useValue: db },
      { provide: ApiClient, useValue: api },
    ],
  });
  return { db, api, shares: TestBed.inject(Shares) };
}

describe('Shares', () => {
  it('saves what the server says', async () => {
    const { db, api, shares } = setup();
    api.shares.mockResolvedValue(data);
    await shares.refresh();
    expect(await db.getMeta('shares')).toEqual(data);
    expect(shares.data()).toEqual(data);
    expect(shares.guestName('g1')).toBe('Jonas');
    expect(shares.guestName('g2')).toBeUndefined();
  });

  it('shows the cached links when the server is out of reach', async () => {
    const { db, api, shares } = setup();
    await db.setMeta('shares', data);
    api.shares.mockRejectedValue(new NetworkError());
    await shares.refresh();
    expect(shares.data()).toEqual(data);
  });

  it('finds the live link of a list', async () => {
    const { api, shares } = setup();
    const live = share('l1');
    api.shares.mockResolvedValue({ shares: [share('l2', Date.now() - 1), live], guests: [] });
    await shares.refresh();
    expect(shares.liveFor('l1')).toEqual(live);
    expect(shares.liveFor('l2')).toBeNull();
    expect(shares.liveFor('l3')).toBeNull();
  });
});
