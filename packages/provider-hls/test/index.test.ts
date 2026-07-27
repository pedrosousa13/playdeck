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
  const before = patches.length;

  hls.emitLevelUpdated(false);

  // Order-independent: asserting on `patches.at(-1)` alone would pass if the
  // singular handler refreshed the ladder and then emitted anything else.
  expect(patches.slice(before)).not.toContainEqual(
    expect.objectContaining({ qualities: expect.anything() })
  );

  hls.emitLevelsUpdated();

  expect(patches.at(-1)).toMatchObject({
    qualities: [{ id: 'hls:720x1280@2000000' }, { id: 'hls:360x640@800000' }]
  });
});

test('selects renditions by id and returns to automatic adaptation', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();
  hls.levels = [
    { height: 180, width: 320, bitrate: 400_000 },
    { height: 90, width: 160, bitrate: 150_000 }
  ];
  hls.emit(FakeHls.Events.MANIFEST_PARSED, { levels: hls.levels });

  await expect(provider.selectQuality?.('hls:90x160@150000')).resolves.toEqual({
    ok: true
  });
  expect(hls.currentLevel).toBe(1);
  expect(patches.at(-1)).toMatchObject({
    selectedQualityId: 'hls:90x160@150000'
  });

  await expect(provider.selectQuality?.(null)).resolves.toEqual({ ok: true });
  expect(hls.currentLevel).toBe(-1);
  expect(patches.at(-1)).toMatchObject({ selectedQualityId: null });

  await expect(
    provider.selectQuality?.('hls:720x1280@2000000')
  ).resolves.toEqual({ ok: false, reason: 'unsupported' });
  await expect(provider.selectQuality?.('')).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });
});

test('reports a pruned rung as unsupported rather than switching to a neighbour', async () => {
  const { provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();
  hls.levels = [
    { height: 1080, width: 1920, bitrate: 5_000_000 },
    { height: 360, width: 640, bitrate: 800_000 }
  ];
  hls.emit(FakeHls.Events.MANIFEST_PARSED, { levels: hls.levels });

  hls.levels = [hls.levels[1]!];
  hls.emitLevelsUpdated();
  hls.currentLevel = 0;

  await expect(
    provider.selectQuality?.('hls:1080x1920@5000000')
  ).resolves.toEqual({ ok: false, reason: 'unsupported' });
  expect(hls.currentLevel).toBe(0);

  // Paired with the rejection above so this test cannot pass by rejecting
  // every id: the rung that survived the prune is still selectable.
  await expect(provider.selectQuality?.('hls:360x640@800000')).resolves.toEqual(
    { ok: true }
  );
  expect(hls.currentLevel).toBe(0);
});

test('drops a held selection whose rung hls.js pruned, without fighting it for currentLevel', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();
  hls.levels = [
    { height: 1080, width: 1920, bitrate: 5_000_000 },
    { height: 360, width: 640, bitrate: 800_000 }
  ];
  hls.emit(FakeHls.Events.MANIFEST_PARSED, { levels: hls.levels });
  await provider.selectQuality?.('hls:1080x1920@5000000');
  expect(hls.currentLevel).toBe(0);

  hls.levels = [hls.levels[1]!];
  hls.emitLevelsUpdated();

  expect(patches.at(-1)).toMatchObject({
    qualities: [{ id: 'hls:360x640@800000' }],
    selectedQualityId: null
  });
  // hls.js owns recovery from its own pruning; the adapter must not have
  // written currentLevel while it was mid-way through that.
  expect(hls.currentLevel).toBe(0);
});

test('clears the ladder and the selection when the engine restarts', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const first = currentFakeHls();
  first.levels = [{ height: 720, width: 1280, bitrate: 2_000_000 }];
  first.emit(FakeHls.Events.MANIFEST_PARSED, { levels: first.levels });
  await provider.selectQuality?.('hls:720x1280@2000000');
  const beforeRetry = patches.length;

  await expect(provider.retry?.()).resolves.toEqual({ ok: true });

  expect(patches.slice(beforeRetry)).toContainEqual(
    expect.objectContaining({ qualities: [], selectedQualityId: null })
  );
});

// The capability and the list are one claim, so they may not disagree even
// briefly. Restarting empties the ladder, and until the new manifest parses
// the check genuinely has not happened again.
test('withdraws the quality capability while the restarted ladder is empty', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const first = currentFakeHls();
  first.levels = [{ height: 720, width: 1280, bitrate: 2_000_000 }];
  first.emit(FakeHls.Events.MANIFEST_PARSED, { levels: first.levels });
  expect(patches.at(-1)).toMatchObject({
    capabilities: { selectQuality: { status: 'available' } }
  });

  await expect(provider.retry?.()).resolves.toEqual({ ok: true });

  expect(patches.at(-1)).toMatchObject({
    qualities: [],
    capabilities: {
      selectQuality: { status: 'unknown', reason: 'provider-check' }
    }
  });
});

// retry() sets this verdict itself before restarting, so it cannot prove the
// restart path owns it. A second load() — reachable for a consumer holding an
// adapter from createHlsProvider directly — is the case that can.
test('withdraws the quality capability when a second load empties the ladder', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const first = currentFakeHls();
  first.levels = [{ height: 720, width: 1280, bitrate: 2_000_000 }];
  first.emit(FakeHls.Events.MANIFEST_PARSED, { levels: first.levels });

  await provider.load();

  expect(patches.at(-1)).toMatchObject({
    qualities: [],
    capabilities: {
      selectQuality: { status: 'unknown', reason: 'provider-check' }
    }
  });
});

test('clears the ladder when quality selection is downgraded by a fatal error', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();
  hls.levels = [{ height: 720, width: 1280, bitrate: 2_000_000 }];
  hls.emit(FakeHls.Events.MANIFEST_PARSED, { levels: hls.levels });
  await provider.selectQuality?.('hls:720x1280@2000000');

  hls.emitFatalError(FakeHls.ErrorTypes.NETWORK_ERROR);
  hls.emitFatalError(FakeHls.ErrorTypes.NETWORK_ERROR);
  hls.emitFatalError(FakeHls.ErrorTypes.NETWORK_ERROR);

  expect(patches.at(-1)).toMatchObject({
    lifecycle: 'error',
    quality: null,
    qualities: [],
    selectedQualityId: null,
    capabilities: {
      selectQuality: { status: 'unavailable', reason: 'provider' }
    }
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
  await expect(provider.selectQuality?.('hls:90x-@-')).resolves.toEqual({
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
  await expect(provider.selectQuality?.('hls:90x-@-')).resolves.toEqual({
    ok: true
  });
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

    // The newest capability-bearing patch, not the newest patch: `load()` also
    // emits the standalone `commandsReady` declaration (#69).
    expect(
      patches.filter((patch) => 'capabilities' in patch).at(-1)
    ).toMatchObject({
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

  // `createNativeProvider` is delegated to, so HLS inherits #71's route
  // gating: the picker API existing is no longer enough, and the capability
  // stays unavailable until WebKit announces a playback target.
  // Filtered because `load()` also emits the standalone `commandsReady`
  // declaration (#69), which would otherwise be the newest patch.
  expect(
    patches.filter((patch) => 'capabilities' in patch).at(-1)
  ).toMatchObject({
    capabilities: { airPlay: { status: 'unavailable', reason: 'provider' } }
  });

  const availability = new Event('webkitplaybacktargetavailabilitychanged');
  Object.defineProperty(availability, 'availability', {
    configurable: true,
    value: 'available'
  });
  media.dispatchEvent(availability);

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

// Pruning INSIDE a collision set, which the earlier stability test cannot
// reach because its fixture is deliberately made of distinct rungs. When a
// pair collapses to one, the survivor's `:<idx>` suffix disappears entirely —
// an id-only membership test drops a selection whose rung is still present
// while the engine stays pinned to it, so state reports auto while playback
// is locked to one level with no way back.
test('keeps a selection whose twin was pruned, under the survivor id', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();
  hls.levels = [
    { height: 1080, width: 1920, bitrate: 5_000_000 },
    { height: 1080, width: 1920, bitrate: 5_000_000 }
  ];
  hls.emit(FakeHls.Events.MANIFEST_PARSED, { levels: hls.levels });
  await provider.selectQuality?.('hls:1080x1920@5000000:0');
  expect(hls.currentLevel).toBe(0);

  hls.levels = [hls.levels[0]!];
  hls.emitLevelsUpdated();

  expect(patches.at(-1)).toMatchObject({
    qualities: [{ id: 'hls:1080x1920@5000000' }],
    selectedQualityId: 'hls:1080x1920@5000000'
  });
  expect(hls.currentLevel).toBe(0);
});

// The ordinal shifting down is the other half: an unconditional `:<idx>`
// suffix would not help here, because the survivor is renumbered rather than
// unsuffixed. Only matching on the collision-free base id covers both.
test('keeps a selection whose ordinal shifted when a lower twin was pruned', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();
  hls.levels = [
    { height: 1080, width: 1920, bitrate: 5_000_000 },
    { height: 1080, width: 1920, bitrate: 5_000_000 },
    { height: 1080, width: 1920, bitrate: 5_000_000 }
  ];
  hls.emit(FakeHls.Events.MANIFEST_PARSED, { levels: hls.levels });
  await provider.selectQuality?.('hls:1080x1920@5000000:2');

  hls.levels = [hls.levels[1]!, hls.levels[2]!];
  hls.emitLevelsUpdated();

  // Which surviving twin is adopted is not asserted, and must not be: rungs
  // sharing a base id are identical on every field this contract exposes, so
  // the choice is unobservable. What must hold is that the selection is still
  // a member of the published list.
  const patch = patches.at(-1) as {
    qualities: ReadonlyArray<{ id: string }>;
    selectedQualityId: string | null;
  };
  expect(patch.qualities).toHaveLength(2);
  expect(patch.selectedQualityId).not.toBeNull();
  expect(patch.qualities.map((quality) => quality.id)).toContain(
    patch.selectedQualityId
  );
});

// A rung that genuinely leaves must still drop the selection — otherwise the
// two tests above could be satisfied by never resetting at all.
test('drops a selection when no rung of its kind survives', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();
  hls.levels = [
    { height: 1080, width: 1920, bitrate: 5_000_000 },
    { height: 1080, width: 1920, bitrate: 5_000_000 },
    { height: 360, width: 640, bitrate: 800_000 }
  ];
  hls.emit(FakeHls.Events.MANIFEST_PARSED, { levels: hls.levels });
  await provider.selectQuality?.('hls:1080x1920@5000000:0');

  hls.levels = [hls.levels[2]!];
  hls.emitLevelsUpdated();

  expect(patches.at(-1)).toMatchObject({
    qualities: [{ id: 'hls:360x640@800000' }],
    selectedQualityId: null
  });
});

test('withdraws a stale unavailable verdict when an empty ladder restarts', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const first = currentFakeHls();
  first.levels = [];
  first.emit(FakeHls.Events.MANIFEST_PARSED, { levels: first.levels });
  expect(patches.at(-1)).toMatchObject({
    capabilities: {
      selectQuality: { status: 'unavailable', reason: 'source' }
    }
  });

  await provider.load();

  expect(patches.at(-1)).toMatchObject({
    capabilities: {
      selectQuality: { status: 'unknown', reason: 'provider-check' }
    }
  });
});

// The store half of the read/write pair. Every other assertion about
// `selectedQualityId` after a refresh expects `null`, which is equally
// satisfied by never recording the selection and by resetting it
// unconditionally — so without this, `hlsSelectedQualityId = id` is unbound.
test('keeps a held selection across a refresh that leaves its rung in place', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();
  hls.levels = [
    { height: 1080, width: 1920, bitrate: 5_000_000 },
    { height: 360, width: 640, bitrate: 800_000 }
  ];
  hls.emit(FakeHls.Events.MANIFEST_PARSED, { levels: hls.levels });
  await provider.selectQuality?.('hls:1080x1920@5000000');

  hls.levels = [hls.levels[0]!];
  hls.emitLevelsUpdated();

  expect(patches.at(-1)).toMatchObject({
    qualities: [{ id: 'hls:1080x1920@5000000' }],
    selectedQualityId: 'hls:1080x1920@5000000'
  });
});

// The race the fresh-derivation comment exists for: hls.js splices `levels`
// and the consumer clicks before LEVELS_UPDATED lands. Resolving against the
// cached list instead would switch to the wrong rung and report ok.
test('resolves selectQuality against the live levels array, not the last enumerated one', async () => {
  const { provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();
  hls.levels = [
    { height: 1080, width: 1920, bitrate: 5_000_000 },
    { height: 360, width: 640, bitrate: 800_000 }
  ];
  hls.emit(FakeHls.Events.MANIFEST_PARSED, { levels: hls.levels });

  hls.levels = [hls.levels[1]!];

  await expect(
    provider.selectQuality?.('hls:1080x1920@5000000')
  ).resolves.toEqual({ ok: false, reason: 'unsupported' });
  expect(hls.currentLevel).toBe(-1);
  await expect(provider.selectQuality?.('hls:360x640@800000')).resolves.toEqual(
    { ok: true }
  );
  expect(hls.currentLevel).toBe(0);
});

// The `:idx` tiebreak is otherwise bound only in the emitted list. A lookup
// matching on base id alone would leave every colliding rung unselectable
// while the suite stayed green.
test('selects a colliding rung by its disambiguated id', async () => {
  const { provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();
  hls.levels = [
    { height: 1080, width: 1920, bitrate: 5_000_000 },
    { height: 1080, width: 1920, bitrate: 5_000_000 }
  ];
  hls.emit(FakeHls.Events.MANIFEST_PARSED, { levels: hls.levels });

  await expect(
    provider.selectQuality?.('hls:1080x1920@5000000:1')
  ).resolves.toEqual({ ok: true });
  expect(hls.currentLevel).toBe(1);
});

// A second load() does not tear the first instance down, so its listeners stay
// live while `hls` points at the second. Without the generation guard a dead
// instance overwrites the live ladder.
test('ignores a stale hls.js instance refreshing the ladder after a second load', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const first = currentFakeHls();
  first.levels = [{ height: 720, width: 1280, bitrate: 2_000_000 }];
  first.emit(FakeHls.Events.MANIFEST_PARSED, { levels: first.levels });

  await provider.load();
  const second = currentFakeHls();
  second.levels = [{ height: 360, width: 640, bitrate: 800_000 }];
  second.emit(FakeHls.Events.MANIFEST_PARSED, { levels: second.levels });

  first.levels = [{ height: 144, width: 256, bitrate: 100_000 }];
  first.emitLevelsUpdated();

  expect(patches.at(-1)).toMatchObject({
    qualities: [{ id: 'hls:360x640@800000' }]
  });
});

// Without the `?? null`, an out-of-range index emits `quality: undefined`,
// which core reads as "no change" — so the previous rung would show as active
// forever.
test('reports no rendition when hls.js switches to an index outside the ladder', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();
  hls.levels = [{ height: 720, width: 1280, bitrate: 2_000_000 }];
  hls.emit(FakeHls.Events.MANIFEST_PARSED, { levels: hls.levels });

  hls.emit(FakeHls.Events.LEVEL_SWITCHED, { level: 3 });

  expect(patches.at(-1)).toEqual({ quality: null });
});

// The restart clear is otherwise asserted only through its emitted patch, so
// the two internal assignments could be deleted. Then a restarted ladder that
// happens to repeat the rung would re-publish a selection nobody made.
test('does not resurrect a held selection when the restarted ladder repeats the rung', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const first = currentFakeHls();
  first.levels = [{ height: 720, width: 1280, bitrate: 2_000_000 }];
  first.emit(FakeHls.Events.MANIFEST_PARSED, { levels: first.levels });
  await provider.selectQuality?.('hls:720x1280@2000000');

  await expect(provider.retry?.()).resolves.toEqual({ ok: true });
  const second = currentFakeHls();
  second.levels = [{ height: 720, width: 1280, bitrate: 2_000_000 }];
  second.emit(FakeHls.Events.MANIFEST_PARSED, { levels: second.levels });

  expect(patches.at(-1)).toMatchObject({
    qualities: [{ id: 'hls:720x1280@2000000' }],
    selectedQualityId: null
  });
});

// The restart guard's selection half: a rung selected against a levels array
// that was never enumerated leaves the list empty and the selection set.
test('clears a held selection on restart even when the ladder was never enumerated', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();
  hls.levels = [{ height: 720, width: 1280, bitrate: 2_000_000 }];
  await provider.selectQuality?.('hls:720x1280@2000000');

  await provider.load();

  expect(patches.at(-1)).toMatchObject({
    qualities: [],
    selectedQualityId: null,
    capabilities: {
      selectQuality: { status: 'unknown', reason: 'provider-check' }
    }
  });
});

test('derives an id for a level carrying no dimensions or bitrate at all', async () => {
  const { patches, provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const hls = currentFakeHls();
  hls.levels = [{}];

  hls.emit(FakeHls.Events.MANIFEST_PARSED, { levels: hls.levels });

  expect(patches.at(-1)).toMatchObject({
    qualities: [{ id: 'hls:-x-@-', height: null, width: null, bitrate: null }]
  });
});

test('destroys the previous hls.js instance when load runs twice', async () => {
  // #85. `retry()` tears down before restarting, but `load()` went straight to
  // `startHlsJs()`, so a second `load()` left the first instance attached to
  // the media element with its listeners live — still loading fragments and
  // holding memory until the page went away.
  //
  // Reachable for a consumer holding an adapter from `createHlsProvider`
  // directly, which is a public export. `PlayerController` itself calls
  // `load()` once per provider, and a source swap builds a new adapter.
  const { provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const first = currentFakeHls();
  expect(first.destroyed).toBe(false);

  await provider.load();
  const second = currentFakeHls();

  expect(second).not.toBe(first);
  expect(first.destroyed).toBe(true);
  expect(second.destroyed).toBe(false);
  expect(FakeHls.instances).toHaveLength(2);
});

test('destroys the previous hls.js instance on retry', async () => {
  // `retry()` used to call `teardownHls()` itself; #85 moved that into
  // `startHlsJs()` so starting owns it. This pins the behaviour retry lost the
  // explicit call for — without it, the move would be a silent regression here
  // rather than a refactor.
  const { provider } = createHarness(stubMseOnlySupport);
  await provider.attach();
  await provider.load();
  const first = currentFakeHls();

  await expect(provider.retry?.()).resolves.toEqual({ ok: true });
  const second = currentFakeHls();

  expect(second).not.toBe(first);
  expect(first.destroyed).toBe(true);
  expect(second.destroyed).toBe(false);
});

test('the native engine forwards the native adapter declaration', async () => {
  const harness = createHarness(stubNativeHlsSupport, 'native');
  vi.spyOn(harness.media, 'load').mockImplementation(() => undefined);

  await harness.provider.attach();
  expect(harness.patches).not.toContainEqual(
    expect.objectContaining({ commandsReady: true })
  );

  await harness.provider.load();
  expect(harness.patches).toContainEqual(
    expect.objectContaining({ commandsReady: true })
  );
});

// hls.js points `media.src` at an MSE blob inside attachMedia, which re-runs
// the load algorithm — declaring before MEDIA_ATTACHED would repeat the native
// clobber. MANIFEST_PARSED would be later than necessary, and would never
// arrive for a manifest that fails to parse.
test('the hls.js engine declares readiness on MEDIA_ATTACHED', async () => {
  const harness = createHarness(stubMseOnlySupport, 'hls.js');

  await harness.provider.attach();
  await harness.provider.load();
  expect(harness.patches).not.toContainEqual(
    expect.objectContaining({ commandsReady: true })
  );

  currentFakeHls().emitMediaAttached();

  expect(harness.patches).toContainEqual(
    expect.objectContaining({ commandsReady: true })
  );
});
