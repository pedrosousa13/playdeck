// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ProviderStatePatch } from '@playdeck/core';
import { createHlsProvider } from '../src/index';
import { FakeHls, fakeHlsLoader } from './fixtures/fake-hls';

// A deliberately neutral URL: nothing in the path hints at "live", proving
// liveness is derived from stream data and not from the source string.
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

const stubNativeHlsSupport = (media: HTMLVideoElement): void => {
  vi.spyOn(media, 'canPlayType').mockImplementation((type) =>
    type === 'application/vnd.apple.mpegurl' ? 'maybe' : ''
  );
  vi.stubGlobal('MediaSource', undefined);
};

const stubMseOnlySupport = (media: HTMLVideoElement): void => {
  vi.spyOn(media, 'canPlayType').mockReturnValue('');
  vi.stubGlobal('MediaSource', { isTypeSupported: () => true });
};

const currentFakeHls = (): FakeHls => {
  const instance = FakeHls.instances.at(-1);
  if (!instance) throw new Error('No fake hls.js instance was created.');
  return instance;
};

const lastWhere = <T>(
  items: readonly T[],
  predicate: (item: T) => unknown
): T | undefined => [...items].reverse().find((item) => predicate(item));

const collect = (
  media: HTMLVideoElement,
  support: (media: HTMLVideoElement) => void
) => {
  support(media);
  const loader = fakeHlsLoader();
  const provider = createHlsProvider(media, neutralSource, {
    loadHls: loader.loadHls
  });
  const patches: ProviderStatePatch[] = [];
  provider.subscribe((patch) => patches.push(patch));
  return { provider, patches };
};

test('derives live state from an infinite duration on the native engine, with a neutral URL', async () => {
  const media = document.createElement('video');
  const timeline: Timeline = {
    duration: Number.POSITIVE_INFINITY,
    currentTime: 0,
    seekable: [[0, 30]]
  };
  bindTimeline(media, timeline);
  const { patches, provider } = collect(media, stubNativeHlsSupport);

  await provider.attach();
  await provider.load();

  const livePatch = patches.find((patch) => patch.live !== undefined);
  expect(livePatch?.live).toEqual({ isLive: true, atLiveEdge: false });
  // Never a false fixed duration on a live stream.
  expect(
    patches.every(
      (patch) => patch.duration === undefined || patch.duration === null
    )
  ).toBe(true);
});

test('derives live state from the hls.js live flag and hides the finite media duration', async () => {
  const media = document.createElement('video');
  const timeline: Timeline = {
    duration: 3600,
    currentTime: 3590,
    seekable: [[3560, 3595]]
  };
  bindTimeline(media, timeline);
  const { patches, provider } = collect(media, stubMseOnlySupport);

  await provider.attach();
  await provider.load();
  currentFakeHls().emitLevelUpdated(true, 3593);

  const livePatch = lastWhere(patches, (patch) => patch.live !== undefined);
  expect(livePatch?.live).toEqual({ isLive: true, atLiveEdge: true });
  expect(livePatch?.duration ?? null).toBeNull();
});

test('tracks behind-edge and catch-up transitions as the current time moves', async () => {
  const media = document.createElement('video');
  const timeline: Timeline = {
    duration: 3600,
    currentTime: 3590,
    seekable: [[3560, 3595]]
  };
  bindTimeline(media, timeline);
  const { patches, provider } = collect(media, stubMseOnlySupport);

  await provider.attach();
  await provider.load();
  currentFakeHls().emitLevelUpdated(true, 3593);
  expect(lastWhere(patches, (p) => p.live)?.live).toMatchObject({
    atLiveEdge: true
  });

  timeline.currentTime = 3560;
  media.dispatchEvent(new Event('timeupdate'));
  expect(lastWhere(patches, (p) => p.live)?.live).toEqual({
    isLive: true,
    atLiveEdge: false
  });

  timeline.currentTime = 3592;
  media.dispatchEvent(new Event('timeupdate'));
  expect(lastWhere(patches, (p) => p.live)?.live).toEqual({
    isLive: true,
    atLiveEdge: true
  });
});

test('marks seeking unavailable when the live window is too small, and restores it as the window grows', async () => {
  const media = document.createElement('video');
  const timeline: Timeline = {
    duration: Number.POSITIVE_INFINITY,
    currentTime: 5,
    seekable: [[5, 5.3]]
  };
  bindTimeline(media, timeline);
  const { patches, provider } = collect(media, stubMseOnlySupport);

  await provider.attach();
  await provider.load();
  currentFakeHls().emitLevelUpdated(true, 5.2);

  const narrowed = lastWhere(patches, (patch) => patch.capabilities);
  expect(narrowed?.capabilities?.seek).toEqual({
    status: 'unavailable',
    reason: 'source'
  });

  timeline.seekable = [[0, 60]];
  timeline.currentTime = 58;
  media.dispatchEvent(new Event('progress'));

  const widened = lastWhere(patches, (patch) => patch.capabilities);
  expect(widened?.capabilities?.seek).toEqual({ status: 'available' });
});

test('resolves a live stream to a non-live end state without crashing when the playlist ends', async () => {
  const media = document.createElement('video');
  const timeline: Timeline = {
    duration: Number.POSITIVE_INFINITY,
    currentTime: 25,
    seekable: [[0, 30]]
  };
  bindTimeline(media, timeline);
  const { patches, provider } = collect(media, stubMseOnlySupport);

  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();
  hls.emitLevelUpdated(true, 29);
  expect(lastWhere(patches, (p) => p.live !== undefined)?.live).toMatchObject({
    isLive: true
  });

  // Stream ends: hls.js flips live off and the duration becomes finite.
  timeline.duration = 30;
  hls.emitLevelUpdated(false);

  const ended = lastWhere(patches, (patch) => patch.live !== undefined);
  expect(ended?.live).toBeNull();
  expect(ended?.duration).toBe(30);

  // The underlying element still ends cleanly.
  expect(() => media.dispatchEvent(new Event('ended'))).not.toThrow();
  expect(lastWhere(patches, (p) => p.playback !== undefined)?.playback).toBe(
    'ended'
  );
});

test('reuses the bounded network recovery on a live stream without corrupting live state', async () => {
  const media = document.createElement('video');
  const timeline: Timeline = {
    duration: Number.POSITIVE_INFINITY,
    currentTime: 28,
    seekable: [[0, 30]]
  };
  bindTimeline(media, timeline);
  const { patches, provider } = collect(media, stubMseOnlySupport);

  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();
  hls.emitLevelUpdated(true, 29);

  hls.emitFatalError(FakeHls.ErrorTypes.NETWORK_ERROR);

  expect(hls.startLoadCalls).toBe(1);
  expect(patches).not.toContainEqual(
    expect.objectContaining({ lifecycle: 'error' })
  );
});
