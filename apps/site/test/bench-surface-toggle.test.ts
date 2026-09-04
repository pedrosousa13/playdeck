import { describe, expect, it } from 'vitest';
import { revealsOnly } from '../src/bench-surface-toggle';

describe('revealsOnly', () => {
  it('reveals only on a coarse pointer finding the bar already idle', () => {
    expect(revealsOnly(true, true)).toBe(true);
  });

  it('toggles playback on a fine pointer even if the bar was idle', () => {
    expect(revealsOnly(false, true)).toBe(false);
  });

  it('toggles playback on a coarse pointer once the bar is already visible', () => {
    expect(revealsOnly(true, false)).toBe(false);
  });

  it('toggles playback on a fine pointer with the bar already visible', () => {
    expect(revealsOnly(false, false)).toBe(false);
  });
});
