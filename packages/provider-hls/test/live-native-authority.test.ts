// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ProviderStatePatch } from '@playdeck/core';
import { createHlsProvider } from '../src/index';
import { FakeHls, fakeHlsLoader } from './fixtures/fake-hls';

// Neutral URL: nothing in the path hints at liveness on either adapter.
const neutralSource = { type: 'hls', src: '/stream/index.m3u8' } as const;

beforeEach(() => {
  FakeHls.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

// The native adapter derives liveness from the raw element duration alone; on
// the hls.js engine hls.js's own live flag is the authority, and the two can
// disagree — an endless element duration while the playlist has gone VOD. The
// native answer must not reach the listener.
test('drops the native adapter’s live value in favour of the hls.js derivation', async () => {
  const media = document.createElement('video');
  const timeline: Timeline = {
    duration: Number.POSITIVE_INFINITY,
    currentTime: 0,
    seekable: [[0, 30]]
  };
  bindTimeline(media, timeline);
  vi.spyOn(media, 'canPlayType').mockReturnValue('');
  vi.stubGlobal('MediaSource', { isTypeSupported: () => true });

  const loader = fakeHlsLoader();
  const provider = createHlsProvider(media, neutralSource, {
    loadHls: loader.loadHls
  });
  const patches: ProviderStatePatch[] = [];
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();
  await provider.load();

  // hls.js is the authority and says the playlist is not live.
  const hls = FakeHls.instances.at(-1);
  if (!hls) throw new Error('No fake hls.js instance was created.');
  hls.emitLevelUpdated(false);
  expect(patches.at(-1)?.live).toBeNull();
  patches.length = 0;

  // The native adapter still sees an endless duration, and the moving playhead
  // flips its own at-edge flag — a live value it publishes on its own patch.
  timeline.currentTime = 28;
  media.dispatchEvent(new Event('timeupdate'));
  timeline.seekable = [[0, 90]];
  media.dispatchEvent(new Event('progress'));
  media.dispatchEvent(new Event('canplay'));

  expect(patches.every((patch) => (patch.live ?? null) === null)).toBe(true);
  // And no empty patch escapes once the native `live` key is stripped.
  expect(patches.every((patch) => Object.keys(patch).length > 0)).toBe(true);
});
