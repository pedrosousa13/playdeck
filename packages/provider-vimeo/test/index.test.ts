// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true } }

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  detectSource,
  type MediaDimensions,
  type PlayerCapabilities,
  type ProviderAdapter,
  type ProviderEvent,
  type ProviderStateListener,
  type ProviderStatePatch,
  type TextCue,
  type VimeoSource
} from '@reely/core';
import { available } from '../src/adapter-values';
import { createVimeoAttachment } from '../src/attachment';
import { createVimeoBoundary } from '../src/boundary';
import { createVimeoChromelessAvailability } from '../src/chromeless-availability';
import {
  createVimeoProvider,
  type VimeoMountElement,
  type VimeoProviderOptions
} from '../src/index';
import type { VimeoSdkQuality } from '../src/loader';
import { createVimeoPlayback } from '../src/playback';
import { createVimeoPresentation } from '../src/presentation';
import { createVimeoQualityLevels } from '../src/quality-levels';
import { createVimeoTextTracks } from '../src/text-tracks';
import {
  createFakeSdk,
  namedError,
  type FakePlayerOptions,
  type FakeSdk
} from './fixtures/fake-sdk';

const sdkState = vi.hoisted(() => ({
  load: undefined as (() => Promise<unknown>) | undefined
}));

vi.mock('../src/loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/loader')>()),
  loadVimeoSdk: () =>
    sdkState.load
      ? sdkState.load()
      : Promise.reject(new Error('No fake Vimeo SDK is installed.'))
}));

const oembedResponse = (accountType: string): Response =>
  Response.json({ account_type: accountType, video_id: 76979871 });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => oembedResponse('pro'));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  sdkState.load = undefined;
});

const publicSource: VimeoSource = { type: 'vimeo', videoId: '76979871' };

type Setup = {
  readonly mount: VimeoMountElement;
  readonly sdk: FakeSdk;
  readonly provider: ReturnType<typeof createVimeoProvider>;
  readonly patches: ProviderStatePatch[];
  readonly events: ProviderEvent[];
  // Subscribed before `attach()`, as the controller does — attach publishes
  // the first measurement, so a later subscriber would miss it.
  readonly dimensions: Array<MediaDimensions | undefined>;
};

const setup = async ({
  fake = {},
  options,
  source = publicSource,
  prepareMount
}: {
  fake?: FakePlayerOptions;
  options?: VimeoProviderOptions;
  source?: VimeoSource;
  prepareMount?: (mount: VimeoMountElement) => void;
} = {}): Promise<Setup> => {
  const mount = document.createElement('div') as VimeoMountElement;
  document.body.appendChild(mount);
  prepareMount?.(mount);
  const sdk = createFakeSdk(fake);
  sdkState.load = () => Promise.resolve(sdk.Sdk);
  const provider = createVimeoProvider(mount, source, options);
  const patches: ProviderStatePatch[] = [];
  const events: ProviderEvent[] = [];
  provider.subscribe((patch, event) => {
    patches.push(patch);
    if (event) events.push(event);
  });
  const dimensions: Array<MediaDimensions | undefined> = [];
  provider.subscribeDimensions?.((next) => dimensions.push(next));
  await provider.attach();
  await provider.load();
  return { mount, sdk, provider, patches, events, dimensions };
};

const embedUrl = (setupResult: Setup): URL =>
  new URL(setupResult.sdk.instances[0]!.element.src);

const readyPatch = (patches: ProviderStatePatch[]): ProviderStatePatch => {
  const patch = patches.find((candidate) => candidate.lifecycle === 'ready');
  expect(patch).toBeDefined();
  return patch!;
};

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

// --- shared provider contract ---

type ContractAdapter = {
  provider: ProviderAdapter;
  confirmPlayback: () => void;
};

const createFakeContractAdapter = (): ContractAdapter => {
  let listener: ProviderStateListener | undefined;
  return {
    provider: {
      provider: 'vimeo',
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

const createVimeoContractAdapter = (): ContractAdapter => {
  const mount = document.createElement('div') as VimeoMountElement;
  document.body.appendChild(mount);
  const sdk = createFakeSdk();
  sdkState.load = () => Promise.resolve(sdk.Sdk);
  return {
    provider: createVimeoProvider(mount, publicSource),
    confirmPlayback: () =>
      sdk.instances[0]?.emit('play', { duration: 60, percent: 0, seconds: 0 })
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

testProviderContract('fake', createFakeContractAdapter);
testProviderContract('vimeo', createVimeoContractAdapter);

// --- embed construction ---

test('embeds a chromeless, Do-Not-Track, inline player by default', async () => {
  const result = await setup();
  const url = embedUrl(result);
  expect(url.origin).toBe('https://player.vimeo.com');
  expect(url.pathname).toBe('/video/76979871');
  expect(url.searchParams.get('controls')).toBe('0');
  expect(url.searchParams.get('dnt')).toBe('1');
  expect(url.searchParams.get('loop')).toBe('0');
  expect(url.searchParams.get('playsinline')).toBe('1');
  expect(url.searchParams.get('h')).toBeNull();
  const iframe = result.sdk.instances[0]!.element;
  expect(iframe.parentElement).toBe(result.mount);
  expect(iframe.getAttribute('allow')).toContain('autoplay');
  expect(iframe.getAttribute('allow')).toContain('fullscreen');
  expect(iframe.getAttribute('allow')).toContain('picture-in-picture');
  expect(iframe.getAttribute('allow')).not.toContain('encrypted-media');
  expect(iframe.getAttribute('referrerpolicy')).toBe(
    'strict-origin-when-cross-origin'
  );
});

test('preserves the privacy hash from the player URL form into the embed', async () => {
  const detected = detectSource(
    'https://player.vimeo.com/video/76979871/abc123DEF'
  );
  expect(detected.status).toBe('success');
  const source =
    detected.status === 'success' ? (detected.source as VimeoSource) : null;
  const result = await setup({ source: source! });
  const url = embedUrl(result);
  expect(url.pathname).toBe('/video/76979871');
  expect(url.searchParams.get('h')).toBe('abc123DEF');
});

test('preserves the privacy hash from the ?h= URL form into the embed', async () => {
  const detected = detectSource('https://vimeo.com/76979871?h=abc123DEF');
  expect(detected.status).toBe('success');
  const source =
    detected.status === 'success' ? (detected.source as VimeoSource) : null;
  const result = await setup({ source: source! });
  expect(embedUrl(result).searchParams.get('h')).toBe('abc123DEF');
});

test('produces a byte-identical embed URL for a valid numeric id without a hash', async () => {
  const result = await setup();
  expect(embedUrl(result).href).toBe(
    'https://player.vimeo.com/video/76979871?controls=0&dnt=1&loop=0&playsinline=1'
  );
});

test('produces a byte-identical embed URL for a valid numeric id with a hash', async () => {
  const result = await setup({
    source: { type: 'vimeo', videoId: '76979871', hash: 'abc123DEF' }
  });
  expect(embedUrl(result).href).toBe(
    'https://player.vimeo.com/video/76979871?h=abc123DEF&controls=0&dnt=1&loop=0&playsinline=1'
  );
});

// --- URL-builder defence in depth, independent of factory validation (#222) ---
//
// `createVimeoProvider`'s validation guard (below) is the only caller of
// `createVimeoAttachment` in this package, so proving the path-segment
// encoding is safe *on its own merits* -- Task 1's original acceptance
// criterion, "even with validation bypassed" -- means calling
// `createVimeoAttachment` directly, wired exactly the way the factory wires
// it, skipping only the guard. This is not a duplicate of the rejection
// tests below: those prove the factory never reaches the URL builder for a
// hostile id; this proves the URL builder is not itself relying on that
// guard to be safe.

// Wires the same seams `createVimeoProvider` composes, in the same order,
// minus its validation guard.
const attachWithoutValidation = async (
  videoId: string
): Promise<{ mount: VimeoMountElement; sdk: FakeSdk }> => {
  const mount = document.createElement('div') as VimeoMountElement;
  document.body.appendChild(mount);
  const sdk = createFakeSdk();
  sdkState.load = () => Promise.resolve(sdk.Sdk);
  const source: VimeoSource = { type: 'vimeo', videoId };
  const options: VimeoProviderOptions = {};
  const noopEmit = (): void => undefined;

  const chromeless = createVimeoChromelessAvailability({ source, options });
  const boundary = createVimeoBoundary(options);

  const playback = createVimeoPlayback(mount, {
    emit: noopEmit,
    isStale: (player) => attachment.isStale(player),
    getPlayer: () => attachment.getPlayer(),
    getCapabilities: playerCapabilities,
    boundary
  });

  const qualityLevels = createVimeoQualityLevels({
    emit: noopEmit,
    getPlayer: () => attachment.getPlayer()
  });

  const presentation = createVimeoPresentation({
    emit: noopEmit,
    getPlayer: () => attachment.getPlayer(),
    getCapabilities: playerCapabilities
  });

  const textTracks = createVimeoTextTracks({
    emit: noopEmit,
    isStale: (player) => attachment.isStale(player),
    getPlayer: () => attachment.getPlayer(),
    getCurrentTime: playback.getCurrentTime,
    getCapabilities: playerCapabilities
  });

  function playerCapabilities(): PlayerCapabilities {
    return {
      seek: available,
      setVolume: playback.setVolumeAvailability(),
      setPlaybackRate: playback.setPlaybackRateAvailability(),
      selectQuality: qualityLevels.selectQualityAvailability(),
      selectTextTrack: textTracks.selectTextTrackAvailability(),
      fullscreen: available,
      pictureInPicture: presentation.pictureInPictureAvailability(),
      airPlay: { status: 'unavailable', reason: 'provider' },
      customControls: chromeless.customControlsAvailability()
    };
  }

  const attachment = createVimeoAttachment(mount, source, {
    emit: noopEmit,
    options,
    getCapabilities: playerCapabilities,
    chromeless,
    playback,
    presentation,
    qualityLevels,
    textTracks,
    clearStateListeners: () => undefined
  });

  await attachment.attach();
  await attachment.load();

  return { mount, sdk };
};

test.each([
  ['a path traversal', '../../@evil.com/x'],
  ['a query string', '123?app_id=evil']
])(
  'encodes %s video id into the path segment rather than a new segment, query, or fragment, even with the factory guard bypassed',
  async (_form, videoId) => {
    const { sdk } = await attachWithoutValidation(videoId);
    const url = new URL(sdk.instances[0]!.element.src);
    expect(url.pathname).toBe(`/video/${encodeURIComponent(videoId)}`);
    expect(url.pathname.slice('/video/'.length).includes('/')).toBe(false);
    expect(url.origin).toBe('https://player.vimeo.com');
    expect([...url.searchParams.keys()].sort()).toEqual(
      ['controls', 'dnt', 'loop', 'playsinline'].sort()
    );
    expect(url.hash).toBe('');
  }
);

// --- rejected video id / hash (#222) ---
//
// The factory now validates `source.videoId` (and `source.hash`, when
// present) before composing anything, so a hostile id never reaches the URL
// builder at all in practice -- it is rejected at the factory instead. The
// encoding guard above proves that even so, the URL builder does not depend
// on this guard to be safe.

test.each([
  ['a path traversal', '../../@evil.com/x'],
  ['a query string', '123?app_id=evil']
])('rejects a video id that is %s', async (_form, videoId) => {
  const mount = document.createElement('div') as VimeoMountElement;
  document.body.appendChild(mount);
  const sdkLoad = vi.fn(() => Promise.resolve(createFakeSdk().Sdk));
  sdkState.load = sdkLoad;
  const provider = createVimeoProvider(mount, { type: 'vimeo', videoId });
  const patches: ProviderStatePatch[] = [];
  const events: ProviderEvent[] = [];
  provider.subscribe((patch, event) => {
    patches.push(patch);
    if (event) events.push(event);
  });

  await provider.attach();
  await provider.load();
  await provider.destroy();

  expect(patches).toContainEqual(
    expect.objectContaining({
      lifecycle: 'error',
      error: expect.objectContaining({
        category: 'source',
        fatal: true,
        recoverable: true
      })
    })
  );
  expect(patches[0]?.error?.message).not.toContain(videoId);
  expect(events.at(-1)).toMatchObject({ type: 'error' });

  // No iframe ever built or appended into the mount, and the Vimeo SDK
  // loader the real embed would call was never invoked. Scoped to this
  // test's own mount, not the whole document: earlier tests in this file
  // leave their own iframes appended to `document.body`.
  expect(mount.querySelector('iframe')).toBeNull();
  expect(sdkLoad).not.toHaveBeenCalled();

  // Every command on a rejected adapter is a no-op that resolves rather than
  // hangs or throws.
  await expect(provider.play()).resolves.toEqual({
    ok: false,
    reason: 'not-ready'
  });
});

// "A rejected Vimeo hash is treated the same as a rejected id" -- a valid
// videoId paired with an invalid hash still rejects.
test('rejects a valid video id paired with an invalid hash', async () => {
  const mount = document.createElement('div') as VimeoMountElement;
  document.body.appendChild(mount);
  const sdkLoad = vi.fn(() => Promise.resolve(createFakeSdk().Sdk));
  sdkState.load = sdkLoad;
  const provider = createVimeoProvider(mount, {
    type: 'vimeo',
    videoId: '76979871',
    hash: 'not a valid hash!'
  });
  const patches: ProviderStatePatch[] = [];
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();
  await provider.load();
  await provider.destroy();

  expect(patches).toContainEqual(
    expect.objectContaining({
      lifecycle: 'error',
      error: expect.objectContaining({
        category: 'source',
        fatal: true,
        recoverable: true
      })
    })
  );
  expect(mount.querySelector('iframe')).toBeNull();
  expect(sdkLoad).not.toHaveBeenCalled();
});

test('reports the rejected-id error to a subscriber that arrives late', async () => {
  const mount = document.createElement('div') as VimeoMountElement;
  document.body.appendChild(mount);
  const provider = createVimeoProvider(mount, {
    type: 'vimeo',
    videoId: '123?app_id=evil'
  });

  await provider.destroy();

  const patches: ProviderStatePatch[] = [];
  provider.subscribe((patch) => patches.push(patch));

  expect(patches).toContainEqual(
    expect.objectContaining({
      lifecycle: 'error',
      error: expect.objectContaining({ category: 'source', fatal: true })
    })
  );
});

test('seeds the embed muted state from the mount preference', async () => {
  const result = await setup({
    prepareMount: (mount) => {
      mount.muted = true;
    }
  });
  expect(embedUrl(result).searchParams.get('muted')).toBe('1');
});

test('applies seeded volume and playback rate preferences after ready', async () => {
  const result = await setup({
    prepareMount: (mount) => {
      mount.volume = 0.4;
      mount.playbackRate = 1.5;
    }
  });
  const player = result.sdk.instances[0]!;
  expect(player.setVolume).toHaveBeenCalledWith(0.4);
  expect(player.setPlaybackRate).toHaveBeenCalledWith(1.5);
});

// --- ready state ---

test('emits confirmed ready state from the embedded player', async () => {
  const tracks = [
    {
      language: 'en',
      kind: 'subtitles',
      label: 'English',
      mode: 'disabled' as const
    }
  ];
  const { patches } = await setup({
    fake: {
      duration: 62,
      muted: true,
      volume: 0.5,
      playbackRate: 1.25,
      textTracks: tracks
    },
    options: { customControls: true }
  });
  const ready = readyPatch(patches);
  expect(ready).toMatchObject({
    lifecycle: 'ready',
    activation: 'ready',
    playback: 'paused',
    duration: 62,
    muted: true,
    volume: 0.5,
    playbackRate: 1.25,
    seekable: [{ start: 0, end: 62 }]
  });
  expect(ready.capabilities).toMatchObject({
    seek: { status: 'available' },
    setVolume: { status: 'available' },
    selectTextTrack: { status: 'available' },
    fullscreen: { status: 'available' },
    customControls: { status: 'available' },
    selectQuality: { status: 'available' },
    airPlay: { status: 'unavailable', reason: 'provider' }
  });
});

test('reports text-track selection unavailable when the video has no tracks', async () => {
  const { patches } = await setup({ fake: { textTracks: [] } });
  const ready = readyPatch(patches);
  expect(ready.capabilities).toMatchObject({
    selectTextTrack: { status: 'unavailable', reason: 'source' }
  });
  expect(ready.textTracks).toEqual([]);
  expect(ready.selectedTextTrackId).toBeNull();
  expect(ready.captionRendering).toBe('unavailable');
});

// --- plan-gated chromeless controls ---

test('reports provider-plan when chromeless controls require an unavailable plan', async () => {
  fetchMock.mockResolvedValue(oembedResponse('basic'));
  const { patches } = await setup({ options: { customControls: true } });
  expect(readyPatch(patches).capabilities).toMatchObject({
    customControls: { status: 'unavailable', reason: 'provider-plan' }
  });
  expect(fetchMock).toHaveBeenCalledWith(
    'https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871',
    { signal: expect.any(AbortSignal) }
  );
});

test('resolves the plan for unlisted videos through the hashed watch URL', async () => {
  fetchMock.mockResolvedValue(oembedResponse('free'));
  const { patches } = await setup({
    source: { type: 'vimeo', videoId: '76979871', hash: 'abc123' },
    options: { customControls: true }
  });
  expect(readyPatch(patches).capabilities).toMatchObject({
    customControls: { status: 'unavailable', reason: 'provider-plan' }
  });
  expect(fetchMock).toHaveBeenCalledWith(
    'https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871%2Fabc123',
    { signal: expect.any(AbortSignal) }
  );
});

test('keeps chromeless capability unknown when the plan cannot be resolved', async () => {
  fetchMock.mockRejectedValue(new Error('offline'));
  const { patches } = await setup({ options: { customControls: true } });
  expect(readyPatch(patches).capabilities).toMatchObject({
    customControls: { status: 'unknown', reason: 'provider-check' }
  });
});

test('keeps chromeless capability unknown for unrecognized account tiers', async () => {
  fetchMock.mockResolvedValue(oembedResponse('future_tier'));
  const { patches } = await setup({ options: { customControls: true } });
  expect(readyPatch(patches).capabilities).toMatchObject({
    customControls: { status: 'unknown', reason: 'provider-check' }
  });
});

test('sends no oEmbed request when custom controls were not requested', async () => {
  fetchMock.mockImplementation(() => {
    throw new Error('fetch should not have been called');
  });
  const { patches } = await setup();
  expect(readyPatch(patches).capabilities).toMatchObject({
    customControls: { status: 'unknown', reason: 'provider-check' }
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('resolves a correct verdict for a paid tier only once custom controls are requested', async () => {
  fetchMock.mockResolvedValue(oembedResponse('pro'));
  const { patches } = await setup({ options: { customControls: true } });
  expect(readyPatch(patches).capabilities).toMatchObject({
    customControls: { status: 'available' }
  });
});

test('keeps Vimeo controls as the single layer when requested', async () => {
  const result = await setup({ options: { controls: true } });
  expect(embedUrl(result).searchParams.get('controls')).toBe('1');
  expect(readyPatch(result.patches).capabilities).toMatchObject({
    customControls: { status: 'unavailable', reason: 'provider' }
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('honors an explicit Do-Not-Track opt-out', async () => {
  const result = await setup({ options: { dnt: false } });
  expect(embedUrl(result).searchParams.get('dnt')).toBe('0');
});

// SIDEPRO-210. Same polarity as `controls`: unset and `false` both mean play
// once, and the parameter is always written so the embed never inherits a
// Vimeo-side default this adapter did not choose.
test.each([
  ['unset', undefined, '0'],
  ['false', false, '0'],
  ['true', true, '1']
] as const)(
  'sets the loop embed parameter to the expected value when the loop option is %s',
  async (_label, loop, expected) => {
    const result = await setup({ options: { loop } });
    expect(embedUrl(result).searchParams.get('loop')).toBe(expected);
  }
);

// --- commands ---

test('classifies a blocked play command as policy', async () => {
  const { provider } = await setup({
    fake: {
      play: () =>
        Promise.reject(namedError('NotAllowedError', 'Autoplay was blocked.'))
    }
  });
  await expect(provider.play()).resolves.toMatchObject({
    ok: false,
    reason: 'blocked',
    error: { category: 'policy', message: 'Autoplay was blocked.' }
  });
});

test('downgrades the volume capability when the embed disallows volume control', async () => {
  const { patches, provider } = await setup({
    fake: {
      setVolume: () =>
        Promise.reject(
          namedError('UnsupportedError', 'Volume cannot be set here.')
        )
    }
  });
  await expect(provider.setVolume(0.5)).resolves.toMatchObject({
    ok: false,
    reason: 'unsupported'
  });
  const downgrade = patches.at(-1);
  expect(downgrade?.capabilities).toMatchObject({
    setVolume: { status: 'unavailable', reason: 'provider' }
  });
});

test('downgrades playback-rate capability to provider-plan when speed is gated', async () => {
  const { patches, provider } = await setup({
    fake: {
      setPlaybackRate: () =>
        Promise.reject(
          namedError('UnsupportedError', 'Speed requires a paid plan.')
        )
    }
  });
  await expect(provider.setPlaybackRate(1.5)).resolves.toMatchObject({
    ok: false,
    reason: 'unsupported'
  });
  expect(patches.at(-1)?.capabilities).toMatchObject({
    setPlaybackRate: { status: 'unavailable', reason: 'provider-plan' }
  });
});

test('rejects non-finite volume, rate, and seek inputs without calling the SDK', async () => {
  const { provider, sdk } = await setup();
  const player = sdk.instances[0]!;
  await expect(provider.setVolume(Number.NaN)).resolves.toMatchObject({
    ok: false,
    reason: 'provider-error'
  });
  await expect(provider.setPlaybackRate(0)).resolves.toMatchObject({
    ok: false,
    reason: 'provider-error'
  });
  await expect(
    provider.seekTo(Number.POSITIVE_INFINITY)
  ).resolves.toMatchObject({ ok: false, reason: 'provider-error' });
  expect(player.setVolume).not.toHaveBeenCalled();
  expect(player.setPlaybackRate).not.toHaveBeenCalled();
  expect(player.setCurrentTime).not.toHaveBeenCalled();
});

test('clamps seekBy to the confirmed timeline', async () => {
  const { provider, sdk } = await setup({ fake: { duration: 60 } });
  const player = sdk.instances[0]!;
  player.emit('timeupdate', { duration: 60, percent: 0.5, seconds: 30 });
  await provider.seekBy(100);
  expect(player.setCurrentTime).toHaveBeenLastCalledWith(60);
  await provider.seekBy(-100);
  expect(player.setCurrentTime).toHaveBeenLastCalledWith(0);
});

test('clamps seekTo to the confirmed timeline', async () => {
  const { provider, sdk } = await setup({ fake: { duration: 60 } });
  const player = sdk.instances[0]!;
  player.emit('timeupdate', { duration: 60, percent: 0.5, seconds: 30 });
  await provider.seekTo(100);
  expect(player.setCurrentTime).toHaveBeenLastCalledWith(60);
  await provider.seekTo(-100);
  expect(player.setCurrentTime).toHaveBeenLastCalledWith(0);
});

// --- captions ---
// Vimeo renders captions inside its own iframe, so this provider only wires
// track discovery and language selection (captionRendering: 'provider') --
// no cue overlay, no subscribeCues. Track ids are normalized to
// `vimeo:<language>`, disambiguated with the array index only when two
// tracks share a language.

test('discovers caption tracks and normalizes them to the core text-track contract', async () => {
  const { patches } = await setup({
    fake: {
      textTracks: [
        {
          language: 'en',
          kind: 'subtitles',
          label: 'English',
          mode: 'disabled' as const
        },
        {
          language: 'fr',
          kind: 'captions',
          label: 'Français',
          mode: 'showing' as const
        }
      ]
    }
  });
  const ready = readyPatch(patches);
  expect(ready.textTracks).toEqual([
    {
      id: 'vimeo:en',
      label: 'English',
      language: 'en',
      kind: 'subtitles',
      readiness: 'loaded'
    },
    {
      id: 'vimeo:fr',
      label: 'Français',
      language: 'fr',
      kind: 'captions',
      readiness: 'loaded'
    }
  ]);
  expect(ready.selectedTextTrackId).toBe('vimeo:fr');
  expect(ready.captionRendering).toBe('custom');
  expect(ready.capabilities).toMatchObject({
    selectTextTrack: { status: 'available' }
  });
});

test('names an unlabelled caption track after its language', async () => {
  const { patches } = await setup({
    fake: {
      textTracks: [
        {
          language: 'fr',
          kind: 'captions',
          label: '',
          mode: 'disabled' as const
        }
      ]
    }
  });
  expect(readyPatch(patches).textTracks).toEqual([
    {
      id: 'vimeo:fr',
      label: 'français',
      language: 'fr',
      kind: 'captions',
      readiness: 'loaded'
    }
  ]);
});

test('selects a discovered caption track by its normalized id', async () => {
  const { patches, provider, sdk } = await setup({
    fake: {
      textTracks: [
        {
          language: 'en',
          kind: 'subtitles',
          label: 'English',
          mode: 'disabled' as const
        },
        {
          language: 'fr',
          kind: 'captions',
          label: 'Français',
          mode: 'disabled' as const
        }
      ]
    }
  });
  const player = sdk.instances[0]!;
  await expect(provider.selectTextTrack('vimeo:fr')).resolves.toEqual({
    ok: true
  });
  expect(player.enableTextTrack).toHaveBeenCalledWith('fr', 'captions', false);
  expect(patches.at(-1)).toMatchObject({ selectedTextTrackId: 'vimeo:fr' });

  await expect(provider.selectTextTrack(null)).resolves.toEqual({ ok: true });
  expect(player.disableTextTrack).toHaveBeenCalled();
  expect(patches.at(-1)).toMatchObject({ selectedTextTrackId: null });
});

test('rejects selecting a caption track the video does not have', async () => {
  const { provider, sdk } = await setup({ fake: { textTracks: [] } });
  await expect(provider.selectTextTrack('vimeo:en')).resolves.toMatchObject({
    ok: false,
    reason: 'unsupported'
  });
  expect(sdk.instances[0]!.enableTextTrack).not.toHaveBeenCalled();
});

test('re-resolves the active track when Vimeo reports a texttrackchange', async () => {
  const { patches, sdk } = await setup({
    fake: {
      textTracks: [
        {
          language: 'en',
          kind: 'subtitles',
          label: 'English',
          mode: 'showing' as const
        },
        {
          language: 'fr',
          kind: 'captions',
          label: 'Français',
          mode: 'disabled' as const
        }
      ]
    }
  });
  expect(readyPatch(patches).selectedTextTrackId).toBe('vimeo:en');
  const player = sdk.instances[0]!;
  player.emit('texttrackchange', {
    kind: 'captions',
    label: 'Français',
    language: 'fr'
  });
  expect(patches.at(-1)).toMatchObject({ selectedTextTrackId: 'vimeo:fr' });
  player.emit('texttrackchange', { kind: '', label: '', language: '' });
  expect(patches.at(-1)).toMatchObject({ selectedTextTrackId: null });
});

test('refreshes the discovered tracks when texttrackchange reports an unknown track', async () => {
  const { patches, sdk } = await setup({
    fake: {
      textTracks: [
        {
          language: 'en',
          kind: 'subtitles',
          label: 'English',
          mode: 'disabled' as const
        }
      ]
    }
  });
  const player = sdk.instances[0]!;
  player.setTextTracks([
    {
      language: 'en',
      kind: 'subtitles',
      label: 'English',
      mode: 'disabled' as const
    },
    {
      language: 'es',
      kind: 'captions',
      label: 'Español',
      mode: 'showing' as const
    }
  ]);
  player.emit('texttrackchange', {
    kind: 'captions',
    label: 'Español',
    language: 'es'
  });
  await flushMicrotasks();
  expect(patches.at(-1)).toMatchObject({
    selectedTextTrackId: 'vimeo:es',
    captionRendering: 'custom',
    textTracks: [
      {
        id: 'vimeo:en',
        label: 'English',
        language: 'en',
        kind: 'subtitles',
        readiness: 'loaded'
      },
      {
        id: 'vimeo:es',
        label: 'Español',
        language: 'es',
        kind: 'captions',
        readiness: 'loaded'
      }
    ]
  });
});

// --- captions: cue channel (#16) ---
// Vimeo's `enableTextTrack(language, kind, showing)` fires `cuechange` without
// drawing the cues itself when `showing` is false, so Reely can own rendering
// and report `captionRendering: 'custom'`. Verified against the real embed:
// with `showing: false` the paused frame is pixel-identical to no track at all.

const enTrack = {
  language: 'en',
  kind: 'subtitles',
  label: 'English',
  mode: 'disabled' as const
};

const cueChangePayload = (
  cues: ReadonlyArray<{ text: string; html?: string }>
) => ({
  language: 'en',
  kind: 'subtitles',
  label: 'English',
  cues: cues.map((cue) => ({ text: cue.text, html: cue.html ?? cue.text }))
});

test('reports custom caption rendering so cues reach the overlay', async () => {
  const { patches } = await setup({ fake: { textTracks: [enTrack] } });

  expect(readyPatch(patches).captionRendering).toBe('custom');
});

test('enables the selected track without Vimeo drawing it', async () => {
  const { provider, sdk } = await setup({ fake: { textTracks: [enTrack] } });

  await provider.selectTextTrack!('vimeo:en');

  expect(sdk.instances[0]!.enableTextTrack).toHaveBeenCalledWith(
    'en',
    'subtitles',
    false
  );
});

test('fans cuechange payloads out to cue subscribers', async () => {
  const { provider, sdk } = await setup({ fake: { textTracks: [enTrack] } });
  const seen: (readonly TextCue[])[] = [];
  provider.subscribeCues!((cues) => seen.push(cues));

  sdk.instances[0]!.emit(
    'cuechange',
    cueChangePayload([{ text: 'first line' }])
  );

  expect(seen.at(-1)).toEqual([
    { id: null, startTime: 0, endTime: 0, text: 'first line' }
  ]);
});

test('normalizes Vimeo cue markup and line separators into plain text', async () => {
  const { provider, sdk } = await setup({ fake: { textTracks: [enTrack] } });
  const seen: (readonly TextCue[])[] = [];
  provider.subscribeCues!((cues) => seen.push(cues));

  // Real payload shape: WebVTT tags survive in `text`, and Vimeo joins the
  // cue's lines with U+21B5 rather than a newline.
  sdk.instances[0]!.emit(
    'cuechange',
    cueChangePayload([
      { text: '<i>how to make your videos</i>↵<i>look amazing.</i>' }
    ])
  );

  expect(seen.at(-1)).toEqual([
    {
      id: null,
      startTime: 0,
      endTime: 0,
      text: 'how to make your videos\nlook amazing.'
    }
  ]);
});

test('decodes the entities WebVTT requires cue text to escape', async () => {
  const { provider, sdk } = await setup({ fake: { textTracks: [enTrack] } });
  const seen: (readonly TextCue[])[] = [];
  provider.subscribeCues!((cues) => seen.push(cues));

  // All six escapes the WebVTT cue-text grammar defines.
  sdk.instances[0]!.emit(
    'cuechange',
    cueChangePayload([
      { text: 'rock &amp; roll &lt;loud&gt;&nbsp;now&lrm;&rlm;' }
    ])
  );

  expect(seen.at(-1)?.[0]?.text).toBe(
    'rock & roll <loud>\u00a0now\u200e\u200f'
  );
});

test('leaves an escaped entity escaped instead of decoding it twice', async () => {
  const { provider, sdk } = await setup({ fake: { textTracks: [enTrack] } });
  const seen: (readonly TextCue[])[] = [];
  provider.subscribeCues!((cues) => seen.push(cues));

  // `&amp;lt;` is an author writing the literal text `&lt;`. Decoding `&amp;`
  // before `&lt;` would collapse it all the way to `<`.
  sdk.instances[0]!.emit(
    'cuechange',
    cueChangePayload([{ text: 'writes &amp;lt; as text' }])
  );

  expect(seen.at(-1)?.[0]?.text).toBe('writes &lt; as text');
});

test('keeps text an author escaped from being stripped as a tag', async () => {
  const { provider, sdk } = await setup({ fake: { textTracks: [enTrack] } });
  const seen: (readonly TextCue[])[] = [];
  provider.subscribeCues!((cues) => seen.push(cues));

  // Tags are stripped before entities are decoded, so `&lt;i&gt;` survives as
  // visible text while a real `<i>` tag is removed.
  sdk.instances[0]!.emit(
    'cuechange',
    cueChangePayload([{ text: '<i>styled</i> and &lt;i&gt; as text' }])
  );

  expect(seen.at(-1)?.[0]?.text).toBe('styled and <i> as text');
});

test('stamps cues with the playback position they became active at', async () => {
  const { provider, sdk } = await setup({ fake: { textTracks: [enTrack] } });
  const player = sdk.instances[0]!;
  const seen: (readonly TextCue[])[] = [];
  provider.subscribeCues!((cues) => seen.push(cues));

  player.emit('timeupdate', { seconds: 12.5, percent: 0.1, duration: 120 });
  player.emit('cuechange', cueChangePayload([{ text: 'at twelve' }]));

  // Vimeo's payload carries no cue timings at all, so the position where the
  // cue became active is the only honest thing to report.
  expect(seen.at(-1)).toEqual([
    { id: null, startTime: 12.5, endTime: 12.5, text: 'at twelve' }
  ]);
});

test('clears the active cues when the track goes empty', async () => {
  const { provider, sdk } = await setup({ fake: { textTracks: [enTrack] } });
  const player = sdk.instances[0]!;
  const seen: (readonly TextCue[])[] = [];
  provider.subscribeCues!((cues) => seen.push(cues));

  player.emit('cuechange', cueChangePayload([{ text: 'visible' }]));
  player.emit('cuechange', cueChangePayload([]));

  expect(seen.at(-1)).toEqual([]);
});

test('drops cues whose text is empty once normalized', async () => {
  const { provider, sdk } = await setup({ fake: { textTracks: [enTrack] } });
  const seen: (readonly TextCue[])[] = [];
  provider.subscribeCues!((cues) => seen.push(cues));

  sdk.instances[0]!.emit(
    'cuechange',
    cueChangePayload([{ text: '<i></i>' }, { text: 'kept' }])
  );

  expect(seen.at(-1)).toEqual([
    { id: null, startTime: 0, endTime: 0, text: 'kept' }
  ]);
});

test('stops fanning out cues once the subscriber unsubscribes', async () => {
  const { provider, sdk } = await setup({ fake: { textTracks: [enTrack] } });
  const seen: (readonly TextCue[])[] = [];
  const unsubscribe = provider.subscribeCues!((cues) => seen.push(cues));

  unsubscribe();
  sdk.instances[0]!.emit('cuechange', cueChangePayload([{ text: 'ignored' }]));

  expect(seen).toEqual([]);
});

test('hands caption rendering back to Vimeo in native renderer mode', async () => {
  const { provider, sdk } = await setup({ fake: { textTracks: [enTrack] } });
  const player = sdk.instances[0]!;
  const patches: ProviderStatePatch[] = [];
  provider.subscribe((patch) => patches.push(patch));

  provider.setCaptionRenderer!('native');

  // Vimeo drawing the cues in its own iframe is exactly what 'provider'
  // means, and it is the fallback for anything our overlay cannot render.
  expect(patches.at(-1)?.captionRendering).toBe('provider');
  await provider.selectTextTrack!('vimeo:en');
  expect(player.enableTextTrack).toHaveBeenCalledWith('en', 'subtitles', true);
});

test('takes over a track the embed already had showing', async () => {
  // Vimeo can arrive with a track already showing (a viewer's stored
  // preference, or `texttrack=` on the embed). Discovery alone leaves Vimeo
  // drawing it, so with the overlay owning rendering both would draw.
  const { sdk } = await setup({
    fake: { textTracks: [{ ...enTrack, mode: 'showing' as const }] }
  });

  expect(sdk.instances[0]!.enableTextTrack).toHaveBeenCalledWith(
    'en',
    'subtitles',
    false
  );
});

test('leaves an already-showing track to Vimeo in native renderer mode', async () => {
  const mount = document.createElement('div') as VimeoMountElement;
  document.body.appendChild(mount);
  const sdk = createFakeSdk({
    textTracks: [{ ...enTrack, mode: 'showing' as const }]
  });
  sdkState.load = () => Promise.resolve(sdk.Sdk);
  const provider = createVimeoProvider(mount, publicSource);
  provider.subscribe(() => undefined);
  // Mirrors core re-applying a stored renderer intent before the provider has
  // attached, the way PlayerController.setProvider does.
  provider.setCaptionRenderer!('native');
  await provider.attach();
  await provider.load();

  expect(sdk.instances[0]!.enableTextTrack).toHaveBeenCalledWith(
    'en',
    'subtitles',
    true
  );
});

test('does not enable anything when discovery finds no selection', async () => {
  const { sdk } = await setup({ fake: { textTracks: [enTrack] } });

  expect(sdk.instances[0]!.enableTextTrack).not.toHaveBeenCalled();
});

test('takes over a track the viewer enabled through Vimeo own UI', async () => {
  // With `controls: true` the viewer can turn captions on inside the iframe.
  // Vimeo enables those `showing: true` and draws them, and cuechange fires
  // either way -- so without a reconcile both Vimeo and the overlay draw.
  const { sdk } = await setup({ fake: { textTracks: [enTrack] } });
  const player = sdk.instances[0]!;

  player.emit('texttrackchange', {
    language: 'en',
    kind: 'subtitles',
    label: 'English'
  });

  expect(player.enableTextTrack).toHaveBeenCalledWith('en', 'subtitles', false);
});

test('does not re-enable a track it enabled itself', async () => {
  // Our own enableTextTrack makes Vimeo fire texttrackchange; reconciling that
  // back would ping-pong.
  const { provider, sdk } = await setup({ fake: { textTracks: [enTrack] } });
  const player = sdk.instances[0]!;
  await provider.selectTextTrack!('vimeo:en');
  player.enableTextTrack.mockClear();

  player.emit('texttrackchange', {
    language: 'en',
    kind: 'subtitles',
    label: 'English'
  });

  expect(player.enableTextTrack).not.toHaveBeenCalled();
});

test('clears active cues when captions are turned off through Vimeo own UI', async () => {
  const { provider, sdk } = await setup({ fake: { textTracks: [enTrack] } });
  const player = sdk.instances[0]!;
  const seen: (readonly TextCue[])[] = [];
  provider.subscribeCues!((cues) => seen.push(cues));
  player.emit('cuechange', cueChangePayload([{ text: 'on screen' }]));

  // Cues simply stop arriving, so anything already emitted would stay painted.
  player.emit('texttrackchange', { language: '', kind: '', label: '' });

  expect(seen.at(-1)).toEqual([]);
});

test('clears the previous cue when the viewer switches language in Vimeo UI', async () => {
  const frTrack = {
    language: 'fr',
    kind: 'subtitles',
    label: 'Français',
    mode: 'disabled' as const
  };
  const { provider, sdk } = await setup({
    fake: { textTracks: [enTrack, frTrack] }
  });
  const player = sdk.instances[0]!;
  const seen: (readonly TextCue[])[] = [];
  provider.subscribeCues!((cues) => seen.push(cues));
  player.emit('cuechange', cueChangePayload([{ text: 'English cue' }]));

  player.emit('texttrackchange', {
    language: 'fr',
    kind: 'subtitles',
    label: 'Français'
  });

  // The English cue must not linger until French delivers its first cue.
  expect(seen.at(-1)).toEqual([]);
});

test('flips the renderer for a selection that has not settled yet', async () => {
  // selectTextTrack only records its id once enableTextTrack resolves, so a
  // renderer flip in the same tick used to read a stale (or absent) selection
  // and leave Vimeo and the overlay both not drawing.
  const { provider, sdk } = await setup({
    fake: { textTracks: [enTrack] }
  });
  const player = sdk.instances[0]!;
  const pendingEnables: Array<() => void> = [];
  player.enableTextTrack.mockImplementation(
    () =>
      new Promise<unknown>((resolve) =>
        pendingEnables.push(() => resolve(undefined))
      )
  );

  const pending = provider.selectTextTrack!('vimeo:en');
  provider.setCaptionRenderer!('native');
  pendingEnables.forEach((release) => release());
  await pending;
  await flushMicrotasks();

  expect(player.enableTextTrack).toHaveBeenLastCalledWith(
    'en',
    'subtitles',
    true
  );
});

test('forgets what it enabled when the player is torn down', async () => {
  // The id outlives the player it referred to otherwise, and the fresh player
  // has nothing enabled -- so a renderer flip would switch captions on for a
  // track the reported state says is not selected, and a genuine Vimeo-UI
  // enable of that same track would be swallowed as our own echo.
  const { provider, sdk } = await setup({ fake: { textTracks: [enTrack] } });
  await provider.selectTextTrack!('vimeo:en');
  await provider.retry!();
  const retried = sdk.instances.at(-1)!;
  retried.enableTextTrack.mockClear();

  provider.setCaptionRenderer!('native');

  expect(retried.enableTextTrack).not.toHaveBeenCalled();
});

test('forgets a track whose enable failed', async () => {
  const frTrack = {
    language: 'fr',
    kind: 'subtitles',
    label: 'Français',
    mode: 'disabled' as const
  };
  const { provider, sdk } = await setup({
    fake: { textTracks: [enTrack, frTrack] }
  });
  const player = sdk.instances[0]!;
  await provider.selectTextTrack!('vimeo:en');
  player.enableTextTrack.mockRejectedValueOnce(new Error('nope'));
  await provider.selectTextTrack!('vimeo:fr');
  player.enableTextTrack.mockClear();

  // Without a rollback the failed target is still the remembered id, so the
  // flip hands Vimeo the wrong track while state still reports English.
  provider.setCaptionRenderer!('native');

  expect(player.enableTextTrack).toHaveBeenCalledWith('en', 'subtitles', true);
});

test('clears the previous cue when Reely switches language', async () => {
  const frTrack = {
    language: 'fr',
    kind: 'subtitles',
    label: 'Français',
    mode: 'disabled' as const
  };
  const { provider, sdk } = await setup({
    fake: { textTracks: [enTrack, frTrack] }
  });
  const player = sdk.instances[0]!;
  const seen: (readonly TextCue[])[] = [];
  provider.subscribeCues!((cues) => seen.push(cues));
  await provider.selectTextTrack!('vimeo:en');
  player.emit('cuechange', cueChangePayload([{ text: 'English cue' }]));

  // The captions menu is the primary path; it must not behave differently from
  // a switch made in Vimeo's own UI.
  await provider.selectTextTrack!('vimeo:fr');

  expect(seen.at(-1)).toEqual([]);
});

test('reconciles a track that was not in the last known set', async () => {
  const { provider, sdk } = await setup({ fake: { textTracks: [enTrack] } });
  const player = sdk.instances[0]!;
  player.setTextTracks([
    enTrack,
    {
      language: 'es',
      kind: 'captions',
      label: 'Español',
      mode: 'showing' as const
    }
  ]);
  const seen: (readonly TextCue[])[] = [];
  provider.subscribeCues!((cues) => seen.push(cues));
  player.emit('cuechange', cueChangePayload([{ text: 'stale' }]));

  player.emit('texttrackchange', {
    language: 'es',
    kind: 'captions',
    label: 'Español'
  });
  await flushMicrotasks();

  expect(player.enableTextTrack).toHaveBeenCalledWith('es', 'captions', false);
  expect(seen.at(-1)).toEqual([]);
});

test('does not re-enable anything after captions are turned off', async () => {
  const { provider, sdk } = await setup({ fake: { textTracks: [enTrack] } });
  const player = sdk.instances[0]!;
  await provider.selectTextTrack!('vimeo:en');
  await provider.selectTextTrack!(null);
  player.enableTextTrack.mockClear();

  provider.setCaptionRenderer!('native');

  expect(player.enableTextTrack).not.toHaveBeenCalled();
});

test('does not re-enable anything after Vimeo UI turns captions off', async () => {
  const { provider, sdk } = await setup({ fake: { textTracks: [enTrack] } });
  const player = sdk.instances[0]!;
  await provider.selectTextTrack!('vimeo:en');
  player.emit('texttrackchange', { language: '', kind: '', label: '' });
  player.enableTextTrack.mockClear();

  provider.setCaptionRenderer!('native');

  expect(player.enableTextTrack).not.toHaveBeenCalled();
});

// Documents the staleness guard rather than `cueListeners.clear()`: a destroyed
// player short-circuits every event before it can reach a cue subscriber, so
// clearing the set is a leak fix with no observable behaviour of its own.
test('emits no cues once the provider is destroyed', async () => {
  const { provider, sdk } = await setup({ fake: { textTracks: [enTrack] } });
  const seen: (readonly TextCue[])[] = [];
  provider.subscribeCues!((cues) => seen.push(cues));

  await provider.destroy();
  seen.length = 0;
  sdk.instances[0]!.emit('cuechange', cueChangePayload([{ text: 'ignored' }]));

  expect(seen).toEqual([]);
});

test('re-enables the active track when the renderer mode flips', async () => {
  const { provider, sdk } = await setup({
    fake: {
      textTracks: [{ ...enTrack, mode: 'showing' as const }]
    }
  });
  const player = sdk.instances[0]!;
  player.enableTextTrack.mockClear();

  provider.setCaptionRenderer!('native');
  await flushMicrotasks();

  expect(player.enableTextTrack).toHaveBeenCalledWith('en', 'subtitles', true);
});

test('reports unavailable rendering with no tracks whatever the renderer mode', async () => {
  const { provider, patches } = await setup({ fake: { textTracks: [] } });

  provider.setCaptionRenderer!('native');

  expect(patches.at(-1)?.captionRendering).toBe('unavailable');
});

test('clears active cues when captions are turned off', async () => {
  const { provider, sdk } = await setup({ fake: { textTracks: [enTrack] } });
  const seen: (readonly TextCue[])[] = [];
  provider.subscribeCues!((cues) => seen.push(cues));
  sdk.instances[0]!.emit('cuechange', cueChangePayload([{ text: 'visible' }]));

  await provider.selectTextTrack!(null);

  expect(seen.at(-1)).toEqual([]);
});

test('clears active cues when the player is torn down for a retry', async () => {
  const { provider, sdk } = await setup({ fake: { textTracks: [enTrack] } });
  const seen: (readonly TextCue[])[] = [];
  provider.subscribeCues!((cues) => seen.push(cues));
  sdk.instances[0]!.emit('cuechange', cueChangePayload([{ text: 'stale' }]));

  await provider.retry!();

  expect(seen.at(-1)).toEqual([]);
});

test('ignores cuechange from a player replaced by a retry', async () => {
  const { provider, sdk } = await setup({ fake: { textTracks: [enTrack] } });
  const stalePlayer = sdk.instances[0]!;
  const seen: (readonly TextCue[])[] = [];
  provider.subscribeCues!((cues) => seen.push(cues));
  await provider.retry!();
  seen.length = 0;

  stalePlayer.emit('cuechange', cueChangePayload([{ text: 'from the past' }]));

  expect(seen).toEqual([]);
});

// --- fullscreen and picture-in-picture quirks ---

test('routes fullscreen through the SDK instead of the mount element', async () => {
  const { mount, provider, sdk } = await setup();
  const mountFullscreen = vi.fn();
  (mount as { requestFullscreen?: unknown }).requestFullscreen =
    mountFullscreen;
  await expect(provider.requestFullscreen()).resolves.toEqual({ ok: true });
  expect(sdk.instances[0]!.requestFullscreen).toHaveBeenCalled();
  expect(mountFullscreen).not.toHaveBeenCalled();
});

test('classifies a gesture-blocked fullscreen request as blocked', async () => {
  const { provider } = await setup({
    fake: {
      requestFullscreen: () =>
        Promise.reject(
          namedError('NotAllowedError', 'Fullscreen requires a user gesture.')
        )
    }
  });
  await expect(provider.requestFullscreen()).resolves.toMatchObject({
    ok: false,
    reason: 'blocked',
    error: { category: 'policy' }
  });
});

test('confirms fullscreen state from the iframe player, not the document', async () => {
  const { events, patches, sdk } = await setup();
  const player = sdk.instances[0]!;
  expect(document.fullscreenElement ?? null).toBeNull();
  player.emit('fullscreenchange', { fullscreen: true });
  expect(patches.at(-1)).toMatchObject({ fullscreen: true });
  expect(events.at(-1)).toMatchObject({
    type: 'fullscreenchange',
    detail: { fullscreen: true }
  });
  player.emit('fullscreenchange', { fullscreen: false });
  expect(patches.at(-1)).toMatchObject({ fullscreen: false });
});

test('downgrades picture-in-picture when the embed cannot enter it', async () => {
  const { patches, provider } = await setup({
    fake: {
      requestPictureInPicture: () =>
        Promise.reject(
          namedError('UnsupportedError', 'PiP is not supported here.')
        )
    }
  });
  await expect(provider.requestPictureInPicture()).resolves.toMatchObject({
    ok: false,
    reason: 'unsupported'
  });
  expect(patches.at(-1)?.capabilities).toMatchObject({
    pictureInPicture: { status: 'unavailable', reason: 'provider' }
  });
});

test('maps picture-in-picture events to confirmed state', async () => {
  const { events, patches, sdk } = await setup();
  const player = sdk.instances[0]!;
  player.emit('enterpictureinpicture');
  expect(patches.at(-1)).toMatchObject({ pictureInPicture: true });
  expect(events.at(-1)).toMatchObject({ type: 'pictureinpicturechange' });
  player.emit('leavepictureinpicture');
  expect(patches.at(-1)).toMatchObject({ pictureInPicture: false });
});

// --- event mapping ---

test('maps playback, buffering, and timeline events to confirmed state', async () => {
  const { events, patches, sdk } = await setup();
  const player = sdk.instances[0]!;

  player.emit('play', { duration: 60, percent: 0, seconds: 0 });
  expect(patches.at(-1)).toMatchObject({ playback: 'playing' });
  expect(events.at(-1)).toMatchObject({ type: 'play', origin: 'provider' });

  player.emit('bufferstart');
  expect(patches.at(-1)).toMatchObject({ buffering: true });
  player.emit('bufferend');
  expect(patches.at(-1)).toMatchObject({ buffering: false });

  player.emit('timeupdate', { duration: 61.5, percent: 0.2, seconds: 12.3 });
  expect(patches.at(-1)).toMatchObject({ currentTime: 12.3, duration: 61.5 });

  player.buffered = [[0, 30]];
  player.emit('progress', { duration: 60, percent: 0.5, seconds: 30 });
  await flushMicrotasks();
  expect(patches.at(-1)).toMatchObject({ buffered: [{ start: 0, end: 30 }] });

  player.emit('seeking', { duration: 60, percent: 0.8, seconds: 48 });
  expect(patches.at(-1)).toMatchObject({ seeking: true });
  expect(events.at(-1)).toMatchObject({
    type: 'seeking',
    detail: { currentTime: 48 }
  });
  player.emit('seeked', { duration: 60, percent: 0.8, seconds: 48 });
  expect(patches.at(-1)).toMatchObject({ seeking: false, currentTime: 48 });

  player.emit('pause', { duration: 60, percent: 0.8, seconds: 48 });
  expect(patches.at(-1)).toMatchObject({ playback: 'paused' });
  expect(events.at(-1)).toMatchObject({ type: 'pause' });

  player.emit('ended', { duration: 60, percent: 1, seconds: 60 });
  expect(patches.at(-1)).toMatchObject({ playback: 'ended', currentTime: 60 });
  expect(events.at(-1)).toMatchObject({ type: 'ended' });
});

// --- buffered ranges (#91) ---

const bufferedPatches = (
  patches: readonly ProviderStatePatch[]
): ReadonlyArray<ProviderStatePatch['buffered']> =>
  patches
    .filter((patch) => patch.buffered !== undefined)
    .map((patch) => patch.buffered);

test('reports the SDK buffered ranges, holes and all', async () => {
  const { patches, sdk } = await setup();
  const player = sdk.instances[0]!;

  // Measured against live Vimeo after a forward seek: two disjoint ranges,
  // while the progress event reported only the edge of the second one.
  player.buffered = [
    [0, 30.03],
    [42.048, 54.054]
  ];
  player.emit('progress', {
    duration: 61.867,
    percent: 0.777,
    seconds: 48.043
  });
  await flushMicrotasks();

  expect(bufferedPatches(patches).at(-1)).toEqual([
    { start: 0, end: 30.03 },
    { start: 42.048, end: 54.054 }
  ]);
  // The old fabrication would have painted over the 30.03-42.048 hole.
  expect(bufferedPatches(patches)).not.toContainEqual([
    { start: 0, end: 48.043 }
  ]);
});

test('reports an empty range list before anything is buffered', async () => {
  const { patches, sdk } = await setup();
  const player = sdk.instances[0]!;

  player.buffered = [];
  player.emit('progress', { duration: 61.867, percent: 0, seconds: 0 });
  await flushMicrotasks();

  expect(bufferedPatches(patches).at(-1)).toEqual([]);
});

test('emits no buffered ranges when the SDK cannot report them', async () => {
  const { patches, sdk } = await setup({
    fake: { getBuffered: () => Promise.reject(namedError('Error', 'nope')) }
  });

  sdk.instances[0]!.emit('progress', {
    duration: 60,
    percent: 0.5,
    seconds: 30
  });
  await flushMicrotasks();

  expect(bufferedPatches(patches)).toEqual([]);
});

test('drops buffered ranges that resolve after the player is replaced', async () => {
  let release: ((ranges: ReadonlyArray<readonly number[]>) => void) | undefined;
  const { patches, provider, sdk } = await setup({
    fake: {
      getBuffered: () =>
        new Promise<ReadonlyArray<readonly number[]>>((resolve) => {
          release = resolve;
        })
    }
  });

  sdk.instances[0]!.emit('progress', {
    duration: 60,
    percent: 0.5,
    seconds: 30
  });
  provider.destroy();
  release?.([[0, 30]]);
  await flushMicrotasks();

  expect(bufferedPatches(patches)).toEqual([]);
});

test('suppresses the synthetic pause that precedes ended', async () => {
  const { patches, sdk } = await setup();
  const player = sdk.instances[0]!;
  player.emit('play', { duration: 60, percent: 0, seconds: 0 });
  const beforePause = patches.length;
  player.emit('pause', { duration: 60, percent: 1, seconds: 60 });
  expect(patches).toHaveLength(beforePause);
  player.emit('ended', { duration: 60, percent: 1, seconds: 60 });
  expect(patches.at(-1)).toMatchObject({ playback: 'ended' });
});

test('confirms volume changes together with the muted state', async () => {
  const { events, patches, sdk } = await setup();
  const player = sdk.instances[0]!;
  player.muted = true;
  player.emit('volumechange', { volume: 0.25 });
  await flushMicrotasks();
  expect(patches.at(-1)).toMatchObject({ volume: 0.25, muted: true });
  expect(events.at(-1)).toMatchObject({
    type: 'volumechange',
    detail: { muted: true, volume: 0.25 }
  });
});

test('confirms playback rate changes', async () => {
  const { events, patches, sdk } = await setup();
  sdk.instances[0]!.emit('playbackratechange', { playbackRate: 1.5 });
  expect(patches.at(-1)).toMatchObject({ playbackRate: 1.5 });
  expect(events.at(-1)).toMatchObject({
    type: 'ratechange',
    detail: { playbackRate: 1.5 }
  });
});

test('updates the timeline when the duration changes', async () => {
  const { patches, sdk } = await setup();
  sdk.instances[0]!.emit('durationchange', { duration: 90 });
  expect(patches.at(-1)).toMatchObject({
    duration: 90,
    seekable: [{ start: 0, end: 90 }]
  });
});

// --- errors ---

test('normalizes playback-level provider errors', async () => {
  const { events, patches, sdk } = await setup();
  sdk.instances[0]!.emit('error', {
    name: 'PrivacyError',
    message: 'The video is private.'
  });
  expect(patches.at(-1)).toMatchObject({
    lifecycle: 'error',
    activation: 'error',
    error: { category: 'policy', message: 'The video is private.' }
  });
  expect(events.at(-1)).toMatchObject({ type: 'error' });
});

test('ignores command-scoped error events already reported through results', async () => {
  const { patches, sdk } = await setup();
  const beforeError = patches.length;
  sdk.instances[0]!.emit('error', {
    name: 'RangeError',
    message: 'Volume out of range.',
    method: 'setVolume'
  });
  expect(patches).toHaveLength(beforeError);
});

test('normalizes a password-protected load failure without throwing', async () => {
  const { patches, provider } = await setup({
    fake: {
      ready: () =>
        Promise.reject(
          namedError('PasswordError', 'The video requires a password.')
        )
    }
  });
  expect(patches.at(-1)).toMatchObject({
    lifecycle: 'error',
    activation: 'error',
    error: {
      category: 'policy',
      fatal: true,
      message: 'The video requires a password.'
    }
  });
  await expect(provider.play()).resolves.toMatchObject({ ok: false });
});

// --- retry and teardown ---

test('retry rebuilds the embed and ignores stale events from the old player', async () => {
  let failFirstReady = true;
  const { patches, provider, sdk } = await setup({
    fake: {
      ready: () =>
        failFirstReady
          ? Promise.reject(namedError('NotFoundError', 'Video was not found.'))
          : Promise.resolve()
    }
  });
  expect(patches.at(-1)).toMatchObject({
    lifecycle: 'error',
    error: { category: 'source' }
  });
  failFirstReady = false;
  await expect(provider.retry()).resolves.toEqual({ ok: true });
  expect(sdk.instances).toHaveLength(2);
  expect(sdk.instances[0]!.destroy).toHaveBeenCalled();
  expect(readyPatch(patches)).toBeDefined();

  const beforeStale = patches.length;
  sdk.instances[0]!.emit('play', { duration: 60, percent: 0, seconds: 0 });
  expect(patches).toHaveLength(beforeStale);
  sdk.instances[1]!.emit('play', { duration: 60, percent: 0, seconds: 0 });
  expect(patches.at(-1)).toMatchObject({ playback: 'playing' });
});

test('a chromeless verdict from a superseded attach cannot overwrite the live one', async () => {
  const mount = document.createElement('div') as VimeoMountElement;
  document.body.appendChild(mount);
  const sdk = createFakeSdk();
  sdkState.load = () => Promise.resolve(sdk.Sdk);

  // The first attach's probe is left hanging so it settles only after a
  // retry has superseded it; the retry's own probe resolves normally.
  let resolveStaleProbe!: (response: Response) => void;
  fetchMock.mockImplementationOnce(
    () => new Promise<Response>((resolve) => (resolveStaleProbe = resolve))
  );
  fetchMock.mockResolvedValueOnce(oembedResponse('basic'));

  const provider = createVimeoProvider(mount, publicSource, {
    customControls: true
  });
  const patches: ProviderStatePatch[] = [];
  provider.subscribe((patch) => patches.push(patch));
  await provider.attach();
  const loading = provider.load();
  await flushMicrotasks();
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await provider.retry();
  expect(readyPatch(patches).capabilities).toMatchObject({
    customControls: { status: 'unavailable', reason: 'provider-plan' }
  });
  const patchCountAfterRetry = patches.length;

  // The superseded attach's probe finally settles, with a verdict that would
  // overwrite the live one — and emit a second ready patch of its own — if
  // the generation guard did not hold. Asserting against the first ready
  // patch would miss that second emit entirely, since it would never
  // replace the first one in the array; the guard is only proven by looking
  // at what is newest after the stale probe settles.
  resolveStaleProbe(oembedResponse('pro'));
  await loading;
  await flushMicrotasks();

  expect(patches).toHaveLength(patchCountAfterRetry);
  const latestCapabilities = [...patches]
    .reverse()
    .find((patch) => patch.capabilities)?.capabilities;
  expect(latestCapabilities).toMatchObject({
    customControls: { status: 'unavailable', reason: 'provider-plan' }
  });
});

test('destroy aborts a probe whose request is still in flight', async () => {
  const mount = document.createElement('div') as VimeoMountElement;
  document.body.appendChild(mount);
  const sdk = createFakeSdk();
  sdkState.load = () => Promise.resolve(sdk.Sdk);

  const signals: AbortSignal[] = [];
  fetchMock.mockImplementation((_url: string, init: RequestInit) => {
    signals.push(init.signal!);
    return new Promise(() => undefined);
  });

  const provider = createVimeoProvider(mount, publicSource, {
    customControls: true
  });
  await provider.attach();
  const loading = provider.load();
  await flushMicrotasks();
  expect(signals).toHaveLength(1);

  await provider.destroy();
  expect(signals[0]!.aborted).toBe(true);
  await loading;
});

test('retry aborts the superseded probe before issuing its own', async () => {
  const mount = document.createElement('div') as VimeoMountElement;
  document.body.appendChild(mount);
  const sdk = createFakeSdk();
  sdkState.load = () => Promise.resolve(sdk.Sdk);

  // What the previous request's signal read as each time a new one was
  // issued — the ordering the retry has to hold, not merely that both
  // requests ended up cancelled.
  const previouslyAborted: boolean[] = [];
  const signals: AbortSignal[] = [];
  fetchMock.mockImplementation((_url: string, init: RequestInit) => {
    previouslyAborted.push(signals.at(-1)?.aborted ?? false);
    signals.push(init.signal!);
    return new Promise(() => undefined);
  });

  const provider = createVimeoProvider(mount, publicSource, {
    customControls: true
  });
  await provider.attach();
  const loading = provider.load();
  await flushMicrotasks();
  expect(signals).toHaveLength(1);

  const retrying = provider.retry();
  await flushMicrotasks();
  expect(signals).toHaveLength(2);
  expect(previouslyAborted).toEqual([false, true]);

  await provider.destroy();
  await Promise.all([loading, retrying]);
});

test('destroy tears down the SDK player, removes the iframe, and silences events', async () => {
  const { mount, patches, provider, sdk } = await setup();
  const player = sdk.instances[0]!;
  await provider.destroy();
  expect(player.destroy).toHaveBeenCalled();
  expect(mount.querySelector('iframe')).toBeNull();
  const afterDestroy = patches.length;
  player.emit('play', { duration: 60, percent: 0, seconds: 0 });
  expect(patches).toHaveLength(afterDestroy);
  await expect(provider.play()).resolves.toEqual({
    ok: false,
    reason: 'not-ready'
  });
  await expect(provider.retry()).resolves.toEqual({
    ok: false,
    reason: 'not-ready'
  });
});

test('a destroy that interrupts loading leaves no embed behind', async () => {
  const mount = document.createElement('div') as VimeoMountElement;
  document.body.appendChild(mount);
  let resolveReady!: () => void;
  const sdk = createFakeSdk({
    ready: () =>
      new Promise<void>((resolve) => {
        resolveReady = resolve;
      })
  });
  sdkState.load = () => Promise.resolve(sdk.Sdk);
  const provider = createVimeoProvider(mount, publicSource);
  const patches: ProviderStatePatch[] = [];
  provider.subscribe((patch) => patches.push(patch));
  await provider.attach();
  const loading = provider.load();
  await flushMicrotasks();
  await provider.destroy();
  resolveReady();
  await loading;
  expect(sdk.instances[0]!.destroy).toHaveBeenCalled();
  expect(mount.querySelector('iframe')).toBeNull();
  expect(patches).not.toContainEqual(
    expect.objectContaining({ lifecycle: 'ready' })
  );
});

// #57: two tracks can share BOTH language and kind (a plain transcript and a
// forced-narrative one, say). The ids disambiguate by index, but Vimeo's
// `texttrackchange` payload carries only language and kind, so the reverse
// mapping cannot tell the pair apart from the event alone.
const duplicateEnglish = [
  {
    language: 'en',
    kind: 'subtitles',
    label: 'English',
    mode: 'disabled' as const
  },
  {
    language: 'en',
    kind: 'subtitles',
    label: 'English (forced)',
    mode: 'disabled' as const
  },
  {
    language: 'fr',
    kind: 'captions',
    label: 'Français',
    mode: 'disabled' as const
  }
];

test('disambiguates ids when two tracks share a language, and resolves them back', async () => {
  const { patches, sdk, provider } = await setup({
    fake: { textTracks: duplicateEnglish }
  });
  expect(readyPatch(patches).textTracks).toMatchObject([
    { id: 'vimeo:en:0', label: 'English' },
    { id: 'vimeo:en:1', label: 'English (forced)' },
    { id: 'vimeo:fr', label: 'Français' }
  ]);

  await expect(provider.selectTextTrack('vimeo:en:1')).resolves.toEqual({
    ok: true
  });
  expect(sdk.instances[0]!.enableTextTrack).toHaveBeenCalledWith(
    'en',
    'subtitles',
    false
  );
  expect(patches.at(-1)).toMatchObject({ selectedTextTrackId: 'vimeo:en:1' });
});

test('keeps our own selection when the echo cannot distinguish the duplicate', async () => {
  const { patches, sdk, provider } = await setup({
    fake: { textTracks: duplicateEnglish }
  });
  await provider.selectTextTrack('vimeo:en:1');

  // Vimeo echoes our own enable back. language+kind alone match the FIRST
  // English track, so resolving from the payload would silently rewrite the
  // selection to the track the viewer did not pick.
  sdk.instances[0]!.emit('texttrackchange', {
    kind: 'subtitles',
    label: 'English (forced)',
    language: 'en'
  });
  expect(patches.at(-1)).toMatchObject({ selectedTextTrackId: 'vimeo:en:1' });
});

test('uses the showing mode to disambiguate a change made in Vimeo UI', async () => {
  const { patches, sdk } = await setup({
    fake: { textTracks: duplicateEnglish }
  });
  const player = sdk.instances[0]!;
  // The viewer picked the second English track inside Vimeo's own CC menu, so
  // there is no selection of ours to prefer — but the SDK marks which one is
  // actually showing.
  player.setTextTracks([
    duplicateEnglish[0]!,
    { ...duplicateEnglish[1]!, mode: 'showing' as const },
    duplicateEnglish[2]!
  ]);
  player.emit('texttrackchange', {
    kind: 'subtitles',
    label: 'English (forced)',
    language: 'en'
  });
  await flushMicrotasks();
  expect(patches.at(-1)).toMatchObject({ selectedTextTrackId: 'vimeo:en:1' });
  // Pins the refresh itself, not just the outcome: a cached mode is stale by
  // definition here, so resolving without re-reading would be luck.
  expect(player.getTextTracks).toHaveBeenCalledTimes(2);
  expect(patches.at(-1)).toMatchObject({
    textTracks: [{ id: 'vimeo:en:0' }, { id: 'vimeo:en:1' }, { id: 'vimeo:fr' }]
  });
});

test('follows a Vimeo-UI switch to the other duplicate, after we selected one', async () => {
  const { patches, sdk, provider } = await setup({
    fake: { textTracks: duplicateEnglish }
  });
  const player = sdk.instances[0]!;
  await provider.selectTextTrack('vimeo:en:1');
  player.enableTextTrack.mockClear();

  // The viewer now picks the OTHER English track in Vimeo's own CC menu. Our
  // last-enabled id still names a candidate, so preferring it — or letting it
  // suppress the refresh — reports the track the viewer just left, and skips
  // the re-enable that puts drawing ownership back where the renderer says.
  player.setTextTracks([
    { ...duplicateEnglish[0]!, mode: 'showing' as const },
    duplicateEnglish[1]!,
    duplicateEnglish[2]!
  ]);
  player.emit('texttrackchange', {
    kind: 'subtitles',
    label: 'English',
    language: 'en'
  });
  await flushMicrotasks();

  expect(patches.at(-1)).toMatchObject({ selectedTextTrackId: 'vimeo:en:0' });
  expect(player.enableTextTrack).toHaveBeenCalledWith('en', 'subtitles', false);
});

// Declared at player construction, not at `player.ready()`: a blocked iframe
// keeps `ready()` pending forever while `runCommand` already accepts, and
// waiting for it is one of the two hangs that closed PR #72. `setup()` is not
// reusable here because it awaits `load()`, which would never settle.
test('vimeo declares command readiness before player.ready() resolves', async () => {
  const mount = document.createElement('div') as VimeoMountElement;
  document.body.appendChild(mount);
  let releaseReady: () => void = () => undefined;
  const sdk = createFakeSdk({
    ready: () => new Promise<void>((resolve) => (releaseReady = resolve))
  });
  sdkState.load = () => Promise.resolve(sdk.Sdk);
  const provider = createVimeoProvider(mount, publicSource);
  const patches: ProviderStatePatch[] = [];
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();
  void provider.load();

  await vi.waitFor(() =>
    expect(patches).toContainEqual(
      expect.objectContaining({ commandsReady: true })
    )
  );
  expect(patches).not.toContainEqual(
    expect.objectContaining({ lifecycle: 'ready' })
  );

  releaseReady();
});

// --- quality (#82) ---

test('reports the Vimeo ladder as selectable rungs, auto excluded', async () => {
  const { patches } = await setup();
  const ready = readyPatch(patches);

  expect(ready.qualities).toEqual([
    { id: 'vimeo:720p', height: 720, width: null, bitrate: null },
    { id: 'vimeo:540p', height: 540, width: null, bitrate: null },
    { id: 'vimeo:360p', height: 360, width: null, bitrate: null },
    { id: 'vimeo:240p', height: 240, width: null, bitrate: null }
  ]);
  expect(ready.selectedQualityId).toBeNull();
  expect(ready.capabilities).toMatchObject({
    selectQuality: { status: 'available' }
  });
});

test('adopts a rung the player is already pinned to at ready', async () => {
  const { patches } = await setup({
    fake: {
      qualities: [
        { id: 'auto', label: 'Auto', active: false },
        { id: '540p', label: '540p', active: true }
      ]
    }
  });

  expect(readyPatch(patches).selectedQualityId).toBe('vimeo:540p');
});

test('reports quality selection unavailable when the ladder holds only auto', async () => {
  const { patches } = await setup({
    fake: { qualities: [{ id: 'auto', label: 'Auto', active: true }] }
  });
  const ready = readyPatch(patches);

  expect(ready.qualities).toEqual([]);
  expect(ready.capabilities).toMatchObject({
    selectQuality: { status: 'unavailable', reason: 'source' }
  });
});

test('reports quality selection unavailable when the SDK cannot enumerate', async () => {
  const { patches } = await setup({
    fake: { getQualities: () => Promise.reject(new Error('nope')) }
  });
  const ready = readyPatch(patches);

  expect(ready.qualities).toEqual([]);
  expect(ready.capabilities).toMatchObject({
    selectQuality: { status: 'unavailable', reason: 'source' }
  });
});

// An embed that does not implement the method still answers it — the SDK
// resolves with whatever came back, `null` included. Trusting that shape took
// the whole load down with a TypeError.
test('stays ready when the embed answers getQualities with a non-list', async () => {
  const { patches } = await setup({
    fake: {
      getQualities: () =>
        Promise.resolve(null as unknown as ReadonlyArray<VimeoSdkQuality>)
    }
  });
  const ready = readyPatch(patches);

  expect(ready.qualities).toEqual([]);
  expect(ready.capabilities).toMatchObject({
    selectQuality: { status: 'unavailable', reason: 'source' }
  });
});

test('drops ladder entries the SDK does not identify', async () => {
  const { patches } = await setup({
    fake: {
      qualities: [
        { id: 'auto', label: 'Auto', active: true },
        { label: '720p', active: false } as unknown as VimeoSdkQuality,
        { id: '540p', label: '540p', active: false }
      ]
    }
  });

  expect(readyPatch(patches).qualities).toEqual([
    { id: 'vimeo:540p', height: 540, width: null, bitrate: null }
  ]);
});

test('pins a rung through the SDK and confirms the selection', async () => {
  const { provider, sdk, patches } = await setup();
  const player = sdk.instances[0]!;

  await expect(provider.selectQuality?.('vimeo:540p')).resolves.toEqual({
    ok: true
  });

  expect(player.setQuality).toHaveBeenCalledWith('540p');
  expect(patches).toContainEqual({ selectedQualityId: 'vimeo:540p' });
});

test('returns to auto by selecting the SDK auto rung', async () => {
  const { provider, sdk, patches } = await setup();
  const player = sdk.instances[0]!;
  await provider.selectQuality?.('vimeo:360p');

  await expect(provider.selectQuality?.(null)).resolves.toEqual({ ok: true });

  expect(player.setQuality).toHaveBeenLastCalledWith('auto');
  expect(patches).toContainEqual({ selectedQualityId: null });
});

// An id the player never offered never settles at all — the command would hang
// forever rather than fail (#82).
test('refuses an id the player never offered without calling the SDK', async () => {
  const { provider, sdk } = await setup();
  const player = sdk.instances[0]!;

  await expect(provider.selectQuality?.('vimeo:4320p')).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });

  expect(player.setQuality).not.toHaveBeenCalled();
});

test('leaves the selection alone when the SDK rejects the switch', async () => {
  const { provider, sdk, patches } = await setup({
    fake: { setQuality: () => Promise.reject(namedError('Error', 'nope')) }
  });
  const player = sdk.instances[0]!;

  const result = await provider.selectQuality?.('vimeo:540p');

  expect(result?.ok).toBe(false);
  expect(player.setQuality).toHaveBeenCalledWith('540p');
  expect(patches).not.toContainEqual({ selectedQualityId: 'vimeo:540p' });
});

// Vimeo's own settings menu changes quality too, on an embed that shows it.
// `qualitychange` reports the *selection*, not the rung adaptive playback
// happens to be on: under auto the rendition moved 720 -> 540 with no event
// fired (#82).
test('follows a quality change made in Vimeo UI', async () => {
  const { sdk, patches } = await setup();
  const player = sdk.instances[0]!;

  player.emit('qualitychange', { quality: '360p' });
  expect(patches).toContainEqual({ selectedQualityId: 'vimeo:360p' });

  player.emit('qualitychange', { quality: 'auto' });
  expect(patches).toContainEqual({ selectedQualityId: null });
});

// The live SDK fires `qualitychange` for our own `setQuality` too, so the echo
// arrives after the command has already announced the selection.
test('does not re-announce the selection when the SDK echoes our own switch', async () => {
  const { provider, sdk, patches } = await setup();
  await provider.selectQuality?.('vimeo:540p');

  sdk.instances[0]!.emit('qualitychange', { quality: '540p' });

  expect(
    patches.filter((patch) => patch.selectedQualityId === 'vimeo:540p')
  ).toHaveLength(1);
});

test('refuses to return to auto when the player offers no auto rung', async () => {
  const { provider, sdk } = await setup({
    fake: { qualities: [{ id: '720p', label: '720p', active: true }] }
  });

  await expect(provider.selectQuality?.(null)).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });

  expect(sdk.instances[0]!.setQuality).not.toHaveBeenCalled();
});

test('ignores a quality change naming a rung the player never offered', async () => {
  const { sdk, patches } = await setup();
  const before = patches.length;

  sdk.instances[0]!.emit('qualitychange', { quality: '4320p' });

  expect(patches).toHaveLength(before);
});

// The fresh player has nothing pinned, so a selection carried over from the
// discarded one would report a rung the embed is not honouring.
test('re-derives the selection from the player a retry builds', async () => {
  const { provider, patches } = await setup();
  await provider.selectQuality?.('vimeo:540p');

  await provider.retry();

  const ready = patches.filter((patch) => patch.lifecycle === 'ready');
  expect(ready.at(-1)?.selectedQualityId).toBeNull();
});

// --- intrinsic dimensions ---

test('vimeo publishes the intrinsic dimensions read from the SDK at attach', async () => {
  const { provider, dimensions } = await setup({
    fake: { videoWidth: 1080, videoHeight: 1920 }
  });

  expect(provider.subscribeDimensions).toBeTypeOf('function');
  expect(dimensions.at(-1)).toEqual({ width: 1080, height: 1920 });
});

// The SDK's own `resize` event carries the new intrinsic size in its payload
// ({ videoWidth, videoHeight }), so it needs no follow-up getter round trip.
test('vimeo republishes the intrinsic dimensions on the SDK resize event', async () => {
  const { sdk, dimensions } = await setup({
    fake: { videoWidth: 1080, videoHeight: 1920 }
  });

  sdk.instances[0]!.emit('resize', { videoWidth: 1920, videoHeight: 1080 });
  await flushMicrotasks();

  expect(dimensions.at(-1)).toEqual({ width: 1920, height: 1080 });
});

// A rejected getter is a measurement that did not happen, not a ratio of
// zero — the swallowed rejection has to reach the consumer as "not known".
test('vimeo reports unknown when the dimension getters reject', async () => {
  const { dimensions } = await setup({
    fake: {
      getVideoWidth: () => Promise.reject(new Error('no width')),
      getVideoHeight: () => Promise.reject(new Error('no height'))
    }
  });

  expect(dimensions).toContain(undefined);
  expect(dimensions.filter((entry) => entry !== undefined)).toEqual([]);
});

// `retry()` tears the embed down and builds another. Between the two, the old
// embed's ratio must not still be published: the replacement may take a while
// to answer, or never answer at all, and until it does a leftover ratio is
// reporting the shape of a video that is no longer there.
test('vimeo clears the dimensions when the player is torn down for a retry', async () => {
  let players = 0;
  const { provider, dimensions } = await setup({
    fake: {
      videoWidth: 1080,
      videoHeight: 1920,
      // Only the first embed ever becomes ready, so nothing masks a stale
      // value with a fresh measurement.
      ready: () =>
        ++players === 1 ? Promise.resolve() : new Promise<void>(() => {})
    }
  });
  expect(dimensions.at(-1)).toEqual({ width: 1080, height: 1920 });

  void provider.retry!();
  await flushMicrotasks();

  expect(dimensions.at(-1)).toBeUndefined();
});

test('vimeo clears the dimensions on destroy', async () => {
  const { provider, dimensions } = await setup({
    fake: { videoWidth: 1080, videoHeight: 1920 }
  });
  expect(dimensions).toContainEqual({ width: 1080, height: 1920 });

  await provider.destroy();

  expect(dimensions.at(-1)).toBeUndefined();
});

// --- the [startTime, endTime] boundary (#214) ---
// Vimeo expresses a start as a `#t=` fragment and has no end equivalent at all,
// so the adapter is the authority for both bounds: it seeks to the start itself
// and watches `timeupdate` to decide when the end is reached. The contract is
// the native provider's, resolved through `@reely/core`'s shared helper.

test('seeks to the start boundary once the player is ready', async () => {
  const { patches, sdk } = await setup({
    fake: { duration: 60 },
    options: { startTime: 12 }
  });

  expect(sdk.instances[0]!.setCurrentTime).toHaveBeenCalledWith(12);
  expect(readyPatch(patches)).toMatchObject({ currentTime: 12 });
});

// The fragment only saves the embed from loading at zero; the seek above is
// what the boundary actually rests on, so a sanitised-away start writes no
// hint rather than a `t=0s` one.
test.each([
  ['a positive start', 12, '#t=12s'],
  ['a fractional start', 12.5, '#t=12.5s'],
  ['no start', undefined, ''],
  ['a zero start', 0, ''],
  ['a negative start', -5, ''],
  ['a non-finite start', Number.NaN, '']
] as const)(
  'writes the embed-url time fragment for %s',
  async (_label, startTime, expected) => {
    const result = await setup({ options: { startTime } });
    expect(embedUrl(result).hash).toBe(expected);
  }
);

test('publishes ended at the end boundary, once, and pauses the embed', async () => {
  const { events, patches, sdk } = await setup({
    fake: { duration: 60 },
    options: { endTime: 20 }
  });
  const player = sdk.instances[0]!;
  player.emit('play', { duration: 60, percent: 0, seconds: 0 });
  const before = patches.length;

  player.emit('timeupdate', { duration: 60, percent: 0.34, seconds: 20.4 });

  expect(patches.slice(before)).toEqual([
    { playback: 'ended', buffering: false, currentTime: 20 }
  ]);
  expect(events.at(-1)).toMatchObject({ type: 'ended' });
  expect(player.pause).toHaveBeenCalled();

  // Vimeo keeps reporting time past the boundary until the pause lands; those
  // reports are out of the window and publish nothing at all.
  player.emit('timeupdate', { duration: 60, percent: 0.35, seconds: 21 });
  expect(patches.slice(before)).toHaveLength(1);
});

test('suppresses the pause the end boundary itself caused', async () => {
  const { patches, sdk } = await setup({
    fake: { duration: 60 },
    options: { endTime: 20 }
  });
  const player = sdk.instances[0]!;
  player.emit('play', { duration: 60, percent: 0, seconds: 0 });
  player.emit('timeupdate', { duration: 60, percent: 0.34, seconds: 20.4 });
  const afterEnd = patches.length;

  player.emit('pause', { duration: 60, percent: 0.34, seconds: 20.4 });

  expect(patches).toHaveLength(afterEnd);
});

test('bounds playback to the window when both ends are set', async () => {
  const { patches, sdk } = await setup({
    fake: { duration: 60 },
    options: { startTime: 10, endTime: 20 }
  });
  const player = sdk.instances[0]!;
  expect(player.setCurrentTime).toHaveBeenCalledWith(10);

  player.emit('timeupdate', { duration: 60, percent: 0.25, seconds: 15 });
  expect(patches.at(-1)).toMatchObject({ currentTime: 15 });

  player.emit('timeupdate', { duration: 60, percent: 0.34, seconds: 20.2 });
  expect(patches.at(-1)).toMatchObject({
    playback: 'ended',
    currentTime: 20
  });
});

// `loop=1` stays on the embed url, so Vimeo wraps on its own — to zero, and
// often without an `ended` event at all. The wrap guard is what puts the
// playhead back at the start boundary.
test('returns a looping embed to the start boundary after it wraps to zero', async () => {
  const { patches, sdk } = await setup({
    fake: { duration: 60 },
    options: { loop: true, startTime: 10 }
  });
  const player = sdk.instances[0]!;
  player.setCurrentTime.mockClear();

  player.emit('timeupdate', { duration: 60, percent: 0.006, seconds: 0.4 });
  await flushMicrotasks();

  expect(player.setCurrentTime).toHaveBeenLastCalledWith(10);
  expect(patches.at(-1)).toMatchObject({ currentTime: 10, buffering: false });
  expect(player.play).toHaveBeenCalled();
});

test('restarts rather than ending when a looping embed reaches the end boundary', async () => {
  const { events, patches, sdk } = await setup({
    fake: { duration: 60 },
    options: { loop: true, startTime: 5, endTime: 20 }
  });
  const player = sdk.instances[0]!;
  player.setCurrentTime.mockClear();

  player.emit('timeupdate', { duration: 60, percent: 0.34, seconds: 20.5 });
  await flushMicrotasks();

  expect(player.setCurrentTime).toHaveBeenLastCalledWith(5);
  expect(patches.at(-1)).toMatchObject({ currentTime: 5, buffering: false });
  expect(player.play).toHaveBeenCalled();

  // And the platform's own end, if it ever arrives, restarts too.
  player.setCurrentTime.mockClear();
  player.emit('ended', { duration: 60, percent: 1, seconds: 60 });
  await flushMicrotasks();
  expect(player.setCurrentTime).toHaveBeenLastCalledWith(5);

  expect(patches.some((patch) => patch.playback === 'ended')).toBe(false);
  expect(events.some((event) => event.type === 'ended')).toBe(false);
});

// Nothing to correct: `loop=1` already restarts the embed at zero, which is
// where an unset start boundary is. So the platform's own end stays the end it
// has always published, as it does on YouTube and Wistia.
test('keeps publishing ended for a looping embed with no start boundary', async () => {
  const { events, patches, sdk } = await setup({
    fake: { duration: 60 },
    options: { loop: true }
  });
  const player = sdk.instances[0]!;

  player.emit('ended', { duration: 60, percent: 1, seconds: 60 });
  await flushMicrotasks();

  expect(patches).toContainEqual({
    playback: 'ended',
    buffering: false,
    currentTime: 60
  });
  expect(events.at(-1)).toMatchObject({ type: 'ended' });
  expect(player.setCurrentTime).not.toHaveBeenCalled();
});

// The wrap guard compares against the duration-clamped start. Against the raw
// one, the position the restart seeks to reads as another wrap and the embed
// restarts on every single time report, forever.
test('does not restart-loop when the start boundary is past the duration', async () => {
  const { patches, sdk } = await setup({
    fake: { duration: 60 },
    options: { loop: true, startTime: 90 }
  });
  const player = sdk.instances[0]!;
  expect(player.setCurrentTime).toHaveBeenCalledWith(60);
  player.setCurrentTime.mockClear();

  player.emit('timeupdate', { duration: 60, percent: 1, seconds: 60 });
  await flushMicrotasks();

  expect(patches.at(-1)).toEqual({ currentTime: 60, duration: 60 });
  expect(player.setCurrentTime).not.toHaveBeenCalled();
  expect(player.play).not.toHaveBeenCalled();
});

// The sanitisation table of `@reely/core`'s helper, asserted through what the
// adapter does rather than what it computed.
test.each([
  ['an absent start', undefined],
  ['a zero start', 0],
  ['a negative start', -5],
  ['a NaN start', Number.NaN],
  ['an infinite start', Number.POSITIVE_INFINITY]
] as const)('issues no initial seek for %s', async (_label, startTime) => {
  const { sdk } = await setup({
    fake: { duration: 60 },
    options: { startTime }
  });
  expect(sdk.instances[0]!.setCurrentTime).not.toHaveBeenCalled();
});

test.each([
  ['an absent end', undefined],
  ['a NaN end', Number.NaN],
  ['an infinite end', Number.POSITIVE_INFINITY],
  ['an end equal to the start', 10],
  ['an end below the start', 5]
] as const)('applies no end boundary for %s', async (_label, endTime) => {
  const { patches, sdk } = await setup({
    fake: { duration: 60 },
    options: { startTime: 10, endTime }
  });

  sdk.instances[0]!.emit('timeupdate', {
    duration: 60,
    percent: 0.5,
    seconds: 30
  });

  expect(patches.at(-1)).toEqual({ currentTime: 30, duration: 60 });
});

test('clamps an end boundary past the duration to the duration', async () => {
  const { patches, sdk } = await setup({
    fake: { duration: 60 },
    options: { endTime: 90 }
  });

  sdk.instances[0]!.emit('timeupdate', {
    duration: 60,
    percent: 1,
    seconds: 60
  });

  expect(patches.at(-1)).toMatchObject({
    playback: 'ended',
    currentTime: 60
  });
});

test('collapses a start boundary past the effective end onto it', async () => {
  const { sdk } = await setup({
    fake: { duration: 60 },
    options: { startTime: 90 }
  });

  expect(sdk.instances[0]!.setCurrentTime).toHaveBeenCalledWith(60);
});

test('resumes from the start boundary after a boundary end', async () => {
  const { provider, sdk } = await setup({
    fake: { duration: 60 },
    options: { startTime: 10, endTime: 20 }
  });
  const player = sdk.instances[0]!;
  player.emit('timeupdate', { duration: 60, percent: 0.34, seconds: 20.5 });
  player.setCurrentTime.mockClear();

  await provider.play();

  expect(player.setCurrentTime).toHaveBeenLastCalledWith(10);
  expect(player.play).toHaveBeenCalled();
});

// The third leg of the parity claim above: the embed's own end, not the
// window's. This port already behaved this way; the assertion is here so the
// three ports and native cannot drift apart on it again.
test('resumes from the start boundary after the embed ends naturally', async () => {
  const { provider, sdk } = await setup({
    fake: { duration: 60 },
    options: { startTime: 10 }
  });
  const player = sdk.instances[0]!;
  player.emit('ended', { duration: 60, percent: 1, seconds: 60 });
  await flushMicrotasks();
  player.setCurrentTime.mockClear();

  await provider.play();

  expect(player.setCurrentTime).toHaveBeenLastCalledWith(10);
  expect(player.play).toHaveBeenCalled();
});

test('clamps a seek to the window instead of crossing the end boundary', async () => {
  const { patches, provider, sdk } = await setup({
    fake: { duration: 60 },
    options: { startTime: 10, endTime: 20 }
  });
  const player = sdk.instances[0]!;

  await provider.seekTo(45);
  expect(player.setCurrentTime).toHaveBeenLastCalledWith(20);
  await provider.seekTo(0);
  expect(player.setCurrentTime).toHaveBeenLastCalledWith(10);

  expect(patches.some((patch) => patch.playback === 'ended')).toBe(false);
});

// --- liveness is a documented gap (#187) ---
//
// The SDK reports nothing that separates a live event from a VOD, so this
// adapter publishes no `live` at all rather than guessing one. The test pins
// that: the key is absent from every patch, not present holding `null`. See
// the README's "What it reports honestly" for the surface that was checked.
//
// DELETE THIS TEST, and the README section it pins, if this adapter is ever
// made live-capable.
test('pins the liveness gap: no patch ever carries a live key (#187)', async () => {
  const { patches, provider, sdk } = await setup({ fake: { duration: 60 } });
  const player = sdk.instances[0]!;

  player.emit('play', { duration: 60, percent: 0, seconds: 0 });
  player.emit('timeupdate', { duration: 60, percent: 0.2, seconds: 12 });

  player.buffered = [[0, 30]];
  player.emit('progress', { duration: 60, percent: 0.5, seconds: 30 });
  await flushMicrotasks();

  // A duration that grows as playback runs on -- the only thing the SDK
  // offers that a live event and a VOD could ever be told apart by, and they
  // cannot.
  player.emit('durationchange', { duration: 90 });
  player.emit('timeupdate', { duration: 90, percent: 0.4, seconds: 36 });

  await provider.seekTo(48);
  player.emit('seeking', { duration: 90, percent: 0.53, seconds: 48 });
  player.emit('seeked', { duration: 90, percent: 0.53, seconds: 48 });
  player.emit('pause', { duration: 90, percent: 0.53, seconds: 48 });
  player.emit('ended', { duration: 90, percent: 1, seconds: 90 });
  await flushMicrotasks();

  // The lifecycle really ran, so the absence below is not a vacuous pass.
  expect(patches).toContainEqual(
    expect.objectContaining({ lifecycle: 'ready' })
  );
  expect(patches).toContainEqual(
    expect.objectContaining({ playback: 'playing' })
  );
  expect(patches.filter((patch) => 'live' in patch)).toEqual([]);
});
