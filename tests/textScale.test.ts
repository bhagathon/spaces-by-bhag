import { describe, expect, it } from 'vitest';
import { normalizeScale, stepScale, TEXT_SCALES } from '../src/ui/textScale';

describe('text size', () => {
  it('offers four sizes around 100%', () => {
    expect(TEXT_SCALES.map(s => s.value)).toEqual([0.9, 1, 1.15, 1.3]);
  });

  it('falls back to 100% for anything that is not one of the sizes', () => {
    expect(normalizeScale(1.15)).toBe(1.15);
    expect(normalizeScale(undefined)).toBe(1);
    expect(normalizeScale('1.3')).toBe(1);
    expect(normalizeScale(7)).toBe(1);
  });

  it('steps up and down, stopping at the ends, and resets', () => {
    expect(stepScale(1, 1)).toBe(1.15);
    expect(stepScale(1.3, 1)).toBe(1.3);
    expect(stepScale(1, -1)).toBe(0.9);
    expect(stepScale(0.9, -1)).toBe(0.9);
    expect(stepScale(1.3, 0)).toBe(1);
  });
});
