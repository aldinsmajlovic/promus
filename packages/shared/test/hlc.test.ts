import { describe, it, expect } from 'vitest';
import { formatHlc, hlcNow, hlcReceive, hlcWall, parseHlc } from '../src/hlc.ts';
import { newId } from '../src/ids.ts';

describe('hlc', () => {
  it('formats a sortable fixed-width string', () => {
    expect(hlcNow({ wall: 0, counter: 0 }, 1_700_000_000_000, 'dev1').hlc)
      .toBe('001700000000000:00000:dev1');
  });
  it('never goes backwards when the wall clock does', () => {
    const a = hlcNow({ wall: 0, counter: 0 }, 2000, 'n');
    const b = hlcNow(a.state, 1000, 'n');
    expect(b.hlc > a.hlc).toBe(true);
    expect(hlcWall(b.hlc)).toBe(2000);
  });
  it('orders new events after a received remote timestamp', () => {
    const remote = '000000000005000:00003:other';
    const s = hlcReceive({ wall: 1000, counter: 0 }, remote, 1500);
    expect(hlcNow(s, 1500, 'me').hlc > remote).toBe(true);
  });
  it('compares counters correctly as strings', () => {
    expect(formatHlc(1000, 9, 'a') < formatHlc(1000, 10, 'a')).toBe(true);
  });
  it('parses and rejects malformed input', () => {
    expect(parseHlc('001700000000000:00007:dev-1')).toEqual({ wall: 1_700_000_000_000, counter: 7, node: 'dev-1' });
    expect(() => parseHlc('nope')).toThrow();
  });
  it('receive applies the counter rules', () => {
    const r = (w: number, c: number) => formatHlc(w, c, 'o');
    expect(hlcReceive({ wall: 10, counter: 2 }, r(10, 5), 5)).toEqual({ wall: 10, counter: 6 });
    expect(hlcReceive({ wall: 10, counter: 2 }, r(5, 9), 5)).toEqual({ wall: 10, counter: 3 });
    expect(hlcReceive({ wall: 5, counter: 2 }, r(10, 9), 5)).toEqual({ wall: 10, counter: 10 });
    expect(hlcReceive({ wall: 5, counter: 2 }, r(6, 9), 20)).toEqual({ wall: 20, counter: 0 });
  });
  it('throws on counter overflow', () => {
    expect(() => hlcNow({ wall: 10, counter: 99999 }, 10, 'n')).toThrow('hlc counter overflow');
    expect(() => hlcReceive({ wall: 10, counter: 99999 }, formatHlc(10, 0, 'o'), 10)).toThrow('hlc counter overflow');
  });
});

describe('newId', () => {
  it('returns distinct UUIDv7 strings', () => {
    const a = newId();
    expect(a).not.toBe(newId());
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
