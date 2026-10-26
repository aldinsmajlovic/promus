import { TestBed } from '@angular/core/testing';
import { NetworkError, newId } from '@promus/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from './api';
import { PromusDb } from './db';
import { Household } from './household';
import { SessionService } from './session';

const anna = { id: 'u1', username: 'anna', role: 'owner' };
const bo = { id: 'u2', username: 'bo', role: 'member' };

function setup() {
  const db = new PromusDb(`household-${newId()}`);
  const api = { me: vi.fn<ApiClient['me']>() };
  TestBed.configureTestingModule({
    providers: [
      { provide: PromusDb, useValue: db },
      { provide: ApiClient, useValue: api },
    ],
  });
  return { db, api, household: TestBed.inject(Household) };
}

describe('Household', () => {
  it('shows cached members when the server is out of reach', async () => {
    const { db, api, household } = setup();
    await db.setMeta('members', [anna, bo]);
    api.me.mockRejectedValue(new NetworkError());
    await household.refresh();
    expect(household.members()).toEqual([anna, bo]);
  });

  it('forgets members once the cache is wiped', async () => {
    const { db, api, household } = setup();
    await db.setMeta('members', [anna, bo]);
    api.me.mockRejectedValue(new NetworkError());
    await household.refresh();
    await db.meta.delete('members');
    await household.refresh();
    expect(household.members()).toEqual([]);
  });

  it('keeps the cache when the server names no household', async () => {
    const { db, api, household } = setup();
    await db.setMeta('members', [anna, bo]);
    api.me.mockResolvedValue({ user: { id: 'u1', username: 'anna' }, households: [] });
    await household.refresh();
    expect(household.members()).toEqual([anna, bo]);
    expect(await db.getMeta('members')).toEqual([anna, bo]);
  });

  it('saves what the server says', async () => {
    const { db, api, household } = setup();
    await db.setMeta('session', { userId: 'u1', username: 'anna', householdId: 'h1' });
    await TestBed.inject(SessionService).load();
    api.me.mockResolvedValue({ user: { id: 'u1', username: 'anna' }, households: [{ id: 'h1', role: 'owner', members: [anna, bo] }] });
    await household.refresh();
    expect(await db.getMeta('members')).toEqual([anna, bo]);
    expect(household.others()).toEqual([bo]);
  });
});
