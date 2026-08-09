// @vitest-environment happy-dom

import { expect, test } from 'vitest';
import type { ProviderStatePatch } from '@reely/core';
import { createNativeProvider } from '../src/index';

type Timeline = {
  duration: number;
  currentTime: number;
  seekable: ReadonlyArray<readonly [number, number]>;
};

const makeTimeRanges = (
  ranges: ReadonlyArray<readonly [number, number]>
): TimeRanges =>
  ({
    length: ranges.length,
    start: (index: number) => ranges[index][0],
    end: (index: number) => ranges[index][1]
  }) as unknown as TimeRanges;

// Binds a mutable timeline to the element so a test can move the playhead and
// the seekable window between events, the way a live stream does.
const bindTimeline = (media: HTMLVideoElement, timeline: Timeline): void => {
  Object.defineProperty(media, 'duration', {
    configurable: true,
    get: () => timeline.duration
  });
  Object.defineProperty(media, 'currentTime', {
    configurable: true,
    get: () => timeline.currentTime,
    set: () => undefined
  });
  Object.defineProperty(media, 'seekable', {
    configurable: true,
    get: () => makeTimeRanges(timeline.seekable)
  });
};

const collect = (timeline: Timeline, src?: string) => {
  const media = document.createElement('video');
  if (src !== undefined) media.src = src;
  bindTimeline(media, timeline);
  const patches: ProviderStatePatch[] = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));
  return { media, patches, provider };
};

const livePatches = (
  patches: readonly ProviderStatePatch[]
): ReadonlyArray<ProviderStatePatch> =>
  patches.filter((patch) => 'live' in patch);

const lastLive = (
  patches: readonly ProviderStatePatch[]
): ProviderStatePatch['live'] => livePatches(patches).at(-1)?.live;

test('publishes live state from an endless duration and a seekable window', async () => {
  const timeline: Timeline = {
    duration: Number.POSITIVE_INFINITY,
    currentTime: 0,
    seekable: [[0, 30]]
  };
  const { patches, provider } = collect(timeline);

  await provider.attach();

  expect(lastLive(patches)).toEqual({ isLive: true, atLiveEdge: false });
});

test('never claims liveness for a finite source, even at a URL that says live', async () => {
  const timeline: Timeline = {
    duration: 120,
    currentTime: 0,
    seekable: [[0, 120]]
  };
  const { media, patches, provider } = collect(
    timeline,
    'https://example.com/live/live-stream-live.mp4'
  );

  await provider.attach();
  media.dispatchEvent(new Event('timeupdate'));
  media.dispatchEvent(new Event('progress'));

  // Non-empty first: the adapter really did publish state for this source, so
  // the liveness assertion below cannot pass on an empty patch set.
  expect(patches.length).toBeGreaterThan(0);
  expect(patches.every((patch) => (patch.live ?? null) === null)).toBe(true);
});

test('recomputes the at-edge flag as the playhead moves', async () => {
  const timeline: Timeline = {
    duration: Number.POSITIVE_INFINITY,
    currentTime: 0,
    seekable: [[0, 30]]
  };
  const { media, patches, provider } = collect(timeline);

  await provider.attach();
  expect(lastLive(patches)).toEqual({ isLive: true, atLiveEdge: false });

  timeline.currentTime = 28;
  media.dispatchEvent(new Event('timeupdate'));

  expect(lastLive(patches)).toEqual({ isLive: true, atLiveEdge: true });
});

test('recomputes the at-edge flag as the seekable window moves', async () => {
  const timeline: Timeline = {
    duration: Number.POSITIVE_INFINITY,
    currentTime: 28,
    seekable: [[0, 30]]
  };
  const { media, patches, provider } = collect(timeline);

  await provider.attach();
  expect(lastLive(patches)).toEqual({ isLive: true, atLiveEdge: true });

  timeline.seekable = [[0, 90]];
  media.dispatchEvent(new Event('progress'));

  expect(lastLive(patches)).toEqual({ isLive: true, atLiveEdge: false });
});

test('carries no live key while the derived value is unchanged', async () => {
  const timeline: Timeline = {
    duration: Number.POSITIVE_INFINITY,
    currentTime: 0,
    seekable: [[0, 30]]
  };
  const { media, patches, provider } = collect(timeline);

  await provider.attach();
  const before = patches.length;
  timeline.currentTime = 1;
  media.dispatchEvent(new Event('timeupdate'));
  media.dispatchEvent(new Event('progress'));
  media.dispatchEvent(new Event('canplay'));

  expect(livePatches(patches)).toHaveLength(1);
  // The unchanged events still publish what did change, and nothing more:
  // no standalone patch is emitted for a live value that stayed put.
  expect(patches.slice(before)).toEqual([
    { currentTime: 1 },
    { buffered: [], seekable: [{ start: 0, end: 30 }] },
    { buffering: false },
    expect.objectContaining({ currentTime: 1 })
  ]);
});

test('carries no live key when a retry reloads an unchanged source', async () => {
  const timeline: Timeline = {
    duration: Number.POSITIVE_INFINITY,
    currentTime: 0,
    seekable: [[0, 30]]
  };
  const { media, patches, provider } = collect(timeline);

  await provider.attach();
  expect(livePatches(patches)).toHaveLength(1);

  await provider.retry?.();
  media.dispatchEvent(new Event('loadedmetadata'));

  // A retry republishes the media state, but the liveness it derives is the one
  // already published, so no second `live` patch escapes.
  expect(livePatches(patches)).toHaveLength(1);
  expect(lastLive(patches)).toEqual({ isLive: true, atLiveEdge: false });
});

test('publishes live again when a retry reloads a changed source', async () => {
  const timeline: Timeline = {
    duration: Number.POSITIVE_INFINITY,
    currentTime: 0,
    seekable: [[0, 30]]
  };
  const { media, patches, provider } = collect(timeline);

  await provider.attach();
  expect(lastLive(patches)).toEqual({ isLive: true, atLiveEdge: false });

  await provider.retry?.();
  // The reloaded source comes back with a window whose end is within the
  // at-edge tolerance of the playhead, so the derived value really did move.
  timeline.seekable = [[0, 5]];
  media.dispatchEvent(new Event('loadedmetadata'));

  expect(livePatches(patches)).toHaveLength(2);
  expect(lastLive(patches)).toEqual({ isLive: true, atLiveEdge: true });
});
