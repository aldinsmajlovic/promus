import { describe, expect, it } from 'vitest';
import type { FoldEvent } from '../src/index.ts';
import { formatHlc, makeEvent, newId, parseEventInput, EVENT_TYPES } from '../src/index.ts';

const meta = () => ({ householdId: newId(), hlc: formatHlc(1, 0, 'dev'), occurredAt: 1 });
const item = (name: string) => makeEvent('item.created', { itemId: newId(), name }, meta());
const note = (n: string) => makeEvent('entry.noteSet', { listId: newId(), itemId: newId(), note: n }, meta());

describe('event schemas', () => {
  it('accepts a valid entry.added with and without a note', () => {
    const p = { listId: newId(), itemId: newId() };
    expect(parseEventInput(makeEvent('entry.added', p, meta())).ok).toBe(true);
    expect(parseEventInput(makeEvent('entry.added', { ...p, note: 'ripe' }, meta())).ok).toBe(true);
  });

  it('has the 13 spec types', () => expect(EVENT_TYPES).toHaveLength(13));

  it('rejects names that are not clean, empty, or longer than 200', () => {
    for (const n of [' Mjölk', '', 'x'.repeat(201)]) expect(parseEventInput(item(n)).ok).toBe(false);
    expect(parseEventInput(item('x'.repeat(200))).ok).toBe(true);
  });

  it('rejects notes longer than 500', () => {
    expect(parseEventInput(note('x'.repeat(501))).ok).toBe(false);
    expect(parseEventInput(note('x'.repeat(500))).ok).toBe(true);
    expect(parseEventInput(note('')).ok).toBe(true);
  });

  it('rejects unknown types and extra payload fields', () => {
    expect(parseEventInput({ ...item('a'), type: 'nope' }).ok).toBe(false);
    const e = item('a');
    expect(parseEventInput({ ...e, payload: { ...e.payload, extra: 1 } }).ok).toBe(false);
    expect(parseEventInput({ ...e, extra: 1 }).ok).toBe(false);
  });

  it('rejects malformed hlc and non-integer occurredAt', () => {
    expect(parseEventInput({ ...item('a'), hlc: 'bad' }).ok).toBe(false);
    expect(parseEventInput({ ...item('a'), occurredAt: 1.5 }).ok).toBe(false);
  });

  it('parseEventInput reports the id of an invalid event', () => {
    const r = parseEventInput({ id: 'abc', type: 'nope' });
    expect(r).toMatchObject({ ok: false, id: 'abc' });
  });
});

// compile-time check (tsc): switching on type narrows payload without a cast
const nameOf = (e: FoldEvent): string | undefined => {
  switch (e.type) {
    case 'item.created':
      return e.payload.name;
    case 'entry.noteSet':
      return e.payload.note;
    default:
      return undefined;
  }
};

describe('FoldEvent', () => {
  it('narrows payload by type', () => {
    expect(nameOf(item('milk'))).toBe('milk');
  });
});
