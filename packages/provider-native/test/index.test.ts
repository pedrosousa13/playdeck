// @vitest-environment happy-dom

import { runInNewContext } from 'node:vm';
import { expect, test, vi } from 'vitest';
import type {
  MediaDimensions,
  ProviderAdapter,
  ProviderStateListener
} from '@reely/core';
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
