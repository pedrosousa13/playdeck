// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type {
  ProviderAdapter,
  ProviderEvent,
  ProviderStatePatch
} from '@reely/core';
import { createHlsProvider } from '../src/index';
import { FakeHls, fakeHlsLoader } from './fixtures/fake-hls';

const source = { type: 'hls', src: '/hls/master.m3u8' } as const;

beforeEach(() => {
  FakeHls.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

const stubNoSupport = (media: HTMLVideoElement): void => {
  vi.spyOn(media, 'canPlayType').mockReturnValue('');
  vi.stubGlobal('MediaSource', undefined);
};

type Harness = {
  readonly media: HTMLVideoElement;
  readonly provider: ProviderAdapter;
  readonly patches: ProviderStatePatch[];
  readonly events: ProviderEvent[];
  readonly loaderCalls: () => number;
};

const createHarness = (
  support: (media: HTMLVideoElement) => void,
  engine?: 'auto' | 'native' | 'hls.js'
): Harness => {
  const media = document.createElement('video');
  support(media);
  const loader = fakeHlsLoader();
  const provider = createHlsProvider(
    media,
    { ...source, ...(engine ? { engine } : {}) },
    { loadHls: loader.loadHls }
  );
  const patches: ProviderStatePatch[] = [];
  const events: ProviderEvent[] = [];
  provider.subscribe((patch, event) => {
    patches.push(patch);
    if (event) events.push(event);
  });
  return { media, provider, patches, events, loaderCalls: loader.calls };
};

const currentFakeHls = (): FakeHls => {
  const instance = FakeHls.instances.at(-1);
  if (!instance) throw new Error('No fake hls.js instance was created.');
  return instance;
};

test('conforms to lifecycle and event-confirmed playback on the hls.js engine', async () => {
  const { media, patches, provider } = createHarness(stubMseOnlySupport);
  vi.spyOn(media, 'play').mockResolvedValue(undefined);

  await provider.attach();
  await provider.load();
  await expect(provider.play?.()).resolves.toEqual({ ok: true });
  expect(patches).not.toContainEqual(
    expect.objectContaining({ playback: 'playing' })
  );

  media.dispatchEvent(new Event('playing'));
  expect(patches).toContainEqual(
    expect.objectContaining({ playback: 'playing' })
  );

  const patchCount = patches.length;
  await provider.destroy();
  await provider.destroy();
  media.dispatchEvent(new Event('playing'));
  expect(patches).toHaveLength(patchCount);
});

test('reports the provider as hls with the effective engine in state', async () => {
  const nativeHarness = createHarness(stubNativeHlsSupport);
  expect(nativeHarness.provider.provider).toBe('hls');
  await nativeHarness.provider.attach();
  expect(nativeHarness.patches).toContainEqual(
    expect.objectContaining({ hlsEngine: 'native' })
  );

  const mseHarness = createHarness(stubMseOnlySupport);
  await mseHarness.provider.attach();
  expect(mseHarness.patches).toContainEqual(
    expect.objectContaining({ hlsEngine: 'hls.js' })
  );
});

test('plays natively without touching the hls.js loader', async () => {
  const { loaderCalls, media, provider } = createHarness(stubNativeHlsSupport);
  const load = vi.spyOn(media, 'load');

  await provider.attach();
  await provider.load();

  expect(media.getAttribute('src')).toBe('/hls/master.m3u8');
  expect(load).toHaveBeenCalledOnce();
  expect(loaderCalls()).toBe(0);
  expect(FakeHls.instances).toHaveLength(0);
});

test('imports hls.js once and wires the media element on the hls.js path', async () => {
  const { loaderCalls, media, provider } = createHarness(stubMseOnlySupport);
  const load = vi.spyOn(media, 'load');

  await provider.attach();
  await provider.load();

  expect(loaderCalls()).toBe(1);
  const hls = currentFakeHls();
  expect(hls.attachedMedia).toBe(media);
  expect(hls.loadedSource).toBe('/hls/master.m3u8');
  expect(media.getAttribute('src')).toBeNull();
  expect(load).not.toHaveBeenCalled();
});

test('surfaces a normalized unsupported error when no engine is possible', async () => {
  const { events, loaderCalls, patches, provider } =
    createHarness(stubNoSupport);

  await provider.attach();
  await provider.load();

  expect(patches.at(-1)).toMatchObject({
    lifecycle: 'error',
    activation: 'error',
    hlsEngine: null,
    error: {
      category: 'unsupported',
      fatal: true,
      message: expect.stringContaining('HLS is unsupported')
    }
  });
  expect(events).toContainEqual(
    expect.objectContaining({
      type: 'error',
      detail: expect.objectContaining({ category: 'unsupported' })
    })
  );
  expect(loaderCalls()).toBe(0);

  await expect(provider.retry?.()).resolves.toMatchObject({
    ok: false,
    reason: 'unsupported',
    error: { category: 'unsupported' }
  });
});

test('fails clearly when a forced engine is impossible', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport, 'native');

  await provider.attach();

  expect(patches.at(-1)).toMatchObject({
    lifecycle: 'error',
    error: {
      category: 'unsupported',
      fatal: true,
      message: expect.stringContaining('forced "native" HLS engine')
    }
  });
});

test('honors a forced hls.js engine even where native HLS exists', async () => {
  const media = document.createElement('video');
  vi.spyOn(media, 'canPlayType').mockReturnValue('maybe');
  vi.stubGlobal('MediaSource', { isTypeSupported: () => true });
  const loader = fakeHlsLoader();
  const provider = createHlsProvider(
    media,
    { ...source, engine: 'hls.js' },
    { loadHls: loader.loadHls }
  );

  await provider.attach();
  await provider.load();

  expect(loader.calls()).toBe(1);
  expect(currentFakeHls().attachedMedia).toBe(media);
});

test('reports quality selection honestly per engine', async () => {
  const nativeHarness = createHarness(stubNativeHlsSupport);
  await nativeHarness.provider.attach();
  expect(nativeHarness.patches.at(-1)).toMatchObject({
    capabilities: {
      selectQuality: { status: 'unavailable', reason: 'provider' }
    }
  });
  expect(nativeHarness.provider.selectQuality).toBeUndefined();

  const mseHarness = createHarness(stubMseOnlySupport);
  await mseHarness.provider.attach();
  expect(mseHarness.patches.at(-1)).toMatchObject({
    capabilities: {
      selectQuality: { status: 'unknown', reason: 'provider-check' }
    }
  });
  await mseHarness.provider.load();
  const hls = currentFakeHls();
  hls.levels = [{ height: 180 }, { height: 90 }];
  hls.emit(FakeHls.Events.MANIFEST_PARSED, { levels: hls.levels });
  expect(mseHarness.patches.at(-1)).toMatchObject({
    capabilities: { selectQuality: { status: 'available' } }
  });

  const emptyHarness = createHarness(stubMseOnlySupport);
  await emptyHarness.provider.attach();
  await emptyHarness.provider.load();
  const emptyHls = currentFakeHls();
  emptyHls.levels = [];
  emptyHls.emit(FakeHls.Events.MANIFEST_PARSED, { levels: emptyHls.levels });
  expect(emptyHarness.patches.at(-1)).toMatchObject({
    qualities: [],
    capabilities: {
      selectQuality: { status: 'unavailable', reason: 'source' }
    }
  });
});

test('reports the current rendition after hls.js level switches', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();
  hls.levels = [
    { height: 180, width: 320, bitrate: 400_000 },
    { height: 90, width: 160, bitrate: 150_000 }
  ];

  hls.emit(FakeHls.Events.LEVEL_SWITCHED, { level: 1 });

  expect(patches.at(-1)).toEqual({
    quality: {
      id: 'hls:90x160@150000',
      height: 90,
      width: 160,
      bitrate: 150_000
    }
  });
});

test('enumerates the hls.js ladder with content-derived ids', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();
  hls.levels = [
    { height: 180, width: 320, bitrate: 400_000 },
    { height: 90, width: 160, bitrate: 150_000 },
    { bitrate: 128_000 }
  ];

  hls.emit(FakeHls.Events.MANIFEST_PARSED, { levels: hls.levels });

  expect(patches.at(-1)).toMatchObject({
    qualities: [
      { id: 'hls:180x320@400000', height: 180, width: 320, bitrate: 400_000 },
      { id: 'hls:90x160@150000', height: 90, width: 160, bitrate: 150_000 },
      { id: 'hls:-x-@128000', height: null, width: null, bitrate: 128_000 }
    ],
    selectedQualityId: null,
    capabilities: { selectQuality: { status: 'available' } }
  });
});

test('keeps a single-rung ladder selectable', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();
  hls.levels = [{ height: 720, width: 1280, bitrate: 2_000_000 }];

  hls.emit(FakeHls.Events.MANIFEST_PARSED, { levels: hls.levels });

  expect(patches.at(-1)).toMatchObject({
    qualities: [{ id: 'hls:720x1280@2000000' }],
    capabilities: { selectQuality: { status: 'available' } }
  });
});

test('gives rungs identical on every exposed field distinct ids', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();
  hls.levels = [
    { height: 1080, width: 1920, bitrate: 5_000_000 },
    { height: 1080, width: 1920, bitrate: 5_000_000 }
  ];

  hls.emit(FakeHls.Events.MANIFEST_PARSED, { levels: hls.levels });

  const patch = patches.at(-1) as { qualities: ReadonlyArray<{ id: string }> };
  expect(patch.qualities.map((quality) => quality.id)).toEqual([
    'hls:1080x1920@5000000:0',
    'hls:1080x1920@5000000:1'
  ]);
});

// The trap this whole issue exists to avoid: hls.js prunes levels out of its
// own array after repeated errors, so an index-derived id would silently
// repoint a held selection at a different rung. The rungs here are
// deliberately DISTINCT — a fixture of identical rungs would make this fail
// for the unrelated `:idx` reason the design document calls out.
test('keeps quality ids stable when hls.js prunes a level', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();
  hls.levels = [
    { height: 1080, width: 1920, bitrate: 5_000_000 },
    { height: 720, width: 1280, bitrate: 2_000_000 },
    { height: 360, width: 640, bitrate: 800_000 }
  ];
  hls.emit(FakeHls.Events.MANIFEST_PARSED, { levels: hls.levels });

  hls.levels = [hls.levels[0]!, hls.levels[2]!];
  hls.emitLevelsUpdated();

  const patch = patches.at(-1) as { qualities: ReadonlyArray<{ id: string }> };
  expect(patch.qualities.map((quality) => quality.id)).toEqual([
    'hls:1080x1920@5000000',
    'hls:360x640@800000'
  ]);
});

// LEVELS_UPDATED (plural, the level array changed) is one letter from
// LEVEL_UPDATED (singular, one level's details), which this adapter already
// listens to for the live hint. Wiring the refresh to the wrong one would
// leave every other test in this file passing.
test('refreshes the ladder on LEVELS_UPDATED and not on LEVEL_UPDATED', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();
  hls.levels = [{ height: 720, width: 1280, bitrate: 2_000_000 }];
  hls.emit(FakeHls.Events.MANIFEST_PARSED, { levels: hls.levels });

  hls.levels = [
    { height: 720, width: 1280, bitrate: 2_000_000 },
    { height: 360, width: 640, bitrate: 800_000 }
  ];
  hls.emitLevelUpdated(false);

  expect(patches.at(-1)).not.toMatchObject({
    qualities: [{ id: 'hls:720x1280@2000000' }, { id: 'hls:360x640@800000' }]
  });

  hls.emitLevelsUpdated();

  expect(patches.at(-1)).toMatchObject({
    qualities: [{ id: 'hls:720x1280@2000000' }, { id: 'hls:360x640@800000' }]
  });
});

test('selects renditions by height and returns to automatic adaptation', async () => {
  const { provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();
  hls.levels = [{ height: 180 }, { height: 90 }];

  await expect(provider.selectQuality?.(90)).resolves.toEqual({ ok: true });
  expect(hls.currentLevel).toBe(1);

  await expect(provider.selectQuality?.(null)).resolves.toEqual({ ok: true });
  expect(hls.currentLevel).toBe(-1);

  await expect(provider.selectQuality?.(720)).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });
  await expect(provider.selectQuality?.(Number.NaN)).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });
});

test('downgrades quality selection on recovery exhaustion and restores it after retry', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const first = currentFakeHls();
  first.levels = [{ height: 180 }, { height: 90 }];
  first.emit(FakeHls.Events.MANIFEST_PARSED, { levels: first.levels });
  expect(patches.at(-1)).toMatchObject({
    capabilities: { selectQuality: { status: 'available' } }
  });

  first.emitFatalError(FakeHls.ErrorTypes.NETWORK_ERROR);
  first.emitFatalError(FakeHls.ErrorTypes.NETWORK_ERROR);
  first.emitFatalError(FakeHls.ErrorTypes.NETWORK_ERROR);

  expect(patches.at(-1)).toMatchObject({
    lifecycle: 'error',
    capabilities: {
      selectQuality: { status: 'unavailable', reason: 'provider' }
    }
  });
  await expect(provider.selectQuality?.(90)).resolves.toEqual({
    ok: false,
    reason: 'not-ready'
  });

  await expect(provider.retry?.()).resolves.toEqual({ ok: true });
  const second = currentFakeHls();
  second.levels = [{ height: 180 }, { height: 90 }];
  second.emit(FakeHls.Events.MANIFEST_PARSED, { levels: second.levels });

  expect(patches.at(-1)).toMatchObject({
    capabilities: { selectQuality: { status: 'available' } }
  });
  await expect(provider.selectQuality?.(90)).resolves.toEqual({ ok: true });
  expect(second.currentLevel).toBe(1);
});

test('bounds fatal network recovery and surfaces a normalized error', async () => {
  const { events, patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();

  hls.emitFatalError(FakeHls.ErrorTypes.NETWORK_ERROR);
  hls.emitFatalError(FakeHls.ErrorTypes.NETWORK_ERROR);
  expect(hls.startLoadCalls).toBe(2);
  expect(patches).not.toContainEqual(
    expect.objectContaining({ lifecycle: 'error' })
  );

  hls.emitFatalError(FakeHls.ErrorTypes.NETWORK_ERROR);

  expect(hls.startLoadCalls).toBe(2);
  expect(hls.destroyed).toBe(true);
  expect(patches.at(-1)).toMatchObject({
    lifecycle: 'error',
    activation: 'error',
    playback: 'paused',
    buffering: false,
    seeking: false,
    quality: null,
    error: {
      category: 'network',
      fatal: true,
      recoverable: true
    }
  });
  expect(events).toContainEqual(
    expect.objectContaining({
      type: 'error',
      detail: expect.objectContaining({ category: 'network' })
    })
  );
});

test('bounds fatal media recovery and surfaces a normalized decode error', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();

  hls.emitFatalError(FakeHls.ErrorTypes.MEDIA_ERROR);
  expect(hls.swapAudioCodecCalls).toBe(0);
  hls.emitFatalError(FakeHls.ErrorTypes.MEDIA_ERROR);
  expect(hls.recoverMediaErrorCalls).toBe(2);
  expect(hls.swapAudioCodecCalls).toBe(1);

  hls.emitFatalError(FakeHls.ErrorTypes.MEDIA_ERROR);

  expect(hls.recoverMediaErrorCalls).toBe(2);
  expect(hls.swapAudioCodecCalls).toBe(1);
  expect(hls.destroyed).toBe(true);
  expect(patches.at(-1)).toMatchObject({
    lifecycle: 'error',
    error: { category: 'decode', fatal: true, recoverable: true }
  });
});

test('surfaces unrecoverable fatal hls.js errors immediately', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();

  hls.emitFatalError('otherError', 'internalException');

  expect(hls.destroyed).toBe(true);
  expect(patches.at(-1)).toMatchObject({
    lifecycle: 'error',
    error: { category: 'provider', fatal: true }
  });
});

test('ignores non-fatal hls.js errors', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();
  const patchCount = patches.length;

  hls.emit(FakeHls.Events.ERROR, {
    type: FakeHls.ErrorTypes.NETWORK_ERROR,
    details: 'fragLoadError',
    fatal: false
  });

  expect(patches).toHaveLength(patchCount);
  expect(hls.startLoadCalls).toBe(0);
});

test('retry stays functional after recovery exhaustion', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const first = currentFakeHls();
  first.emitFatalError(FakeHls.ErrorTypes.NETWORK_ERROR);
  first.emitFatalError(FakeHls.ErrorTypes.NETWORK_ERROR);
  first.emitFatalError(FakeHls.ErrorTypes.NETWORK_ERROR);
  expect(first.destroyed).toBe(true);

  await expect(provider.retry?.()).resolves.toEqual({ ok: true });

  const second = currentFakeHls();
  expect(second).not.toBe(first);
  expect(second.attachedMedia).toBeDefined();
  expect(second.loadedSource).toBe('/hls/master.m3u8');

  const patchCount = patches.length;
  second.emitFatalError(FakeHls.ErrorTypes.NETWORK_ERROR);
  expect(second.startLoadCalls).toBe(1);
  expect(patches).toHaveLength(patchCount);
});

test('suppresses raw media element errors while hls.js owns recovery', async () => {
  const { patches, provider, media } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();

  Object.defineProperty(media, 'error', {
    configurable: true,
    value: { code: 3, message: 'transient decode' }
  });
  media.dispatchEvent(new Event('error'));

  expect(patches).not.toContainEqual(
    expect.objectContaining({ lifecycle: 'error' })
  );
});

test('passes native media element errors through on the native engine', async () => {
  const { patches, provider, media } = createHarness(stubNativeHlsSupport);
  await provider.attach();
  await provider.load();

  Object.defineProperty(media, 'error', {
    configurable: true,
    value: { code: 2, message: 'manifest fetch failed' }
  });
  media.dispatchEvent(new Event('error'));

  expect(patches.at(-1)).toMatchObject({
    lifecycle: 'error',
    error: { category: 'network', message: 'manifest fetch failed' }
  });
});

test('destroys the hls.js instance and stops all events on teardown', async () => {
  const { patches, provider, media } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();
  const patchCount = patches.length;

  await provider.destroy();

  expect(hls.destroyed).toBe(true);
  media.dispatchEvent(new Event('playing'));
  hls.emitFatalError(FakeHls.ErrorTypes.NETWORK_ERROR);
  expect(patches).toHaveLength(patchCount);
});

test('never creates an hls.js instance when destroyed during module loading', async () => {
  const media = document.createElement('video');
  stubMseOnlySupport(media);
  let resolveModule!: (module: { default: typeof FakeHls }) => void;
  const module = new Promise<{ default: typeof FakeHls }>((resolve) => {
    resolveModule = resolve;
  });
  const provider = createHlsProvider(media, source, {
    loadHls: () => module
  });
  await provider.attach();
  const loading = provider.load();

  await provider.destroy();
  resolveModule({ default: FakeHls });
  await loading;

  expect(FakeHls.instances).toHaveLength(0);
});

test('recreates a fresh instance per retry without leaking the previous one', async () => {
  const { provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const first = currentFakeHls();

  await expect(provider.retry?.()).resolves.toEqual({ ok: true });

  expect(first.destroyed).toBe(true);
  expect(FakeHls.instances).toHaveLength(2);
});

test('exposes picture-in-picture through the wrapper on both engines', async () => {
  for (const support of [stubNativeHlsSupport, stubMseOnlySupport]) {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    FakeHls.reset();
    const { media, patches, provider } = createHarness(support);
    const requestPictureInPicture = vi.fn().mockResolvedValue(media);
    Object.defineProperty(media, 'requestPictureInPicture', {
      configurable: true,
      value: requestPictureInPicture
    });

    await provider.attach();
    await provider.load();

    expect(patches.at(-1)).toMatchObject({
      capabilities: { pictureInPicture: { status: 'available' } }
    });
    await expect(provider.requestPictureInPicture?.()).resolves.toEqual({
      ok: true
    });
    expect(requestPictureInPicture).toHaveBeenCalledOnce();
    await expect(provider.exitPictureInPicture?.()).resolves.toEqual({
      ok: true
    });

    Object.defineProperty(document, 'pictureInPictureElement', {
      configurable: true,
      value: media
    });
    try {
      media.dispatchEvent(new Event('enterpictureinpicture'));
      expect(patches.at(-1)).toMatchObject({ pictureInPicture: true });
    } finally {
      Reflect.deleteProperty(document, 'pictureInPictureElement');
    }
  }
});

test('reports picture-in-picture as unavailable without browser support', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);

  await provider.attach();

  expect(patches.at(-1)).toMatchObject({
    capabilities: {
      pictureInPicture: { status: 'unavailable', reason: 'browser' }
    }
  });
  await expect(provider.requestPictureInPicture?.()).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });
});

test('detaches the native media source on destroy to abort buffering', async () => {
  const { media, provider } = createHarness(stubNativeHlsSupport);
  await provider.attach();
  await provider.load();
  expect(media.getAttribute('src')).toBe('/hls/master.m3u8');

  provider.destroy();

  expect(media.getAttribute('src')).toBeNull();
});

test('exposes the AirPlay picker through the wrapper on the native engine', async () => {
  const { media, patches, provider } = createHarness(stubNativeHlsSupport);
  const showPicker = vi.fn();
  Object.defineProperty(media, 'webkitShowPlaybackTargetPicker', {
    configurable: true,
    value: showPicker
  });

  await provider.attach();
  await provider.load();

  expect(patches.at(-1)).toMatchObject({
    capabilities: { airPlay: { status: 'available' } }
  });
  await expect(provider.showAirPlayPicker?.()).resolves.toEqual({ ok: true });
  expect(showPicker).toHaveBeenCalledOnce();
});

test('exposes fullscreen through the wrapper', async () => {
  const { media, patches, provider } = createHarness(stubMseOnlySupport);
  const requestFullscreen = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(media, 'requestFullscreen', {
    configurable: true,
    value: requestFullscreen
  });

  await provider.attach();

  expect(patches.at(-1)).toMatchObject({
    capabilities: { fullscreen: { status: 'available' } }
  });
  await expect(provider.requestFullscreen?.()).resolves.toEqual({ ok: true });
  expect(requestFullscreen).toHaveBeenCalledOnce();
});

test('fails hls.js startup with a normalized error when the module cannot load', async () => {
  const media = document.createElement('video');
  stubMseOnlySupport(media);
  const provider = createHlsProvider(media, source, {
    loadHls: () => Promise.reject(new Error('offline'))
  });
  const patches: ProviderStatePatch[] = [];
  provider.subscribe((patch) => patches.push(patch));
  await provider.attach();

  await provider.load();

  expect(patches.at(-1)).toMatchObject({
    lifecycle: 'error',
    error: { category: 'provider', fatal: true, recoverable: true }
  });
});

test('fails hls.js startup when the loaded module rejects the environment', async () => {
  const media = document.createElement('video');
  stubMseOnlySupport(media);
  FakeHls.supported = false;
  const loader = fakeHlsLoader();
  const provider = createHlsProvider(media, source, {
    loadHls: loader.loadHls
  });
  const patches: ProviderStatePatch[] = [];
  provider.subscribe((patch) => patches.push(patch));
  await provider.attach();

  await provider.load();

  expect(patches.at(-1)).toMatchObject({
    lifecycle: 'error',
    error: { category: 'unsupported', fatal: true }
  });
  expect(FakeHls.instances).toHaveLength(0);
});
