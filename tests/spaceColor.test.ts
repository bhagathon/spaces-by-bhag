import { describe, expect, it } from 'vitest';
import { spaceColor } from '../src/shared/types';

describe('spaceColor', () => {
  it('uses the colour the user picked', () => {
    expect(spaceColor({ id: 'abc', color: 'pink' })).toBe('pink');
  });

  it('gives every uncoloured Space its own stable colour, never red or grey', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `space-${i}-${i * 7919}`);
    const colors = ids.map(id => spaceColor({ id }));
    expect(colors.every(c => c !== 'red' && c !== 'grey')).toBe(true);
    expect(new Set(colors).size).toBeGreaterThanOrEqual(6); // spread across the palette
    expect(ids.map(id => spaceColor({ id }))).toEqual(colors); // same Space, same colour, every time
  });
});
