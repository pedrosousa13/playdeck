import { describe, expect, test } from 'vitest';
import { createInitialPlayerState } from '../src/index';

describe('caption initial state', () => {
  test('starts with no tracks, no selection, unavailable rendering', () => {
    const state = createInitialPlayerState();
    expect(state.textTracks).toEqual([]);
    expect(state.selectedTextTrackId).toBeNull();
    expect(state.captionRendering).toBe('unavailable');
    expect(Object.isFrozen(state.textTracks)).toBe(true);
  });
});
