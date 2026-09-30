// @vitest-environment happy-dom

import { expect, test } from 'vitest';
import { deriveLiveState } from '../src/index';

const base = {
  duration: Number.POSITIVE_INFINITY,
  seekable: [{ start: 0, end: 10 }],
  currentTime: 10,
  atEdgeThreshold: 2
} as const;

test('detects a live stream from infinite duration alone (neutral URL, no hint)', () => {
  // No isLiveHint and no URL involved: liveness comes purely from duration.
  expect(
    deriveLiveState({ ...base, duration: Number.POSITIVE_INFINITY })
  ).toEqual({ isLive: true, atLiveEdge: true, offsetFromEdge: 0 });
});

test('treats a finite duration with no live hint as not live', () => {
  expect(deriveLiveState({ ...base, duration: 120 })).toBeNull();
});

test('treats a NaN/unknown duration with no hint as not live without emitting NaN', () => {
  expect(deriveLiveState({ ...base, duration: Number.NaN })).toBeNull();
});

test('honors an explicit hls.js live hint even when duration is finite', () => {
  expect(
    deriveLiveState({ ...base, duration: 3600, isLiveHint: true })
  ).toEqual({ isLive: true, atLiveEdge: true, offsetFromEdge: 0 });
});

test('treats a false live hint as not live even when duration is infinite (stream ended)', () => {
  expect(
    deriveLiveState({
      ...base,
      duration: Number.POSITIVE_INFINITY,
      isLiveHint: false
    })
  ).toBeNull();
});

test('reports behind-edge when the current time trails the seekable end', () => {
  expect(deriveLiveState({ ...base, currentTime: 2 })).toEqual({
    isLive: true,
    atLiveEdge: false,
    offsetFromEdge: 8
  });
});

test('reports at-edge within the tolerance of the seekable end', () => {
  expect(deriveLiveState({ ...base, currentTime: 8.5 })).toEqual({
    isLive: true,
    atLiveEdge: true,
    offsetFromEdge: 2
  });
});

test('tracks a moving seekable window when computing the live edge', () => {
  // Window has slid forward: old segments dropped, edge advanced to 40.
  expect(
    deriveLiveState({
      ...base,
      seekable: [{ start: 30, end: 40 }],
      currentTime: 31
    })
  ).toEqual({ isLive: true, atLiveEdge: false, offsetFromEdge: 9 });
  expect(
    deriveLiveState({
      ...base,
      seekable: [{ start: 30, end: 40 }],
      currentTime: 39.5
    })
  ).toEqual({ isLive: true, atLiveEdge: true, offsetFromEdge: 1 });
});

test('prefers an explicit live edge over the seekable end', () => {
  // hls.js liveSyncPosition sits behind the raw seekable end (target latency).
  expect(
    deriveLiveState({
      ...base,
      seekable: [{ start: 0, end: 20 }],
      currentTime: 18,
      liveEdge: 18.5
    })
  ).toEqual({ isLive: true, atLiveEdge: true, offsetFromEdge: 1 });
});

test('never yields NaN or negative edge state with an empty seekable window', () => {
  const result = deriveLiveState({
    ...base,
    isLiveHint: true,
    seekable: [],
    currentTime: 0
  });
  expect(result).toEqual({ isLive: true, atLiveEdge: true, offsetFromEdge: 0 });
});

test('clamps a current time ahead of the edge to at-edge (never negative distance)', () => {
  // currentTime beyond the reported edge must not read as "behind".
  expect(
    deriveLiveState({
      ...base,
      seekable: [{ start: 0, end: 10 }],
      currentTime: 12
    })
  ).toEqual({ isLive: true, atLiveEdge: true, offsetFromEdge: 0 });
});
