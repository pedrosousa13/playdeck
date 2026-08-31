import { describe, expect, it } from 'vitest';
import {
  capabilityWords,
  reasonWords,
  type UnavailableReason
} from '../src/bench-capabilities';
import type { PlayerCapabilities } from '@playdeck/core';

// Written by hand, and typed against `keyof PlayerCapabilities` rather than
// inferred as `string[]`, so a member removed from that type turns this line
// itself into a type error. A member added is not caught here -- the array
// annotation admits a shorter list -- but is still caught below, at the
// key-set assertion against `capabilityWords`, which fails at test time.
const ALL_CAPABILITIES: Array<keyof PlayerCapabilities> = [
  'seek',
  'setVolume',
  'setPlaybackRate',
  'selectQuality',
  'selectTextTrack',
  'chapters',
  'fullscreen',
  'pictureInPicture',
  'airPlay',
  'customControls'
];

// The `unavailable` branch's six reasons, written out the same way and typed
// against `UnavailableReason` for the same reason: a member removed from
// that type turns this line into a type error, and a member added is caught
// below instead. There is deliberately no equivalent list for `not-ready`
// and `provider-check` -- those are `unknown`, not a refusal, and are
// asserted absent below instead.
const ALL_UNAVAILABLE_REASONS: UnavailableReason[] = [
  'browser',
  'provider',
  'provider-plan',
  'provider-build',
  'source',
  'policy'
];

describe('capabilityWords', () => {
  it('has exactly one word per PlayerCapabilities key, and no extras', () => {
    expect(Object.keys(capabilityWords).sort()).toEqual(
      [...ALL_CAPABILITIES].sort()
    );
  });

  it('never uses an empty, whitespace-only, or full-stopped word', () => {
    for (const word of Object.values(capabilityWords)) {
      expect(word.trim()).not.toBe('');
      expect(word).toBe(word.trim());
      expect(word.endsWith('.')).toBe(false);
    }
  });
});

describe('reasonWords', () => {
  it('has exactly one word per unavailable reason, and no extras', () => {
    expect(Object.keys(reasonWords).sort()).toEqual(
      [...ALL_UNAVAILABLE_REASONS].sort()
    );
  });

  it('never covers an unknown reason, only unavailable ones', () => {
    expect(Object.keys(reasonWords)).not.toContain('not-ready');
    expect(Object.keys(reasonWords)).not.toContain('provider-check');
  });

  it('never uses an empty, whitespace-only, or full-stopped clause', () => {
    for (const word of Object.values(reasonWords)) {
      expect(word.trim()).not.toBe('');
      expect(word).toBe(word.trim());
      expect(word.endsWith('.')).toBe(false);
    }
  });
});
