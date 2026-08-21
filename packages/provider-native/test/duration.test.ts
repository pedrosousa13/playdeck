// @vitest-environment happy-dom

import { expect, test } from 'vitest';
import type { ProviderStatePatch } from '@playdeck/core';
import { createNativeProvider } from '../src/index';

// happy-dom's `duration` is a fixed `NaN`, so every test here installs a
// mutable getter and drives `durationchange` itself — the same shape the
// `readyState` and `videoWidth` tests in `index.test.ts` use. A growing
// duration is what WebKit publishes while it is still parsing, and no DOM
// test environment simulates it (#400).
const videoWithDuration = (
  initial: number
): {
  media: HTMLVideoElement;
  patches: ProviderStatePatch[];
  provider: ReturnType<typeof createNativeProvider>;
  reportDuration: (seconds: number) => void;
} => {
  const media = document.createElement('video');
  let duration = initial;
  Object.defineProperty(media, 'duration', {
    configurable: true,
    get: () => duration
  });
  const patches: ProviderStatePatch[] = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));
  return {
    media,
    patches,
    provider,
    reportDuration: (seconds) => {
      duration = seconds;
      media.dispatchEvent(new Event('durationchange'));
    }
  };
};

const lastDuration = (
  patches: readonly ProviderStatePatch[]
): ProviderStatePatch['duration'] =>
  patches.filter((patch) => 'duration' in patch).at(-1)?.duration;

// The measured defect: the element reaches 1.000333333 while player state
// still holds the 0.561893301 the last `canplay` read, so `SeekSlider`'s
// `max` stays a fraction of the clip for the whole session (#400).
test('publishes a duration that grows after canplay', async () => {
  const { media, patches, provider, reportDuration } =
    videoWithDuration(0.561893301);
  await provider.attach();
  media.dispatchEvent(new Event('canplay'));
  expect(lastDuration(patches)).toBe(0.561893301);
  patches.length = 0;

  reportDuration(1.000333333);

  expect(lastDuration(patches)).toBe(1.000333333);
});

// A narrow patch rather than the whole media-state snapshot: `durationchange`
// says one thing, so it publishes one key. Anything else in the patch would be
// a field this event has no news about.
test('carries the duration alone on durationchange', async () => {
  const { patches, provider, reportDuration } = videoWithDuration(0.343);
  await provider.attach();
  patches.length = 0;

  reportDuration(1.000333333);

  expect(patches).toEqual([{ duration: 1.000333333 }]);
});

test('keeps the last duration the element reported', async () => {
  const { patches, provider, reportDuration } = videoWithDuration(0.343);
  await provider.attach();

  reportDuration(0.675);
  reportDuration(0.818232624);
  reportDuration(1.000333333);

  expect(lastDuration(patches)).toBe(1.000333333);
});

// A `durationchange` after the last `canplay` is the whole point: the element
// converges roughly a second after playback has begun, long past the events
// that used to be the only ones publishing a duration.
test('publishes a duration that lands after the last canplay', async () => {
  const { media, patches, provider, reportDuration } = videoWithDuration(0.913);
  await provider.attach();
  media.dispatchEvent(new Event('loadedmetadata'));
  media.dispatchEvent(new Event('canplay'));
  media.dispatchEvent(new Event('playing'));

  reportDuration(1.000333333);

  expect(lastDuration(patches)).toBe(1.000333333);
});

// An endless duration normalizes to `null`, so every `durationchange` a live
// stream fires reports the value already published. Publishing it again would
// fan a state change out per event for no news at all.
test('stays silent while an endless duration keeps normalizing to null', async () => {
  const { patches, provider, reportDuration } = videoWithDuration(
    Number.POSITIVE_INFINITY
  );
  await provider.attach();
  expect(lastDuration(patches)).toBeNull();
  patches.length = 0;

  reportDuration(Number.POSITIVE_INFINITY);
  reportDuration(Number.POSITIVE_INFINITY);

  expect(patches).toEqual([]);
});

// `media.load()` resets the duration to `NaN` and fires one more
// `durationchange` on the way, and a VOD that reports the same duration twice
// has nothing to say either.
test('publishes a duration lost to a reload, then nothing for a repeat', async () => {
  const { patches, provider, reportDuration } = videoWithDuration(120);
  await provider.attach();
  patches.length = 0;

  reportDuration(Number.NaN);
  reportDuration(Number.NaN);

  expect(patches).toEqual([{ duration: null }]);
});

// The events that already published a duration keep publishing the whole
// media-state snapshot, `duration` among it: the new path adds a publisher, it
// does not replace one.
test('still publishes the duration canplay and loadedmetadata carry', async () => {
  const { media, patches, provider } = videoWithDuration(120);
  await provider.attach();
  patches.length = 0;

  media.dispatchEvent(new Event('loadedmetadata'));
  media.dispatchEvent(new Event('canplay'));

  expect(patches.filter((patch) => 'duration' in patch)).toHaveLength(2);
  expect(patches).toContainEqual(
    expect.objectContaining({ duration: 120, seekable: [], buffered: [] })
  );
});

test('stops publishing the duration after destroy', async () => {
  const { patches, provider, reportDuration } = videoWithDuration(0.343);
  await provider.attach();
  await provider.destroy();
  patches.length = 0;

  reportDuration(1.000333333);

  expect(patches).toEqual([]);
});
