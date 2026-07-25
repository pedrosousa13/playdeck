// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true } }

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  detectSource,
  type ProviderAdapter,
  type ProviderEvent,
  type ProviderStateListener,
  type ProviderStatePatch,
  type TextCue,
  type VimeoSource
} from '@reely/core';
import {
  createVimeoProvider,
  type VimeoMountElement,
  type VimeoProviderOptions
} from '../src/index';
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
  await provider.attach();
  await provider.load();
  return { mount, sdk, provider, patches, events };
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
  expect(url.searchParams.get('playsinline')).toBe('1');
  expect(url.searchParams.get('h')).toBeNull();
  const iframe = result.sdk.instances[0]!.element;
  expect(iframe.parentElement).toBe(result.mount);
  expect(iframe.getAttribute('allow')).toContain('autoplay');
  expect(iframe.getAttribute('allow')).toContain('fullscreen');
  expect(iframe.getAttribute('allow')).toContain('picture-in-picture');
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
    }
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
    selectQuality: { status: 'unavailable', reason: 'provider' },
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
  const { patches } = await setup();
  expect(readyPatch(patches).capabilities).toMatchObject({
    customControls: { status: 'unavailable', reason: 'provider-plan' }
  });
  expect(fetchMock).toHaveBeenCalledWith(
    'https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871'
  );
});

test('resolves the plan for unlisted videos through the hashed watch URL', async () => {
  fetchMock.mockResolvedValue(oembedResponse('free'));
  const { patches } = await setup({
    source: { type: 'vimeo', videoId: '76979871', hash: 'abc123' }
  });
  expect(readyPatch(patches).capabilities).toMatchObject({
    customControls: { status: 'unavailable', reason: 'provider-plan' }
  });
  expect(fetchMock).toHaveBeenCalledWith(
    'https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871%2Fabc123'
  );
});

test('keeps chromeless capability unknown when the plan cannot be resolved', async () => {
  fetchMock.mockRejectedValue(new Error('offline'));
  const { patches } = await setup();
  expect(readyPatch(patches).capabilities).toMatchObject({
    customControls: { status: 'unknown', reason: 'provider-check' }
  });
});

test('keeps chromeless capability unknown for unrecognized account tiers', async () => {
  fetchMock.mockResolvedValue(oembedResponse('future_tier'));
  const { patches } = await setup();
  expect(readyPatch(patches).capabilities).toMatchObject({
    customControls: { status: 'unknown', reason: 'provider-check' }
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

  sdk.instances[0]!.emit(
    'cuechange',
    cueChangePayload([{ text: 'rock &amp; roll &lt;loud&gt;&nbsp;now' }])
  );

  expect(seen.at(-1)?.[0]?.text).toBe('rock & roll <loud>\u00a0now');
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

  player.emit('progress', { duration: 60, percent: 0.5, seconds: 30 });
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
