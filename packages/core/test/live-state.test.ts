// @vitest-environment node

import { describe, expect, test } from 'vitest';
import {
  deriveLiveState,
  liveStateEqual,
  type LiveDerivationInput
} from '../src/index';

// An ordinary live stream sitting exactly on the edge, carrying no threshold of
// its own — so a case that means to test the shared default can use it as-is.
const untuned: LiveDerivationInput = {
  duration: Number.POSITIVE_INFINITY,
  seekable: [{ start: 0, end: 600 }],
  currentTime: 600
};

// The same stream with a tight explicit threshold, well inside the shared one,
// so a case measuring the edge cannot pass by accident on the default.
const base: LiveDerivationInput = { ...untuned, atEdgeThreshold: 2 };

describe('liveness', () => {
  test('reads an infinite duration as live when no hint is given', () => {
    expect(deriveLiveState(base)).toEqual({ isLive: true, atLiveEdge: true });
  });

  test.each<[string, number]>([
    ['finite', 600],
    ['unknown', Number.NaN]
  ])('reads a %s duration with no hint as not live', (_label, duration) => {
    expect(deriveLiveState({ ...base, duration })).toBeNull();
  });

  test('lets a true hint decide over a finite duration', () => {
    expect(
      deriveLiveState({ ...base, duration: 600, isLiveHint: true })
    ).toEqual({ isLive: true, atLiveEdge: true });
  });

  test('lets a false hint decide over an infinite duration', () => {
    expect(deriveLiveState({ ...base, isLiveHint: false })).toBeNull();
  });

  test('freezes the derived state', () => {
    expect(Object.isFrozen(deriveLiveState(base))).toBe(true);
  });
});

describe('edge distance', () => {
  test('measures against the furthest seekable end', () => {
    expect(
      deriveLiveState({
        ...base,
        seekable: [
          { start: 0, end: 100 },
          { start: 200, end: 600 }
        ],
        currentTime: 599
      })
    ).toEqual({ isLive: true, atLiveEdge: true });
  });

  test('prefers a known live edge over the seekable end', () => {
    // 594 is the target edge; 596 is past it but still inside the seek window.
    expect(
      deriveLiveState({ ...base, liveEdge: 594, currentTime: 590 })
    ).toEqual({ isLive: true, atLiveEdge: false });
  });

  test('reports behind the edge when the current time trails it', () => {
    expect(deriveLiveState({ ...base, currentTime: 300 })).toEqual({
      isLive: true,
      atLiveEdge: false
    });
  });

  test('never reads a current time past the edge as behind it', () => {
    expect(deriveLiveState({ ...base, currentTime: 900 })).toEqual({
      isLive: true,
      atLiveEdge: true
    });
  });

  test.each<[string, Partial<LiveDerivationInput>]>([
    ['no seekable window and no live edge', { seekable: [] }],
    ['an unknown current time', { currentTime: Number.NaN }]
  ])('assumes the edge when there is %s', (_label, overrides) => {
    expect(deriveLiveState({ ...base, ...overrides })).toEqual({
      isLive: true,
      atLiveEdge: true
    });
  });
});

describe('at-edge threshold', () => {
  test.each<[number, boolean]>([
    [2, true],
    [2.5, false]
  ])(
    'counts a distance of %s as at the edge: %s, against an explicit 2',
    (behind, atLiveEdge) => {
      expect(deriveLiveState({ ...base, currentTime: 600 - behind })).toEqual({
        isLive: true,
        atLiveEdge
      });
    }
  );

  test.each<[number]>([[0], [9.5], [10], [10.5], [30]])(
    'an omitted threshold answers a distance of %s the same as an explicit 10',
    (behind) => {
      const input = { ...untuned, currentTime: 600 - behind };
      expect(deriveLiveState(input)).toEqual(
        deriveLiveState({ ...input, atEdgeThreshold: 10 })
      );
    }
  );

  test('an omitted threshold is the shared 10 seconds, not zero', () => {
    expect(deriveLiveState({ ...untuned, currentTime: 591 })).toEqual({
      isLive: true,
      atLiveEdge: true
    });
    expect(deriveLiveState({ ...untuned, currentTime: 589 })).toEqual({
      isLive: true,
      atLiveEdge: false
    });
  });
});

describe('liveStateEqual', () => {
  test.each<[string, boolean]>([
    ['both null', true],
    ['same fields', true],
    ['one null', false],
    ['differing isLive', false],
    ['differing atLiveEdge', false]
  ])('answers %s with %s', (label, expected) => {
    const pairs: Record<
      string,
      [ReturnType<typeof deriveLiveState>, ReturnType<typeof deriveLiveState>]
    > = {
      'both null': [null, null],
      'same fields': [
        { isLive: true, atLiveEdge: true },
        { isLive: true, atLiveEdge: true }
      ],
      'one null': [null, { isLive: true, atLiveEdge: true }],
      'differing isLive': [
        { isLive: true, atLiveEdge: true },
        { isLive: false, atLiveEdge: true }
      ],
      'differing atLiveEdge': [
        { isLive: true, atLiveEdge: true },
        { isLive: true, atLiveEdge: false }
      ]
    };
    const pair = pairs[label];
    if (!pair) throw new Error(`No pair for ${label}`);
    expect(liveStateEqual(pair[0], pair[1])).toBe(expected);
  });

  test('is symmetric', () => {
    const a = deriveLiveState(base);
    const b = deriveLiveState({ ...base, currentTime: 300 });
    expect(liveStateEqual(a, b)).toBe(liveStateEqual(b, a));
  });
});
