// @vitest-environment happy-dom

import { runInNewContext } from 'node:vm';
import { expect, test, vi } from 'vitest';
import type {
  MediaDimensions,
  PlayerError,
  ProviderAdapter,
  ProviderStateListener
} from '@playdeck/core';
import { createNativeProvider } from '../src/index';
import { captureRethrows } from './fixtures/capture-rethrows';

type ContractAdapter = {
  provider: ProviderAdapter;
  confirmPlayback: () => void;
};

const createFakeAdapter = (): ContractAdapter => {
  let listener: ProviderStateListener | undefined;
  return {
    provider: {
      provider: 'native',
      attach: () => undefined,
      load: () => undefined,
      destroy: () => (listener = undefined),
      subscribe: (nextListener) => {
        listener = nextListener;
        return () => (listener = undefined);
      },
      play: async () => ({ ok: true })
    },
    confirmPlayback: () => listener?.({ playback: 'playing' })
  };
};

const createNativeAdapter = (): ContractAdapter => {
  const media = document.createElement('video');
  vi.spyOn(media, 'play').mockResolvedValue(undefined);
  return {
    provider: createNativeProvider(media),
    confirmPlayback: () => media.dispatchEvent(new Event('playing'))
  };
};

const testProviderContract = (
  name: string,
  createAdapter: () => ContractAdapter
): void =>
  test(`${name} adapter conforms to lifecycle and event-confirmed playback`, async () => {
    const { confirmPlayback, provider } = createAdapter();
    const patches: unknown[] = [];
    provider.subscribe((patch) => patches.push(patch));

    await provider.attach();
    await provider.load();
    await expect(provider.play?.()).resolves.toEqual({ ok: true });
    expect(patches).not.toContainEqual(
      expect.objectContaining({ playback: 'playing' })
    );

    confirmPlayback();
    expect(patches).toContainEqual(
      expect.objectContaining({ playback: 'playing' })
    );

    const patchCount = patches.length;
    await provider.destroy();
    await provider.destroy();
    confirmPlayback();
    expect(patches).toHaveLength(patchCount);
  });

testProviderContract('fake', createFakeAdapter);
testProviderContract('native', createNativeAdapter);

test('reports native command failures without throwing', async () => {
  const media = document.createElement('video');
  const provider = createNativeProvider(media);
  vi.spyOn(media, 'play').mockRejectedValue(
    new DOMException('Playback was blocked.', 'NotAllowedError')
  );

  await expect(provider.play()).resolves.toMatchObject({
    ok: false,
    reason: 'blocked',
    error: { category: 'policy' }
  });
});

test('classifies a foreign-realm NotAllowedError as blocked', async () => {
  const media = document.createElement('video');
  const provider = createNativeProvider(media);
  const foreignError = runInNewContext(
    `Object.assign(new Error('foreign playback blocked'), {
      name: 'NotAllowedError'
    })`
  );
  expect(foreignError).not.toBeInstanceOf(DOMException);
  vi.spyOn(media, 'play').mockRejectedValue(foreignError);

  await expect(provider.play()).resolves.toMatchObject({
    ok: false,
    reason: 'blocked',
    error: {
      category: 'policy',
      message: 'foreign playback blocked'
    }
  });
});

test('contains synchronous native pause and retry command failures', async () => {
  const media = document.createElement('video');
  const provider = createNativeProvider(media);
  vi.spyOn(media, 'pause').mockImplementation(() => {
    throw new Error('pause failed');
  });
  vi.spyOn(media, 'load').mockImplementation(() => {
    throw new Error('reload failed');
  });

  await expect(provider.pause?.()).resolves.toMatchObject({
    ok: false,
    reason: 'provider-error',
    error: { message: 'pause failed' }
  });
  await expect(provider.retry?.()).resolves.toMatchObject({
    ok: false,
    reason: 'provider-error',
    error: { message: 'reload failed' }
  });
});

test('stops reporting events after destroy', async () => {
  const media = document.createElement('video');
  const provider = createNativeProvider(media);
  const listener = vi.fn();
  provider.subscribe(listener);

  await provider.destroy();
  media.dispatchEvent(new Event('ended'));

  expect(listener).not.toHaveBeenCalled();
});

test('loads once during ordinary lifecycle and retry forces a reload', async () => {
  const media = document.createElement('video');
  const load = vi.spyOn(media, 'load');
  const provider = createNativeProvider(media);

  await provider.load();
  await provider.load();
  await provider.retry?.();

  expect(load).toHaveBeenCalledTimes(2);
});

test('applies start and end boundaries to initial position and seeking', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'duration', { configurable: true, value: 20 });
  const provider = createNativeProvider(media, {
    startTime: 4,
    endTime: 12
  });
  await provider.attach();

  media.dispatchEvent(new Event('loadedmetadata'));
  expect(media.currentTime).toBe(4);

  await provider.seekTo?.(30);
  expect(media.currentTime).toBe(12);
  await provider.seekTo?.(-1);
  expect(media.currentTime).toBe(4);
});

test('clamps an initial start boundary to finite media duration', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'duration', { configurable: true, value: 5 });
  const provider = createNativeProvider(media, { startTime: 10 });
  await provider.attach();

  media.dispatchEvent(new Event('loadedmetadata'));

  expect(media.currentTime).toBe(5);
});

// Records every write to `currentTime` while answering reads from `position`,
// so a test can tell "the element ended up at 0" from "nothing asked it to go
// to 0" — the distinction #411 turns on, and one `expect(media.currentTime)`
// cannot make.
const trackPosition = (
  media: HTMLVideoElement,
  position: number,
  // Where the element ends up for a requested position, which is not always
  // where it was asked to go. A real element applies its own seek rules on the
  // setter — measured on 2026-09-01 against a 10s MP4 served without byte-range
  // support, chromium reported `seekable [[0,0]]`, took `currentTime = 5` and
  // read back 0 in the same statement, 3 of 3 runs. No DOM test environment
  // models that, so a test that needs it says so; the default honours the
  // request, which is what every test written before #465 assumed.
  settle: (requested: number) => number = (requested) => requested
): { rewind: () => void; writes: number[] } => {
  const writes: number[] = [];
  Object.defineProperty(media, 'currentTime', {
    configurable: true,
    get: () => position,
    set: (value: number) => {
      writes.push(value);
      position = settle(value);
    }
  });
  return {
    // The media load algorithm returns the playhead to 0 without any script
    // writing it, and `media.load()` is a stub in this DOM, so a test that
    // reloads has to say so itself.
    rewind: () => {
      position = 0;
    },
    writes
  };
};

// #411: the initial position was written on EVERY native load, the default
// `startTime` of 0 included, where the value asked for is the one the load
// algorithm has already put there. A same-value write is not a no-op — it
// starts a seek — and #407 measured what a seek into a partly-parsed WebKit
// element costs: the duration freezes, the element never recovers, and the
// player sits at 0:00 with the clip fully buffered behind it.
test('writes no initial position for the default zero start', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'duration', { configurable: true, value: 20 });
  const { writes } = trackPosition(media, 0);
  const provider = createNativeProvider(media);
  await provider.attach();

  media.dispatchEvent(new Event('loadedmetadata'));

  expect(writes).toEqual([]);
});

// The same holds for an `endTime`-only boundary, which leaves `startTime` at
// its default: the start of the window is still where the element already is.
test('writes no initial position for an end boundary alone', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'duration', { configurable: true, value: 20 });
  const { writes } = trackPosition(media, 0);
  const provider = createNativeProvider(media, { endTime: 12 });
  await provider.attach();

  media.dispatchEvent(new Event('loadedmetadata'));

  expect(writes).toEqual([]);
});

// A real `startTime` still reaches the element — the skip above is about the
// write that cannot move the playhead, not about the feature.
test('still writes a real initial start position exactly once', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'duration', { configurable: true, value: 20 });
  const { writes } = trackPosition(media, 0);
  const provider = createNativeProvider(media, { startTime: 4 });
  await provider.attach();

  media.dispatchEvent(new Event('loadedmetadata'));
  media.dispatchEvent(new Event('loadedmetadata'));

  expect(writes).toEqual([4]);
});

// And a `startTime` the element is already sitting on is the zero case in
// disguise: same value, same seek, same hazard, so it is skipped on the value
// rather than on `startTime === 0`.
test('writes no initial position the element already holds', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'duration', { configurable: true, value: 20 });
  const { writes } = trackPosition(media, 4);
  const provider = createNativeProvider(media, { startTime: 4 });
  await provider.attach();

  media.dispatchEvent(new Event('loadedmetadata'));

  expect(writes).toEqual([]);
});

// A retry reloads the source, and `media.load()` puts the playhead back at 0,
// so the reload gets the same treatment the first load did: the real start is
// re-applied, the zero start still writes nothing.
test('re-applies a real start position after a retry, and only that', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'duration', { configurable: true, value: 20 });
  vi.spyOn(media, 'load').mockImplementation(() => undefined);
  const { rewind, writes } = trackPosition(media, 0);
  const provider = createNativeProvider(media, { startTime: 4 });
  await provider.attach();
  media.dispatchEvent(new Event('loadedmetadata'));

  await provider.retry?.();
  rewind();
  media.dispatchEvent(new Event('loadedmetadata'));

  expect(writes).toEqual([4, 4]);
});

// A live source is the one case where the skipped write was not a same-value
// write, so it is the one place the behaviour visibly changes. `startTime` 0
// asks for 0, `withinMediaBounds` clamps that into the seekable window, and a
// DVR window that starts above 0 has no point at 0 — so the clamp used to
// return the back of the window and every load rewound the viewer there, off
// the live edge. Skipping the write leaves the engine's own position, which
// for a live stream is that edge. Asserted here because nothing else does:
// `e2e/live.spec.ts` asserts `at-edge` for hls.js, which held either way, and
// its native-HLS live test is skipped off macOS.
test('writes no initial position into a live seekable window', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'duration', {
    configurable: true,
    value: Number.POSITIVE_INFINITY
  });
  Object.defineProperty(media, 'seekable', {
    configurable: true,
    value: createTimeRanges([[100, 200]])
  });
  const { writes } = trackPosition(media, 200);
  const provider = createNativeProvider(media);
  await provider.attach();

  media.dispatchEvent(new Event('loadedmetadata'));

  expect(writes).toEqual([]);
  expect(media.currentTime).toBe(200);
});

// Collects the errors a provider publishes. The refusal below is emitted as a
// bare `{ error }` patch — no `lifecycle`, which is what keeps it a notice —
// so a test can assert on the errors alone without matching the rest of the
// patch stream (#418).
const trackErrors = (provider: ProviderAdapter): PlayerError[] => {
  const errors: PlayerError[] = [];
  provider.subscribe((patch) => {
    if (patch.error) errors.push(patch.error);
  });
  return errors;
};

// #418: the shape 51 of 60 real WebKit loads reported at `loadedmetadata` with
// `startTime: 5` on a 10s clip — a `<video>` that has not started playing
// reports `duration === 0` and an empty `seekable`, so the clamp answers 0,
// which is where the playhead already is. The write is correctly skipped and
// the offset is correctly not applied; what was wrong is that the consumer was
// told nothing about either.
test('reports a start position the empty WebKit seekable window refused', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'duration', { configurable: true, value: 0 });
  Object.defineProperty(media, 'seekable', {
    configurable: true,
    value: createTimeRanges([])
  });
  const { writes } = trackPosition(media, 0);
  const provider = createNativeProvider(media, { startTime: 5 });
  const errors = trackErrors(provider);
  await provider.attach();

  media.dispatchEvent(new Event('loadedmetadata'));

  expect(writes).toEqual([]);
  expect(errors).toEqual([
    expect.objectContaining({
      category: 'configuration',
      fatal: false,
      recoverable: false,
      severity: 'presentational'
    })
  ]);
});

// The same refusal where the clamp does land somewhere: a source still being
// parsed reports a duration and a seekable window that reach a fraction of the
// clip, so the requested 5s becomes 0.0278s. The write still happens — that
// part is unchanged — but it is not the position the consumer asked for.
test('reports a start position clamped into a partly-parsed window', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'duration', {
    configurable: true,
    value: 0.0278
  });
  Object.defineProperty(media, 'seekable', {
    configurable: true,
    value: createTimeRanges([[0, 0.0278]])
  });
  const { writes } = trackPosition(media, 0);
  const provider = createNativeProvider(media, { startTime: 5 });
  const errors = trackErrors(provider);
  await provider.attach();

  media.dispatchEvent(new Event('loadedmetadata'));

  expect(writes).toEqual([0.0278]);
  expect(errors).toHaveLength(1);
});

// The third refusal shape, and the one where nothing is written because no
// seekable range intersects the configured window at all: a declared duration
// of 10 with the window only parsed to 8.734 leaves `withinMediaBounds`
// answering `undefined` for a start above the edge. The offset is still
// dropped here — what is asserted is that the drop is now reported.
test('reports a start position no seekable range could satisfy', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'duration', { configurable: true, value: 10 });
  Object.defineProperty(media, 'seekable', {
    configurable: true,
    value: createTimeRanges([[0, 8.734]])
  });
  const { writes } = trackPosition(media, 0);
  const provider = createNativeProvider(media, { startTime: 9 });
  const errors = trackErrors(provider);
  await provider.attach();

  media.dispatchEvent(new Event('loadedmetadata'));

  expect(writes).toEqual([]);
  expect(errors).toEqual([
    expect.objectContaining({ category: 'configuration', fatal: false })
  ]);
});

// A start the source can satisfy is not a refusal, so it publishes nothing.
test('publishes no notice for a start position applied as asked', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'duration', { configurable: true, value: 20 });
  Object.defineProperty(media, 'seekable', {
    configurable: true,
    value: createTimeRanges([[0, 20]])
  });
  const { writes } = trackPosition(media, 0);
  const provider = createNativeProvider(media, { startTime: 4 });
  const errors = trackErrors(provider);
  await provider.attach();

  media.dispatchEvent(new Event('loadedmetadata'));

  expect(writes).toEqual([4]);
  expect(errors).toEqual([]);
});

// The element already sitting on the start writes nothing, and that is not a
// refusal either: the consumer got the position they asked for, so the notice
// is keyed on the position rather than on whether a write happened.
test('publishes no notice for a start position the element already holds', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'duration', { configurable: true, value: 20 });
  const { writes } = trackPosition(media, 4);
  const provider = createNativeProvider(media, { startTime: 4 });
  const errors = trackErrors(provider);
  await provider.attach();

  media.dispatchEvent(new Event('loadedmetadata'));

  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

// An ordinary zero-offset load asked for nothing, so it refuses nothing. This
// is #411's landed behaviour and the notice must not regress it.
test('publishes no notice for the default zero start', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'duration', { configurable: true, value: 0 });
  Object.defineProperty(media, 'seekable', {
    configurable: true,
    value: createTimeRanges([])
  });
  const { writes } = trackPosition(media, 0);
  const provider = createNativeProvider(media);
  const errors = trackErrors(provider);
  await provider.attach();

  media.dispatchEvent(new Event('loadedmetadata'));

  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

// The refusal is decided once per load, by the same `positioned` latch the
// write is: a repeat `loadedmetadata` republishes nothing, and a `retry` that
// resets the latch gets a fresh decision on the reloaded source.
test('reports the refusal once per load rather than on every metadata event', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'duration', { configurable: true, value: 0 });
  Object.defineProperty(media, 'seekable', {
    configurable: true,
    value: createTimeRanges([])
  });
  vi.spyOn(media, 'load').mockImplementation(() => undefined);
  const { rewind } = trackPosition(media, 0);
  const provider = createNativeProvider(media, { startTime: 5 });
  const errors = trackErrors(provider);
  await provider.attach();

  media.dispatchEvent(new Event('loadedmetadata'));
  media.dispatchEvent(new Event('loadedmetadata'));
  expect(errors).toHaveLength(1);

  await provider.retry?.();
  rewind();
  media.dispatchEvent(new Event('loadedmetadata'));

  expect(errors).toHaveLength(2);
});

// #465. The three tests above decided the refusal by predicting where the
// write would land, from the seekable window alone. These decide it from where
// the playhead actually is afterwards, and the difference is a whole class of
// silent failure: an element that reports a window covering the offset, takes
// the write, and does not move.
//
// The element with no seekable ranges at all is the grounded case. HTML's seek
// algorithm abandons the seek outright when `seekable` is empty ("If there are
// no ranges given in the seekable attribute then set the seeking IDL attribute
// to false and abort these steps"), so the write is legitimate to attempt —
// nothing has said the element will not seek — and the playhead not having
// moved is the only thing that can report it.
test('reports a start position the element did not move to', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'duration', { configurable: true, value: 10 });
  Object.defineProperty(media, 'seekable', {
    configurable: true,
    value: createTimeRanges([])
  });
  const { writes } = trackPosition(media, 0, () => 0);
  const provider = createNativeProvider(media, { startTime: 5 });
  const errors = trackErrors(provider);
  await provider.attach();

  media.dispatchEvent(new Event('loadedmetadata'));

  expect(writes).toEqual([5]);
  expect(errors).toEqual([
    expect.objectContaining({ category: 'configuration', fatal: false })
  ]);
});

// The same check catching a clamp rather than a refusal: the element takes the
// write and settles somewhere short of it. This is the shape #465 measured on
// firefox — `startTime: 9` against a window ending at 5.84 came to rest at
// 5.84 and stayed — and the position the viewer gets is not the one they
// configured, whoever did the clamping.
test('reports a start position the element clamped short', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'duration', { configurable: true, value: 10 });
  Object.defineProperty(media, 'seekable', {
    configurable: true,
    value: createTimeRanges([[0, 10]])
  });
  const { writes } = trackPosition(media, 0, () => 5.84);
  const provider = createNativeProvider(media, { startTime: 9 });
  const errors = trackErrors(provider);
  await provider.attach();

  media.dispatchEvent(new Event('loadedmetadata'));

  expect(writes).toEqual([9]);
  expect(errors).toHaveLength(1);
});

// The other half of #465: `seekable` decides whether the element will seek,
// and is no longer the thing the offset is clamped onto. A window that starts
// above the requested offset used to pull the playhead to its leading edge —
// a position nobody asked for. This is not #407's shape, which is a window
// that reaches the offset's own side of the clip and grows with the duration
// — `reports a start position clamped into a partly-parsed window` above is
// that one, and it still writes the edge. A live source is where this shape
// occurs: the DVR window opens at 100, the element sits on the live edge, and a
// `startTime` below the window is now refused rather than answered with the
// back of the window. `startTime: 0` already declined to do this for its own
// reasons — see `NativePlaybackOptions.startTime`.
test('writes no initial position onto the nearest seekable edge', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'duration', {
    configurable: true,
    value: Number.POSITIVE_INFINITY
  });
  Object.defineProperty(media, 'seekable', {
    configurable: true,
    value: createTimeRanges([[100, 200]])
  });
  const { writes } = trackPosition(media, 200);
  const provider = createNativeProvider(media, { startTime: 5 });
  const errors = trackErrors(provider);
  await provider.attach();

  media.dispatchEvent(new Event('loadedmetadata'));

  expect(writes).toEqual([]);
  expect(media.currentTime).toBe(200);
  expect(errors).toHaveLength(1);
});

// The measured chromium refusal, and the reason `duration` cannot be the only
// bound. `seekable [[0,0]]` alongside a correct `duration` of 10 is not a
// window that has yet to populate: #465 waited for `readyState 4`,
// `networkState 1` and `buffered [[0,10]]` and the write still landed at 0,
// 6 of 6 runs. Bounding on `duration` alone would write 5 into an element that
// will not take it and report success.
test('writes nothing into an element whose seekable window is empty of span', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'duration', { configurable: true, value: 10 });
  Object.defineProperty(media, 'seekable', {
    configurable: true,
    value: createTimeRanges([[0, 0]])
  });
  const { writes } = trackPosition(media, 0, () => 0);
  const provider = createNativeProvider(media, { startTime: 5 });
  const errors = trackErrors(provider);
  await provider.attach();

  media.dispatchEvent(new Event('loadedmetadata'));

  expect(writes).toEqual([]);
  expect(errors).toHaveLength(1);
});

// A start inside the media's real length on a source still being parsed: the
// declared duration reaches 10 while the window has only reached 5.84 — the
// firefox shape #465 measured on an origin without byte-range support. The
// offset is inside both, so it applies and says nothing.
test('applies a start position inside a partly-parsed seekable window', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'duration', { configurable: true, value: 10 });
  Object.defineProperty(media, 'seekable', {
    configurable: true,
    value: createTimeRanges([[0, 5.84]])
  });
  const { writes } = trackPosition(media, 0);
  const provider = createNativeProvider(media, { startTime: 5 });
  const errors = trackErrors(provider);
  await provider.attach();

  media.dispatchEvent(new Event('loadedmetadata'));

  expect(writes).toEqual([5]);
  expect(media.currentTime).toBe(5);
  expect(errors).toEqual([]);
});

// The common case, and the one most at risk from this change: any origin that
// serves byte ranges reports a fully populated window at the first
// `loadedmetadata` — `seekable [[0,10]]` on a 10s clip, 24 of 24 runs across
// chromium and firefox on 2026-09-01. Nothing about it is new, and nothing
// about it may change: one write, of the offset asked for, and no notice.
test('applies a start position into a fully populated seekable window', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'duration', { configurable: true, value: 10 });
  Object.defineProperty(media, 'seekable', {
    configurable: true,
    value: createTimeRanges([[0, 10]])
  });
  const { writes } = trackPosition(media, 0);
  const provider = createNativeProvider(media, { startTime: 5 });
  const errors = trackErrors(provider);
  await provider.attach();

  media.dispatchEvent(new Event('loadedmetadata'));

  expect(writes).toEqual([5]);
  expect(media.currentTime).toBe(5);
  expect(errors).toEqual([]);
});

// A start beyond the media's real length keeps its bound, which is the property
// the issue insists on: `duration` is what refuses it, and it is refused
// observably. The playhead is left at the end of the media, unchanged from
// #418 — the notice reports the refusal, it does not undo the load.
test('refuses a start position beyond the media duration', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'duration', { configurable: true, value: 10 });
  Object.defineProperty(media, 'seekable', {
    configurable: true,
    value: createTimeRanges([[0, 10]])
  });
  const { writes } = trackPosition(media, 0);
  const provider = createNativeProvider(media, { startTime: 30 });
  const errors = trackErrors(provider);
  await provider.attach();

  media.dispatchEvent(new Event('loadedmetadata'));

  expect(writes).toEqual([10]);
  expect(errors).toHaveLength(1);
});

test('ends playback at the configured end boundary without looping', async () => {
  const media = document.createElement('video');
  const pause = vi.spyOn(media, 'pause');
  const patches: unknown[] = [];
  const provider = createNativeProvider(media, { startTime: 2, endTime: 5 });
  provider.subscribe((patch) => patches.push(patch));
  await provider.attach();
  media.currentTime = 5.5;

  media.dispatchEvent(new Event('timeupdate'));

  expect(media.currentTime).toBe(5);
  expect(pause).toHaveBeenCalledOnce();
  expect(patches).toContainEqual(
    expect.objectContaining({ playback: 'ended', currentTime: 5 })
  );
});

test('keeps boundary-induced pause confirmation in ended state', async () => {
  const media = document.createElement('video');
  vi.spyOn(media, 'pause');
  const patches: Array<{ playback?: string }> = [];
  const provider = createNativeProvider(media, { endTime: 5 });
  provider.subscribe((patch) => patches.push(patch));
  await provider.attach();
  patches.length = 0;
  media.currentTime = 5;

  media.dispatchEvent(new Event('timeupdate'));
  media.dispatchEvent(new Event('pause'));

  expect(patches.filter((patch) => patch.playback).at(-1)).toMatchObject({
    playback: 'ended'
  });
});

test('loops from the end boundary back to the configured start', async () => {
  const media = document.createElement('video');
  const play = vi.spyOn(media, 'play').mockResolvedValue(undefined);
  const provider = createNativeProvider(media, {
    loop: true,
    startTime: 2,
    endTime: 5
  });
  await provider.attach();
  media.currentTime = 5;

  media.dispatchEvent(new Event('timeupdate'));
  await Promise.resolve();

  expect(media.currentTime).toBe(2);
  expect(play).toHaveBeenCalledOnce();
});

test('loops a native ended event back to the configured start', async () => {
  const media = document.createElement('video');
  const play = vi.spyOn(media, 'play').mockResolvedValue(undefined);
  const patches: unknown[] = [];
  const provider = createNativeProvider(media, { loop: true, startTime: 2 });
  provider.subscribe((patch) => patches.push(patch));
  await provider.attach();
  patches.length = 0;
  media.currentTime = 8;

  media.dispatchEvent(new Event('ended'));
  await Promise.resolve();

  expect(media.currentTime).toBe(2);
  expect(play).toHaveBeenCalledOnce();
  expect(patches).not.toContainEqual(
    expect.objectContaining({ playback: 'ended' })
  );
});

test('reports an ended state when automatic loop replay is rejected', async () => {
  const media = document.createElement('video');
  vi.spyOn(media, 'play').mockRejectedValue(new Error('replay failed'));
  const patches: Array<Record<string, unknown>> = [];
  const provider = createNativeProvider(media, {
    loop: true,
    startTime: 2,
    endTime: 5
  });
  provider.subscribe((patch) => patches.push(patch));
  await provider.attach();
  media.dispatchEvent(new Event('playing'));
  patches.length = 0;
  media.currentTime = 5;

  media.dispatchEvent(new Event('timeupdate'));
  await Promise.resolve();
  await Promise.resolve();

  expect(patches.at(-1)).toMatchObject({
    playback: 'ended',
    buffering: false,
    seeking: false,
    error: { message: 'replay failed' }
  });
});

test('cancels queued loop replay and pauses active media on destroy', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'paused', {
    configurable: true,
    value: false
  });
  const play = vi.spyOn(media, 'play').mockResolvedValue(undefined);
  const pause = vi.spyOn(media, 'pause');
  const provider = createNativeProvider(media, { loop: true, endTime: 5 });
  await provider.attach();
  media.currentTime = 5;

  media.dispatchEvent(new Event('timeupdate'));
  await provider.destroy();
  await Promise.resolve();

  expect(play).not.toHaveBeenCalled();
  expect(pause).toHaveBeenCalledOnce();
});

test('cancels queued loop replay before explicit pause', async () => {
  const media = document.createElement('video');
  const play = vi.spyOn(media, 'play').mockResolvedValue(undefined);
  const pause = vi.spyOn(media, 'pause');
  const provider = createNativeProvider(media, { loop: true, endTime: 5 });
  await provider.attach();
  media.currentTime = 5;

  media.dispatchEvent(new Event('timeupdate'));
  await provider.pause();
  await Promise.resolve();

  expect(pause).toHaveBeenCalledOnce();
  expect(play).not.toHaveBeenCalled();
});

test('cancels queued loop replay before explicit retry', async () => {
  const media = document.createElement('video');
  const play = vi.spyOn(media, 'play').mockResolvedValue(undefined);
  const load = vi.spyOn(media, 'load');
  const provider = createNativeProvider(media, { loop: true, endTime: 5 });
  await provider.attach();
  media.currentTime = 5;

  media.dispatchEvent(new Event('timeupdate'));
  await provider.retry();
  await Promise.resolve();

  expect(load).toHaveBeenCalledOnce();
  expect(play).not.toHaveBeenCalled();
});

test('ignores a queued replay rejection after explicit pause cancels it', async () => {
  const media = document.createElement('video');
  let rejectPlay: ((cause: unknown) => void) | undefined;
  vi.spyOn(media, 'play').mockReturnValue(
    new Promise((_resolve, reject) => {
      rejectPlay = reject;
    })
  );
  vi.spyOn(media, 'pause');
  const patches: Array<Record<string, unknown>> = [];
  const provider = createNativeProvider(media, { loop: true, endTime: 5 });
  provider.subscribe((patch) => patches.push(patch));
  await provider.attach();
  media.currentTime = 5;

  media.dispatchEvent(new Event('timeupdate'));
  await Promise.resolve();
  await provider.pause();
  patches.length = 0;
  rejectPlay?.(new Error('canceled replay failed'));
  await Promise.resolve();
  await Promise.resolve();

  expect(patches).not.toContainEqual(
    expect.objectContaining({ error: expect.anything() })
  );
});

test('restarts play from the configured start after reaching the end boundary', async () => {
  const media = document.createElement('video');
  const play = vi.spyOn(media, 'play').mockResolvedValue(undefined);
  const provider = createNativeProvider(media, { startTime: 2, endTime: 5 });
  media.currentTime = 5;

  await expect(provider.play?.()).resolves.toEqual({ ok: true });

  expect(media.currentTime).toBe(2);
  expect(play).toHaveBeenCalledOnce();
});

test('restarts play from a nonzero start after natural media ended', async () => {
  const media = document.createElement('video');
  const play = vi.spyOn(media, 'play').mockResolvedValue(undefined);
  const provider = createNativeProvider(media, { startTime: 2 });
  await provider.attach();
  media.currentTime = 8;
  media.dispatchEvent(new Event('ended'));

  await expect(provider.play?.()).resolves.toEqual({ ok: true });

  expect(media.currentTime).toBe(2);
  expect(play).toHaveBeenCalledOnce();
});

test('retains a successful seek before play after playback ended', async () => {
  const media = document.createElement('video');
  vi.spyOn(media, 'play').mockResolvedValue(undefined);
  const playbackPatches: string[] = [];
  const provider = createNativeProvider(media, { startTime: 2, endTime: 8 });
  provider.subscribe((patch) => {
    if (patch.playback) playbackPatches.push(patch.playback);
  });
  await provider.attach();
  media.currentTime = 8;
  media.dispatchEvent(new Event('ended'));
  playbackPatches.length = 0;

  await expect(provider.seekTo(5)).resolves.toEqual({ ok: true });
  await expect(provider.play()).resolves.toEqual({ ok: true });

  expect(media.currentTime).toBe(5);
  expect(playbackPatches).toEqual([]);
  media.dispatchEvent(new Event('seeking'));
  media.dispatchEvent(new Event('seeked'));
  media.dispatchEvent(new Event('play'));
  expect(playbackPatches).toEqual(['paused', 'playing']);
});

test('clamps seeking to seekable ranges intersected with configured boundaries', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'seekable', {
    configurable: true,
    value: createTimeRanges([
      [0, 3],
      [7, 10]
    ])
  });
  const provider = createNativeProvider(media, { startTime: 4, endTime: 8 });

  await expect(provider.seekTo?.(4)).resolves.toEqual({ ok: true });

  expect(media.currentTime).toBe(7);
});

// Configured boundaries that fall in a gap between seekable ranges leave
// nowhere legal to land, so the command is refused rather than silently
// snapped to the nearest edge outside the caller's own bounds. Nothing
// asserted the empty-intersection branch before (#101).
test('refuses a seek when no seekable range intersects the configured boundaries', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'seekable', {
    configurable: true,
    value: createTimeRanges([
      [0, 3],
      [7, 10]
    ])
  });
  const provider = createNativeProvider(media, { startTime: 4, endTime: 6 });

  await expect(provider.seekTo?.(5)).resolves.toEqual({
    ok: false,
    reason: 'provider-error'
  });
  expect(media.currentTime).toBe(0);
});

test('emits one public play event for the native play and playing pair', async () => {
  const media = document.createElement('video');
  const eventTypes: string[] = [];
  const provider = createNativeProvider(media);
  provider.subscribe((_patch, event) => {
    if (event) eventTypes.push(event.type);
  });
  await provider.attach();

  media.dispatchEvent(new Event('play'));
  media.dispatchEvent(new Event('playing'));

  expect(eventTypes).toEqual(['play']);
});

test('reports native text tracks as unavailable when the command is unsupported', async () => {
  const media = document.createElement('video');
  const patches: Array<Record<string, unknown>> = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();

  expect(patches.at(-1)).toMatchObject({
    capabilities: {
      selectTextTrack: { status: 'unavailable', reason: 'source' }
    }
  });
  await expect(provider.selectTextTrack?.('missing')).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });
});

test('reports quality selection as unavailable rather than pending forever', async () => {
  const media = document.createElement('video');
  const patches: Array<Record<string, unknown>> = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();

  // `mediaCapabilities()` returns the same literal on every recomputation, so
  // an `unknown` verdict here would never resolve and a consumer gating a
  // quality menu on it would wait forever. A plain media element has no
  // ladder at all, which is `unavailable/source`.
  expect(patches.at(-1)).toMatchObject({
    capabilities: {
      selectQuality: { status: 'unavailable', reason: 'source' }
    }
  });
  expect(provider.selectQuality).toBeUndefined();
});

const createTimeRanges = (
  ranges: ReadonlyArray<readonly [number, number]>
): TimeRanges => ({
  length: ranges.length,
  start: (index) => ranges[index]?.[0] ?? 0,
  end: (index) => ranges[index]?.[1] ?? 0
});

test('reports seeking and ordered buffered and seekable ranges from media events', async () => {
  const media = document.createElement('video');
  Object.defineProperty(media, 'buffered', {
    configurable: true,
    value: createTimeRanges([
      [8, 10],
      [0, 4]
    ])
  });
  Object.defineProperty(media, 'seekable', {
    configurable: true,
    value: createTimeRanges([[0, 12]])
  });
  const patches: unknown[] = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));
  await provider.attach();
  patches.length = 0;

  await provider.seekTo?.(6);
  expect(patches).toEqual([]);
  media.dispatchEvent(new Event('seeking'));
  media.dispatchEvent(new Event('seeked'));
  media.dispatchEvent(new Event('progress'));

  expect(patches).toContainEqual(expect.objectContaining({ seeking: true }));
  expect(patches).toContainEqual(
    expect.objectContaining({ seeking: false, currentTime: 6 })
  );
  expect(patches).toContainEqual({
    buffered: [
      { start: 0, end: 4 },
      { start: 8, end: 10 }
    ],
    seekable: [{ start: 0, end: 12 }]
  });
});

test('waits for authoritative audio and rate events after successful commands', async () => {
  const media = document.createElement('video');
  const patches: unknown[] = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));
  await provider.attach();
  patches.length = 0;

  await expect(provider.setVolume?.(0.4)).resolves.toEqual({ ok: true });
  await expect(provider.mute?.()).resolves.toEqual({ ok: true });
  await expect(provider.setPlaybackRate?.(1.5)).resolves.toEqual({ ok: true });
  expect(patches).toEqual([]);

  media.dispatchEvent(new Event('volumechange'));
  media.dispatchEvent(new Event('ratechange'));
  expect(patches).toContainEqual(
    expect.objectContaining({ muted: true, volume: 0.4 })
  );
  expect(patches).toContainEqual(
    expect.objectContaining({ playbackRate: 1.5 })
  );
});

test('reports waiting, recovery, ended, and source errors from media events', async () => {
  const media = document.createElement('video');
  const patches: unknown[] = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));
  await provider.attach();
  patches.length = 0;

  media.dispatchEvent(new Event('waiting'));
  media.dispatchEvent(new Event('canplay'));
  media.dispatchEvent(new Event('ended'));
  Object.defineProperty(media, 'error', {
    configurable: true,
    value: { code: 4, message: 'unsupported source' }
  });
  media.dispatchEvent(new Event('error'));

  expect(patches).toContainEqual({ buffering: true });
  expect(patches).toContainEqual({ buffering: false });
  expect(patches).toContainEqual(
    expect.objectContaining({ playback: 'ended', buffering: false })
  );
  expect(patches).toContainEqual(
    expect.objectContaining({
      lifecycle: 'error',
      error: expect.objectContaining({
        category: 'source',
        message: 'unsupported source'
      })
    })
  );
});

test('clears active playback, buffering, and seeking on fatal media error', async () => {
  const media = document.createElement('video');
  const patches: Array<Record<string, unknown>> = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));
  await provider.attach();
  media.dispatchEvent(new Event('play'));
  media.dispatchEvent(new Event('waiting'));
  media.dispatchEvent(new Event('seeking'));
  Object.defineProperty(media, 'error', {
    configurable: true,
    value: { code: 3, message: 'fatal decode' }
  });

  media.dispatchEvent(new Event('error'));

  expect(patches.at(-1)).toMatchObject({
    lifecycle: 'error',
    activation: 'error',
    playback: 'paused',
    buffering: false,
    seeking: false,
    error: { fatal: true, message: 'fatal decode' }
  });
});

test('attaches and destroys idempotently and unregisters native listeners', async () => {
  const media = document.createElement('video');
  const add = vi.spyOn(media, 'addEventListener');
  const remove = vi.spyOn(media, 'removeEventListener');
  const provider = createNativeProvider(media);

  await provider.attach();
  await provider.attach();
  await provider.destroy();
  await provider.destroy();

  expect(add.mock.calls.filter(([type]) => type === 'play')).toHaveLength(1);
  expect(remove.mock.calls.filter(([type]) => type === 'play')).toHaveLength(1);
});

test('reports and executes available fullscreen and picture-in-picture commands', async () => {
  const media = document.createElement('video');
  const requestFullscreen = vi.fn().mockResolvedValue(undefined);
  const requestPictureInPicture = vi.fn().mockResolvedValue(media);
  const exitFullscreen = vi.fn().mockResolvedValue(undefined);
  const exitPictureInPicture = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(media, 'requestFullscreen', {
    configurable: true,
    value: requestFullscreen
  });
  Object.defineProperty(media, 'requestPictureInPicture', {
    configurable: true,
    value: requestPictureInPicture
  });
  Object.defineProperty(document, 'exitFullscreen', {
    configurable: true,
    value: exitFullscreen
  });
  Object.defineProperty(document, 'exitPictureInPicture', {
    configurable: true,
    value: exitPictureInPicture
  });
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    value: media
  });
  Object.defineProperty(document, 'pictureInPictureElement', {
    configurable: true,
    value: media
  });
  const patches: Array<Record<string, unknown>> = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));

  try {
    await provider.attach();
    expect(patches.at(-1)).toMatchObject({
      capabilities: {
        fullscreen: { status: 'available' },
        pictureInPicture: { status: 'available' }
      }
    });
    await expect(provider.requestFullscreen?.()).resolves.toEqual({ ok: true });
    await expect(provider.exitFullscreen?.()).resolves.toEqual({ ok: true });
    await expect(provider.requestPictureInPicture?.()).resolves.toEqual({
      ok: true
    });
    await expect(provider.exitPictureInPicture?.()).resolves.toEqual({
      ok: true
    });
    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(exitFullscreen).toHaveBeenCalledOnce();
    expect(requestPictureInPicture).toHaveBeenCalledOnce();
    expect(exitPictureInPicture).toHaveBeenCalledOnce();
  } finally {
    Reflect.deleteProperty(document, 'exitFullscreen');
    Reflect.deleteProperty(document, 'exitPictureInPicture');
    Reflect.deleteProperty(document, 'fullscreenElement');
    Reflect.deleteProperty(document, 'pictureInPictureElement');
  }
});

test('uses the owner document and exits only media-owned presentation state', async () => {
  const ownerDocument = document.implementation.createHTMLDocument('owner');
  const media = ownerDocument.createElement('video');
  const otherMedia = ownerDocument.createElement('video');
  const exitFullscreen = vi.fn().mockResolvedValue(undefined);
  const exitPictureInPicture = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(ownerDocument, 'exitFullscreen', {
    configurable: true,
    value: exitFullscreen
  });
  Object.defineProperty(ownerDocument, 'exitPictureInPicture', {
    configurable: true,
    value: exitPictureInPicture
  });
  Object.defineProperty(ownerDocument, 'fullscreenElement', {
    configurable: true,
    value: otherMedia
  });
  Object.defineProperty(ownerDocument, 'pictureInPictureElement', {
    configurable: true,
    value: otherMedia
  });
  const provider = createNativeProvider(media);

  await expect(provider.exitFullscreen()).resolves.toEqual({ ok: true });
  await expect(provider.exitPictureInPicture()).resolves.toEqual({ ok: true });
  expect(exitFullscreen).not.toHaveBeenCalled();
  expect(exitPictureInPicture).not.toHaveBeenCalled();

  Object.defineProperty(ownerDocument, 'fullscreenElement', {
    configurable: true,
    value: media
  });
  Object.defineProperty(ownerDocument, 'pictureInPictureElement', {
    configurable: true,
    value: media
  });

  await expect(provider.exitFullscreen()).resolves.toEqual({ ok: true });
  await expect(provider.exitPictureInPicture()).resolves.toEqual({ ok: true });
  expect(exitFullscreen).toHaveBeenCalledOnce();
  expect(exitPictureInPicture).toHaveBeenCalledOnce();
});

test('reports unsupported fullscreen and picture-in-picture browser APIs consistently', async () => {
  const media = document.createElement('video');
  const patches: Array<Record<string, unknown>> = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();

  expect(patches.at(-1)).toMatchObject({
    capabilities: {
      fullscreen: { status: 'unavailable', reason: 'browser' },
      pictureInPicture: { status: 'unavailable', reason: 'browser' }
    }
  });
  await expect(provider.requestFullscreen?.()).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });
  await expect(provider.requestPictureInPicture?.()).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });
});

// #74: both readyState comparisons in emitMediaState read
// `HTMLMediaElement.HAVE_METADATA`, which happy-dom does not define. Since
// `1 >= undefined` was false, the provider could never leave
// 'loading-provider' in the unit environment — silently, with no error, so
// the missing coverage looked like a gap rather than a bug.
test('reaches ready once the media element reports metadata', async () => {
  const media = document.createElement('video');
  let readyState = 0;
  Object.defineProperty(media, 'readyState', {
    configurable: true,
    get: () => readyState
  });
  const patches: Array<Record<string, unknown>> = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));
  // The activation-bearing patches specifically: `load()` also emits the
  // standalone `commandsReady` declaration (#69), so the newest patch overall
  // is not necessarily the newest activation.
  const lastActivation = (): Record<string, unknown> | undefined =>
    patches.filter((patch) => 'activation' in patch).at(-1);

  await provider.attach();
  await provider.load();
  expect(lastActivation()).toMatchObject({
    activation: 'loading-provider',
    lifecycle: 'loading'
  });

  readyState = 1;
  media.dispatchEvent(new Event('loadedmetadata'));

  expect(lastActivation()).toMatchObject({
    activation: 'ready',
    lifecycle: 'ready'
  });
});

// The media load algorithm resets `playbackRate` to `defaultPlaybackRate`, so
// a rate applied before `media.load()` is silently reverted — the original #69
// symptom. Readiness is declared after it, not when the guards open.
test('native declares command readiness only after media.load()', async () => {
  const media = document.createElement('video');
  vi.spyOn(media, 'load').mockImplementation(() => undefined);
  const provider = createNativeProvider(media);
  const patches: Array<Record<string, unknown>> = [];
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();
  expect(patches).not.toContainEqual(
    expect.objectContaining({ commandsReady: true })
  );

  await provider.load();
  expect(patches).toContainEqual(
    expect.objectContaining({ commandsReady: true })
  );
});

// The ordering is the whole point: declared before `media.load()`, the
// declaration would be a lie, because the load undoes what was just applied.
test('native declares readiness after, not before, media.load() runs', async () => {
  const media = document.createElement('video');
  const order: string[] = [];
  vi.spyOn(media, 'load').mockImplementation(() => {
    order.push('media.load');
  });
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => {
    if (patch.commandsReady === true) order.push('commandsReady');
  });

  await provider.attach();
  await provider.load();

  expect(order).toEqual(['media.load', 'commandsReady']);
});

// `preload="none"` keeps activation at 'loading-provider' until a play
// triggers metadata load, while commands already land. That asymmetry is
// exactly what PR #72's `activation === 'ready'` signal got wrong.
test('native is command-ready while activation is still loading-provider', async () => {
  const media = document.createElement('video');
  media.preload = 'none';
  vi.spyOn(media, 'load').mockImplementation(() => undefined);
  const provider = createNativeProvider(media);
  const patches: Array<Record<string, unknown>> = [];
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();
  await provider.load();

  expect(patches).toContainEqual(
    expect.objectContaining({ commandsReady: true })
  );
  expect(patches).not.toContainEqual(
    expect.objectContaining({ activation: 'ready' })
  );
});

// happy-dom implements neither `videoWidth` nor `videoHeight` (both read
// `undefined`), so every dimension test defines them itself — the same
// mutable-getter shape the `readyState` test above uses.
const videoWithDimensions = (
  width: number | undefined,
  height: number | undefined
): { media: HTMLVideoElement; resize: (w: number, h: number) => void } => {
  const media = document.createElement('video');
  let current = { width, height };
  Object.defineProperty(media, 'videoWidth', {
    configurable: true,
    get: () => current.width
  });
  Object.defineProperty(media, 'videoHeight', {
    configurable: true,
    get: () => current.height
  });
  vi.spyOn(media, 'load').mockImplementation(() => undefined);
  return {
    media,
    resize: (w, h) => {
      current = { width: w, height: h };
      media.dispatchEvent(new Event('resize'));
    }
  };
};

const collectDimensions = (
  provider: ProviderAdapter
): Array<MediaDimensions | undefined> => {
  const subscribe = provider.subscribeDimensions;
  // Asserted, never optional-chained: an absent channel has to fail these
  // tests, not quietly satisfy every `toBeUndefined()` in them.
  expect(subscribe).toBeTypeOf('function');
  const seen: Array<MediaDimensions | undefined> = [];
  subscribe!((dimensions) => seen.push(dimensions));
  return seen;
};

test('native publishes the intrinsic dimensions at loadedmetadata', async () => {
  const { media } = videoWithDimensions(1080, 1920);
  const provider = createNativeProvider(media);
  const seen = collectDimensions(provider);

  await provider.attach();
  media.dispatchEvent(new Event('loadedmetadata'));

  expect(seen.at(-1)).toEqual({ width: 1080, height: 1920 });
});

// The intrinsic size changes mid-playback on adaptive renditions and on a
// `loadVideo`-style swap into the same element, and `resize` is the only event
// that reports it — `loadedmetadata` has already been and gone.
test('native republishes the intrinsic dimensions on resize', async () => {
  const { media, resize } = videoWithDimensions(1080, 1920);
  const provider = createNativeProvider(media);
  const seen = collectDimensions(provider);

  await provider.attach();
  media.dispatchEvent(new Event('loadedmetadata'));
  resize(1920, 1080);

  expect(seen.at(-1)).toEqual({ width: 1920, height: 1080 });
});

test('native reports unknown rather than a zero ratio', async () => {
  const { media } = videoWithDimensions(0, 0);
  const provider = createNativeProvider(media);
  const seen = collectDimensions(provider);

  await provider.attach();
  media.dispatchEvent(new Event('loadedmetadata'));

  expect(seen.at(-1)).toBeUndefined();
});

test('native reports unknown when the element exposes no intrinsic size', async () => {
  const { media } = videoWithDimensions(undefined, undefined);
  const provider = createNativeProvider(media);
  const seen = collectDimensions(provider);

  await provider.attach();
  media.dispatchEvent(new Event('loadedmetadata'));

  expect(seen.at(-1)).toBeUndefined();
});

test('native clears the dimensions on destroy', async () => {
  const { media } = videoWithDimensions(1080, 1920);
  const provider = createNativeProvider(media);
  const seen = collectDimensions(provider);

  await provider.attach();
  media.dispatchEvent(new Event('loadedmetadata'));
  await provider.destroy();

  expect(seen.at(-1)).toBeUndefined();
});

// `addListeners`/`removeListeners` mirror each other; a `resize` listener
// added to only one keeps the destroyed provider publishing off the element.
test('native stops observing resize after destroy', async () => {
  const { media, resize } = videoWithDimensions(1080, 1920);
  const provider = createNativeProvider(media);
  const seen = collectDimensions(provider);

  await provider.attach();
  media.dispatchEvent(new Event('loadedmetadata'));
  await provider.destroy();
  const afterDestroy = seen.length;
  resize(1920, 1080);

  expect(seen).toHaveLength(afterDestroy);
});

// --- subscriber isolation (#233) ---

const throwingListener = (): (() => never) => () => {
  throw new Error('subscriber blew up');
};

// #95, reached through the provider's own fan-out rather than the controller's
// (#233): a bare `Set.forEach` stops at the first throw, so every subscriber
// registered behind the thrower missed that notification — and the throw
// escaped into whatever called `emit`, here the adapter's own `attach`.
test('a throwing subscriber does not starve the subscribers behind it', () => {
  captureRethrows();
  const media = document.createElement('video');
  const provider = createNativeProvider(media);
  provider.subscribe(throwingListener());
  const after = vi.fn();
  provider.subscribe(after);

  expect(() => provider.attach()).not.toThrow();

  expect(after).toHaveBeenCalled();
});

// Isolated is not the same as silenced: the error is rethrown on a fresh task,
// so a consumer's broken listener still reaches the page's uncaught-error
// handling instead of disappearing into the adapter.
test('a throwing subscriber still surfaces its error asynchronously', async () => {
  const media = document.createElement('video');
  const provider = createNativeProvider(media);
  provider.attach();
  // Subscribed after attach, and the rethrows captured after that, so exactly
  // one emit — the `playing` below — is on trial here.
  provider.subscribe(throwingListener());
  const rethrows = captureRethrows();

  media.dispatchEvent(new Event('playing'));
  await Promise.resolve();

  expect(rethrows).toEqual([
    expect.objectContaining({ message: 'subscriber blew up' })
  ]);
});

// The dimension channel is its own set, iterated the same way.
test('a throwing dimension listener does not starve the listeners behind it', () => {
  captureRethrows();
  const { media } = videoWithDimensions(1080, 1920);
  const provider = createNativeProvider(media);
  provider.subscribeDimensions?.(throwingListener());
  const seen = collectDimensions(provider);

  provider.attach();
  media.dispatchEvent(new Event('loadedmetadata'));

  expect(seen.at(-1)).toEqual({ width: 1080, height: 1920 });
});

// --- an empty buffered reading is unknown, not none (#405) ---

// An element revises `buffered` between events, which is the whole of what
// #405 is about: a reading is a reading, not a verdict.
const videoWithMutableBuffered = (
  initial: ReadonlyArray<readonly [number, number]>
): {
  media: HTMLVideoElement;
  setBuffered: (ranges: ReadonlyArray<readonly [number, number]>) => void;
} => {
  const media = document.createElement('video');
  let buffered = createTimeRanges(initial);
  Object.defineProperty(media, 'buffered', {
    configurable: true,
    get: () => buffered
  });
  return {
    media,
    setBuffered: (ranges) => void (buffered = createTimeRanges(ranges))
  };
};

// Only the patches that carried the key: an omitted `buffered` and a published
// `[]` are the two outcomes under test, and `patch.buffered` alone reads
// `undefined` for both.
const publishedBuffered = (
  patches: ReadonlyArray<Record<string, unknown>>
): unknown[] =>
  patches.filter((patch) => 'buffered' in patch).map((patch) => patch.buffered);

const collectPatches = (
  provider: ProviderAdapter
): Array<Record<string, unknown>> => {
  const patches: Array<Record<string, unknown>> = [];
  provider.subscribe((patch) => patches.push(patch as Record<string, unknown>));
  return patches;
};

// The measured WebKit sequence from #405: a `progress` renders a range, the
// next `progress` reads empty while the data is plainly still there, and the
// `canplay` behind it took the indicator off the DOM.
test('never republishes an empty buffered over a non-empty one', async () => {
  const { media, setBuffered } = videoWithMutableBuffered([[0, 0.357423974]]);
  const provider = createNativeProvider(media);
  const patches = collectPatches(provider);
  await provider.attach();
  patches.length = 0;

  media.dispatchEvent(new Event('progress'));
  setBuffered([]);
  media.dispatchEvent(new Event('progress'));
  media.dispatchEvent(new Event('canplay'));

  expect(publishedBuffered(patches)).toEqual([
    [{ start: 0, end: 0.357423974 }]
  ]);
});

// `seekable` is not ambiguous and is not suppressed: `progress` is the event
// that reports the window moving, so it reports it on every one.
test('still publishes seekable on a progress whose buffered is withheld', async () => {
  const { media, setBuffered } = videoWithMutableBuffered([[0, 4]]);
  Object.defineProperty(media, 'seekable', {
    configurable: true,
    value: createTimeRanges([[0, 12]])
  });
  const provider = createNativeProvider(media);
  const patches = collectPatches(provider);
  await provider.attach();
  patches.length = 0;

  setBuffered([]);
  media.dispatchEvent(new Event('progress'));

  expect(patches).toEqual([{ seekable: [{ start: 0, end: 12 }] }]);
});

// The snapshot path — `canplay` and `loadedmetadata` reach `emitMediaState` —
// follows the same rule, and drops only the one key.
test('omits buffered from the media-state snapshot rather than emptying it', async () => {
  const { media, setBuffered } = videoWithMutableBuffered([[0, 4]]);
  const provider = createNativeProvider(media);
  const patches = collectPatches(provider);
  await provider.attach();
  patches.length = 0;

  setBuffered([]);
  media.dispatchEvent(new Event('loadedmetadata'));

  const snapshot = patches.at(-1)!;
  expect(snapshot).not.toHaveProperty('buffered');
  expect(snapshot).toMatchObject({
    lifecycle: expect.any(String),
    activation: expect.any(String),
    currentTime: expect.any(Number),
    duration: null,
    seekable: expect.any(Array),
    muted: expect.any(Boolean),
    volume: expect.any(Number),
    playbackRate: expect.any(Number),
    capabilities: expect.any(Object)
  });
});

// Firefox publishes several empty readings at `readyState` 0, before it has
// anything to report, and those are correct: with no non-empty reading behind
// it, empty is the answer.
test('publishes an empty buffered when no non-empty reading came before it', async () => {
  const { media } = videoWithMutableBuffered([]);
  const provider = createNativeProvider(media);
  const patches = collectPatches(provider);
  await provider.attach();

  media.dispatchEvent(new Event('progress'));

  expect(publishedBuffered(patches)).toEqual([[], []]);
});

// A DVR window slides: it drops ranges off its start as it moves, and every
// step of it is a non-empty reading. Nothing here may be mistaken for the
// empty case. Live by construction — an endless raw duration and a seekable
// window that moves with the buffered one — so the rule is exercised on the
// path a DVR stream actually takes, not on a finite element that merely slides.
test('publishes every step of a sliding buffered window on a live element', async () => {
  const { media, setBuffered } = videoWithMutableBuffered([[0, 30]]);
  let seekable = createTimeRanges([[0, 30]]);
  Object.defineProperty(media, 'duration', {
    configurable: true,
    value: Number.POSITIVE_INFINITY
  });
  Object.defineProperty(media, 'seekable', {
    configurable: true,
    get: () => seekable
  });
  // Both windows move together, the way a DVR stream's do: the seekable end is
  // what `deriveLiveState` measures the edge from, so a buffered window sliding
  // on its own would leave the derivation reading a stationary stream.
  const slideTo = (start: number, end: number): void => {
    setBuffered([[start, end]]);
    seekable = createTimeRanges([[start, end]]);
  };
  const provider = createNativeProvider(media);
  const patches = collectPatches(provider);
  await provider.attach();

  // The attach snapshot is what shows the element reached the live path at all
  // — a normalized `null` duration alongside a derived `live`. Without it the
  // assertion below would pass on any element that happens to slide.
  expect(patches.at(-1)).toMatchObject({
    duration: null,
    live: { isLive: true }
  });
  patches.length = 0;

  media.dispatchEvent(new Event('progress'));
  slideTo(10, 40);
  media.dispatchEvent(new Event('progress'));
  slideTo(20, 50);
  media.dispatchEvent(new Event('progress'));

  expect(publishedBuffered(patches)).toEqual([
    [{ start: 0, end: 30 }],
    [{ start: 10, end: 40 }],
    [{ start: 20, end: 50 }]
  ]);
});

// `emptied` is the reset point: it fires from the media load algorithm, where
// the buffer is gone rather than merely unreported.
test('clears the published buffered on emptied', async () => {
  const { media, setBuffered } = videoWithMutableBuffered([[0, 4]]);
  const provider = createNativeProvider(media);
  const patches = collectPatches(provider);
  await provider.attach();
  patches.length = 0;

  setBuffered([]);
  media.dispatchEvent(new Event('emptied'));

  expect(publishedBuffered(patches)).toEqual([[]]);
});

// `attachment.load()` calls `media.load()`, so `emptied` fires on every
// ordinary load. Announcing an empty buffered that was already empty is the
// empty patch this adapter refuses everywhere else.
test('stays silent on emptied when nothing non-empty was published', async () => {
  const { media } = videoWithMutableBuffered([]);
  const provider = createNativeProvider(media);
  const patches = collectPatches(provider);
  await provider.attach();
  patches.length = 0;

  media.dispatchEvent(new Event('emptied'));

  expect(publishedBuffered(patches)).toEqual([]);
});

// `addListeners`/`removeListeners` mirror each other; an `emptied` listener
// added to only one keeps the destroyed provider publishing off the element.
test('native stops observing emptied after destroy', async () => {
  const { media, setBuffered } = videoWithMutableBuffered([[0, 4]]);
  vi.spyOn(media, 'load').mockImplementation(() => undefined);
  const provider = createNativeProvider(media);
  const patches = collectPatches(provider);
  await provider.attach();
  await provider.destroy();
  patches.length = 0;

  setBuffered([]);
  media.dispatchEvent(new Event('emptied'));

  expect(patches).toEqual([]);
});

// The reset on a source change carries no code of its own, and this is the
// reason: the record belongs to the attachment, not to the element. A source
// switch builds a new provider over the same media element, so the one that
// follows retains nothing from the one before it and an empty reading from it
// is the answer rather than a withheld key. A record hoisted anywhere wider
// than the attachment factory would let the second provider inherit the
// first's ranges and go silent here, with nothing else to catch it.
test('gives a provider built after a swap a fresh buffered record', async () => {
  const { media, setBuffered } = videoWithMutableBuffered([[0, 4]]);
  const first = createNativeProvider(media);
  const firstPatches = collectPatches(first);
  await first.attach();
  expect(publishedBuffered(firstPatches)).toEqual([[{ start: 0, end: 4 }]]);
  await first.destroy();

  setBuffered([]);
  const second = createNativeProvider(media);
  const secondPatches = collectPatches(second);
  await second.attach();

  expect(publishedBuffered(secondPatches)).toEqual([[]]);
});
