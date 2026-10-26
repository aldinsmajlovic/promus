import { describe, expect, it } from 'vitest';
import { faceTone, initialOf } from './face';

describe('face', () => {
  it('you are tone 0, others a stable tone from 1 to 5', () => {
    expect(faceTone('abc', true)).toBe(0);
    const tone = faceTone('abc', false);
    expect(faceTone('abc', false)).toBe(tone);
    expect(tone).toBeGreaterThanOrEqual(1);
    expect(tone).toBeLessThanOrEqual(5);
  });

  it('the initial is the first letter, upper-cased', () => {
    expect(initialOf('åsa')).toBe('Å');
    expect(initialOf('😀x')).toBe('😀');
  });
});
