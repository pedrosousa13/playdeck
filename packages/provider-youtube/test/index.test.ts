// @vitest-environment happy-dom

import { afterEach, expect, test, vi } from 'vitest';
import type { ProviderEvent, ProviderStatePatch } from '@reely/core';
import {
  createYouTubeProvider,
  PLAYBACK_CONFIRMATION_TIMEOUT_MS,
  type YouTubeIframeApi,
  type YouTubePlayer,
  type YouTubePlayerOptions
} from '../src/index';

const playerStates = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5
} as const;

type FakeCaptionTrack = {
  languageCode: string;
  displayName?: string;
  languageName?: string;
  vssId?: string;
  kind?: string;
};

type FakePlayerHarness = {
  readonly element: HTMLElement;
  readonly iframe: HTMLIFrameElement;
  readonly options: YouTubePlayerOptions;
  readonly player: YouTubePlayer;
  state: number;
  currentTime: number;
  duration: number;
  muted: boolean;
  volume: number;
  rate: number;
  captionsTracklist: FakeCaptionTrack[];
  captionsTrack: { languageCode?: string };
  fireReady: () => void;
  fireStateChange: (data: number) => void;
  fireError: (data: number) => void;
  fireRateChange: (data: number) => void;
  fireApiChange: () => void;
};

const createFakeYouTube = () => {
  const players: FakePlayerHarness[] = [];
  const Player = function (
    element: HTMLElement,
    options: YouTubePlayerOptions
  ) {
    const iframe = document.createElement('iframe');
    // A real src would make happy-dom fetch the embed; keep the suite offline.
    iframe.dataset.embedSrc = `${options.host ?? 'https://www.youtube.com'}/embed/${
      options.videoId ?? ''
    }`;
    element.replaceWith(iframe);
    const harness: FakePlayerHarness = {
      element,
      iframe,
      options,
      state: playerStates.UNSTARTED,
      currentTime: 0,
      duration: 120,
      muted: false,
      volume: 100,
      rate: 1,
      captionsTracklist: [],
      captionsTrack: {},
      player: {
        playVideo: vi.fn(),
        pauseVideo: vi.fn(),
        // The real iframe API proxies commands over postMessage: getters keep
        // returning pre-command values for a while. The fake mirrors that by
        // applying command effects on a later microtask.
        seekTo: vi.fn((seconds: number) => {
          queueMicrotask(() => {
            harness.currentTime = seconds;
          });
        }),
        mute: vi.fn(() => {
          queueMicrotask(() => {
            harness.muted = true;
          });
        }),
        unMute: vi.fn(() => {
          queueMicrotask(() => {
            harness.muted = false;
          });
        }),
        isMuted: () => harness.muted,
        setVolume: vi.fn((volume: number) => {
          queueMicrotask(() => {
            harness.volume = volume;
          });
        }),
        getVolume: () => harness.volume,
        getDuration: () => harness.duration,
        getCurrentTime: () => harness.currentTime,
        getPlaybackRate: () => harness.rate,
        setPlaybackRate: vi.fn(),
        getPlayerState: () => harness.state,
        getIframe: () => iframe,
        destroy: vi.fn(() => {
          iframe.remove();
        }),
        // Unofficial "module" API backing the captions/cc module.
        loadModule: vi.fn(),
        unloadModule: vi.fn(),
        getOptions: vi.fn((module: string) =>
          module === 'captions' ? ['tracklist', 'track'] : []
        ),
        getOption: vi.fn((module: string, option: string) => {
          if (module !== 'captions') return undefined;
          if (option === 'tracklist') return harness.captionsTracklist;
          if (option === 'track') return harness.captionsTrack;
          return undefined;
        }),
        setOption: vi.fn((module: string, option: string, value: unknown) => {
          if (module === 'captions' && option === 'track') {
            harness.captionsTrack = value as { languageCode?: string };
          }
        })
      },
      fireReady: () => options.events?.onReady?.({ target: harness.player }),
      fireStateChange: (data) => {
        harness.state = data;
        options.events?.onStateChange?.({ data, target: harness.player });
      },
      fireError: (data) =>
        options.events?.onError?.({ data, target: harness.player }),
      fireRateChange: (data) => {
        harness.rate = data;
        options.events?.onPlaybackRateChange?.({
          data,
          target: harness.player
        });
      },
      fireApiChange: () =>
        options.events?.onApiChange?.({ target: harness.player })
    };
    players.push(harness);
    return harness.player;
  } as unknown as YouTubeIframeApi['Player'];

  return {
    api: { Player, PlayerState: playerStates } as YouTubeIframeApi,
    players
  };
};

const createAdapter = (videoId = 'dQw4w9WgXcQ') => {
  const fake = createFakeYouTube();
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const provider = createYouTubeProvider(mount, videoId, {
    loadIframeApi: () => Promise.resolve(fake.api)
  });
  const patches: ProviderStatePatch[] = [];
  const events: ProviderEvent[] = [];
  provider.subscribe((patch, event) => {
    patches.push(patch);
    if (event) events.push(event);
  });
  return { events, fake, mount, patches, provider };
};

const readyAdapter = async (videoId?: string) => {
  const adapter = createAdapter(videoId);
  await adapter.provider.attach();
  await adapter.provider.load();
  const harness = adapter.fake.players[0]!;
  harness.fireReady();
  return { ...adapter, harness };
};

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

test('youtube adapter conforms to lifecycle and event-confirmed playback', async () => {
  const { fake, patches, provider } = createAdapter();

  await provider.attach();
  await provider.load();
  const harness = fake.players[0]!;
  harness.fireReady();

  const playResult = provider.play();
  expect(patches).not.toContainEqual(
    expect.objectContaining({ playback: 'playing' })
  );

  harness.fireStateChange(playerStates.PLAYING);
  await expect(playResult).resolves.toEqual({ ok: true });
  expect(patches).toContainEqual(
    expect.objectContaining({ playback: 'playing' })
  );

  const patchCount = patches.length;
  await provider.destroy();
  await provider.destroy();
  harness.fireStateChange(playerStates.PAUSED);
  expect(patches).toHaveLength(patchCount);
});

test('creates the player against the privacy-enhanced host without autoplay', async () => {
  const { fake, mount, provider } = createAdapter('M7lc1UVf-VE');

  await provider.attach();
  await provider.load();

  const harness = fake.players[0]!;
  expect(harness.options.host).toBe('https://www.youtube-nocookie.com');
  expect(harness.options.videoId).toBe('M7lc1UVf-VE');
  expect(harness.options.playerVars).toMatchObject({
    autoplay: 0,
    origin: window.location.origin,
    playsinline: 1
  });
  expect(mount.contains(harness.iframe)).toBe(true);
});

test('reports policy-restricted custom controls before the player is ready', async () => {
  const { patches, provider } = createAdapter();

  await provider.attach();

  expect(patches).toContainEqual(
    expect.objectContaining({
      capabilities: expect.objectContaining({
        customControls: { status: 'unavailable', reason: 'policy' },
        pictureInPicture: { status: 'unavailable', reason: 'provider' }
      })
    })
  );
});

test('maps player ready onto confirmed state and honest capabilities', async () => {
  const { events, fake, patches, provider } = createAdapter();
  await provider.attach();
  await provider.load();
  const harness = fake.players[0]!;
  harness.duration = 90;
  harness.muted = true;
  harness.volume = 40;
  harness.rate = 1.5;
  (
    harness.iframe as HTMLIFrameElement & {
      requestFullscreen: () => Promise<void>;
    }
  ).requestFullscreen = vi.fn();

  harness.fireReady();

  expect(patches).toContainEqual(
    expect.objectContaining({
      lifecycle: 'ready',
      activation: 'ready',
      duration: 90,
      muted: true,
      volume: 0.4,
      playbackRate: 1.5,
      capabilities: expect.objectContaining({
        seek: { status: 'available' },
        setVolume: { status: 'available' },
        setPlaybackRate: { status: 'available' },
        selectQuality: { status: 'unavailable', reason: 'provider' },
        selectTextTrack: { status: 'unavailable', reason: 'provider' },
        fullscreen: { status: 'available' },
        pictureInPicture: { status: 'unavailable', reason: 'provider' },
        airPlay: { status: 'unavailable', reason: 'provider' },
        customControls: { status: 'unavailable', reason: 'policy' }
      })
    })
  );
  expect(events).toContainEqual(expect.objectContaining({ type: 'ready' }));
});

test('distinguishes provider-not-ready from autoplay-blocked', async () => {
  vi.useFakeTimers();
  const { fake, provider } = createAdapter();
  await provider.attach();
  await provider.load();
  const harness = fake.players[0]!;

  await expect(provider.play?.()).resolves.toEqual({
    ok: false,
    reason: 'not-ready'
  });
  expect(harness.player.playVideo).not.toHaveBeenCalled();

  harness.fireReady();
  const blockedPlay = provider.play?.();
  expect(harness.player.playVideo).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(PLAYBACK_CONFIRMATION_TIMEOUT_MS);

  await expect(blockedPlay).resolves.toMatchObject({
    ok: false,
    reason: 'blocked',
    error: { category: 'policy', fatal: false, recoverable: true }
  });

  harness.fireStateChange(playerStates.PLAYING);
  await expect(provider.play?.()).resolves.toEqual({ ok: true });
});

test('maps YouTube player states onto confirmed playback patches and events', async () => {
  const { events, harness, patches } = await readyAdapter();

  harness.fireStateChange(playerStates.BUFFERING);
  expect(patches).toContainEqual(expect.objectContaining({ buffering: true }));

  harness.currentTime = 12;
  harness.fireStateChange(playerStates.PLAYING);
  expect(patches).toContainEqual(
    expect.objectContaining({
      playback: 'playing',
      buffering: false,
      currentTime: 12
    })
  );
  expect(events).toContainEqual(expect.objectContaining({ type: 'play' }));

  harness.fireStateChange(playerStates.PAUSED);
  expect(patches).toContainEqual(
    expect.objectContaining({ playback: 'paused' })
  );
  expect(events).toContainEqual(expect.objectContaining({ type: 'pause' }));

  harness.fireStateChange(playerStates.ENDED);
  expect(patches).toContainEqual(
    expect.objectContaining({ playback: 'ended', buffering: false })
  );
  expect(events).toContainEqual(expect.objectContaining({ type: 'ended' }));
});

test.each([
  [2, 'source', false],
  [5, 'provider', true],
  [100, 'source', false],
  [101, 'policy', false],
  [150, 'policy', false]
] as const)(
  'normalizes YouTube error code %i into a %s error',
  async (code, category, recoverable) => {
    const { events, harness, patches } = await readyAdapter();

    harness.fireError(code);

    expect(patches).toContainEqual(
      expect.objectContaining({
        lifecycle: 'error',
        activation: 'error',
        error: expect.objectContaining({ category, fatal: true, recoverable })
      })
    );
    expect(events).toContainEqual(expect.objectContaining({ type: 'error' }));
  }
);

test('a player error settles an unconfirmed play request as provider-error', async () => {
  vi.useFakeTimers();
  const { harness, provider } = await readyAdapter();

  const pendingPlay = provider.play?.();
  harness.fireError(5);

  await expect(pendingPlay).resolves.toMatchObject({
    ok: false,
    reason: 'provider-error',
    error: { category: 'provider' }
  });
});

test('seek commands validate input and confirm the reached position', async () => {
  const { harness, patches, provider } = await readyAdapter();

  await expect(provider.seekTo?.(Number.NaN)).resolves.toEqual({
    ok: false,
    reason: 'provider-error'
  });

  await expect(provider.seekTo?.(30)).resolves.toEqual({ ok: true });
  expect(harness.player.seekTo).toHaveBeenCalledWith(30, true);
  expect(patches).toContainEqual(expect.objectContaining({ currentTime: 30 }));

  await expect(provider.seekBy?.(-10)).resolves.toEqual({ ok: true });
  expect(harness.player.seekTo).toHaveBeenLastCalledWith(20, true);

  await expect(provider.seekBy?.(-100)).resolves.toEqual({ ok: true });
  expect(harness.player.seekTo).toHaveBeenLastCalledWith(0, true);
});

test('volume commands convert the 0-1 contract onto the YouTube 0-100 scale', async () => {
  const { events, harness, patches, provider } = await readyAdapter();

  await expect(provider.mute?.()).resolves.toEqual({ ok: true });
  expect(patches).toContainEqual(expect.objectContaining({ muted: true }));

  await expect(provider.setVolume?.(0.5)).resolves.toEqual({ ok: true });
  expect(harness.player.setVolume).toHaveBeenCalledWith(50);
  expect(patches).toContainEqual(
    expect.objectContaining({ muted: true, volume: 0.5 })
  );

  await expect(provider.unmute?.()).resolves.toEqual({ ok: true });
  expect(patches).toContainEqual(
    expect.objectContaining({ muted: false, volume: 0.5 })
  );
  expect(
    events.filter(({ type }) => type === 'volumechange').length
  ).toBeGreaterThanOrEqual(3);

  await expect(provider.setVolume?.(Number.NaN)).resolves.toEqual({
    ok: false,
    reason: 'provider-error'
  });
});

test('commands emit intended values instead of stale YouTube read-backs', async () => {
  const { harness, patches, provider } = await readyAdapter();

  const mutePending = provider.mute?.();
  // The fake has not applied the command yet, mirroring postMessage latency.
  expect(harness.player.isMuted()).toBe(false);
  expect(patches).toContainEqual(expect.objectContaining({ muted: true }));
  await mutePending;

  const volumePending = provider.setVolume?.(0.5);
  expect(harness.player.getVolume()).toBe(100);
  expect(patches).toContainEqual(
    expect.objectContaining({ muted: true, volume: 0.5 })
  );
  await volumePending;

  const seekPending = provider.seekTo?.(30);
  expect(harness.player.getCurrentTime()).toBe(0);
  expect(patches).toContainEqual(expect.objectContaining({ currentTime: 30 }));
  await seekPending;
});

test('a paused seek keeps the intended position without a stale correction', async () => {
  const { harness, patches, provider } = await readyAdapter();

  harness.fireStateChange(playerStates.PLAYING);
  harness.fireStateChange(playerStates.PAUSED);

  await expect(provider.seekTo?.(45)).resolves.toEqual({ ok: true });
  // Paused playback never polls, so the emitted position must already be the
  // intended target rather than a read-back the player has not applied yet.
  expect(patches.at(-1)).toEqual({ currentTime: 45 });

  await expect(provider.seekBy?.(-5)).resolves.toEqual({ ok: true });
  expect(harness.player.seekTo).toHaveBeenLastCalledWith(40, true);
});

test('buffering confirms an accepted play request on a slow network', async () => {
  vi.useFakeTimers();
  const { harness, patches, provider } = await readyAdapter();

  const slowPlay = provider.play?.();
  harness.fireStateChange(playerStates.UNSTARTED);
  harness.fireStateChange(playerStates.BUFFERING);

  await expect(slowPlay).resolves.toEqual({ ok: true });

  // Playback only starts after the blocked-detection window has passed.
  await vi.advanceTimersByTimeAsync(PLAYBACK_CONFIRMATION_TIMEOUT_MS + 1_000);
  harness.fireStateChange(playerStates.PLAYING);

  expect(patches).toContainEqual(
    expect.objectContaining({ playback: 'playing' })
  );
});

test('a missed state event at the confirmation deadline is not misreported as blocked', async () => {
  vi.useFakeTimers();
  const { harness, provider } = await readyAdapter();

  const pendingPlay = provider.play?.();
  // The player reached PLAYING but the state-change event never arrived.
  harness.state = playerStates.PLAYING;
  await vi.advanceTimersByTimeAsync(PLAYBACK_CONFIRMATION_TIMEOUT_MS);

  await expect(pendingPlay).resolves.toEqual({ ok: true });
});

test('playback rate confirms through the provider rate-change event', async () => {
  const { events, harness, patches, provider } = await readyAdapter();

  await expect(provider.setPlaybackRate?.(1.5)).resolves.toEqual({ ok: true });
  expect(harness.player.setPlaybackRate).toHaveBeenCalledWith(1.5);
  expect(patches).not.toContainEqual(
    expect.objectContaining({ playbackRate: 1.5 })
  );

  harness.fireRateChange(1.5);
  expect(patches).toContainEqual(
    expect.objectContaining({ playbackRate: 1.5 })
  );
  expect(events).toContainEqual(
    expect.objectContaining({ type: 'ratechange' })
  );

  await expect(provider.setPlaybackRate?.(0)).resolves.toEqual({
    ok: false,
    reason: 'provider-error'
  });
});

test('fullscreen targets the YouTube iframe so provider controls stay intact', async () => {
  const { harness, provider } = await readyAdapter();
  const requestFullscreen = vi.fn(() => Promise.resolve());
  (
    harness.iframe as HTMLIFrameElement & {
      requestFullscreen: () => Promise<void>;
    }
  ).requestFullscreen = requestFullscreen;

  await expect(provider.requestFullscreen?.()).resolves.toEqual({ ok: true });
  expect(requestFullscreen).toHaveBeenCalledTimes(1);
});

test('reports fullscreen as unsupported when the iframe cannot fullscreen', async () => {
  const { provider } = await readyAdapter();

  await expect(provider.requestFullscreen?.()).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });
});

test('tracks fullscreen entered from inside the YouTube iframe chrome', async () => {
  const { events, harness, patches, provider } = await readyAdapter();

  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => harness.iframe
  });
  document.dispatchEvent(new Event('fullscreenchange'));

  expect(patches).toContainEqual(expect.objectContaining({ fullscreen: true }));
  expect(events).toContainEqual(
    expect.objectContaining({
      type: 'fullscreenchange',
      detail: { fullscreen: true }
    })
  );

  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => null
  });
  document.dispatchEvent(new Event('fullscreenchange'));

  expect(patches).toContainEqual(
    expect.objectContaining({ fullscreen: false })
  );

  await expect(provider.exitFullscreen?.()).resolves.toEqual({ ok: true });
});

test('polls the current time only while confirmed playing', async () => {
  vi.useFakeTimers();
  const { harness, patches } = await readyAdapter();

  harness.fireStateChange(playerStates.PLAYING);
  harness.currentTime = 3;
  await vi.advanceTimersByTimeAsync(300);
  expect(patches).toContainEqual(expect.objectContaining({ currentTime: 3 }));

  harness.fireStateChange(playerStates.PAUSED);
  harness.currentTime = 9;
  await vi.advanceTimersByTimeAsync(1_000);
  expect(patches).not.toContainEqual(
    expect.objectContaining({ currentTime: 9 })
  );
});

test('destroy tears the player down and blocks stale async callbacks', async () => {
  vi.useFakeTimers();
  const { harness, mount, patches, provider } = await readyAdapter();

  harness.fireStateChange(playerStates.PLAYING);
  const pendingPlay = provider.play?.();
  const patchCount = patches.length;

  await provider.destroy();

  expect(harness.player.destroy).toHaveBeenCalledTimes(1);
  expect(mount.children).toHaveLength(0);
  await expect(pendingPlay).resolves.toEqual({ ok: true });

  harness.fireStateChange(playerStates.PAUSED);
  harness.fireError(5);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(patches).toHaveLength(patchCount);
});

test('destroy settles an unconfirmed play request as not-ready', async () => {
  vi.useFakeTimers();
  const { provider } = await readyAdapter();

  const pendingPlay = provider.play?.();
  await provider.destroy();

  await expect(pendingPlay).resolves.toEqual({
    ok: false,
    reason: 'not-ready'
  });
});

test('a source switch mid-load never constructs a stale player', async () => {
  const fake = createFakeYouTube();
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  let releaseApi = (): void => undefined;
  const gate = new Promise<YouTubeIframeApi>((resolve) => {
    releaseApi = () => resolve(fake.api);
  });
  const provider = createYouTubeProvider(mount, 'dQw4w9WgXcQ', {
    loadIframeApi: () => gate
  });

  await provider.attach();
  const loading = provider.load();
  await provider.destroy();
  releaseApi();
  await loading;

  expect(fake.players).toHaveLength(0);
  expect(mount.children).toHaveLength(0);
});

test('retry recreates the player after a failed API load', async () => {
  const fake = createFakeYouTube();
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  let failNext = true;
  const provider = createYouTubeProvider(mount, 'dQw4w9WgXcQ', {
    loadIframeApi: () =>
      failNext
        ? Promise.reject(new Error('offline'))
        : Promise.resolve(fake.api)
  });
  const patches: ProviderStatePatch[] = [];
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();
  await expect(provider.load()).rejects.toThrow('offline');

  failNext = false;
  await expect(provider.retry?.()).resolves.toEqual({ ok: true });
  expect(fake.players).toHaveLength(1);

  fake.players[0]!.fireReady();
  expect(patches).toContainEqual(
    expect.objectContaining({ lifecycle: 'ready', activation: 'ready' })
  );
});

test('retry reports a contained failure while the API stays unreachable', async () => {
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const provider = createYouTubeProvider(mount, 'dQw4w9WgXcQ', {
    loadIframeApi: () => Promise.reject(new Error('still offline'))
  });

  await provider.attach();
  await expect(provider.load()).rejects.toThrow('still offline');
  await expect(provider.retry?.()).resolves.toMatchObject({
    ok: false,
    reason: 'provider-error',
    error: { message: 'still offline' }
  });
});

test('discovers caption tracks from the captions module and reports provider rendering', async () => {
  const { harness, patches } = await readyAdapter();
  harness.captionsTracklist = [
    { languageCode: 'en', displayName: 'English' },
    { languageCode: 'fr', languageName: 'French' }
  ];

  harness.fireApiChange();

  expect(patches).toContainEqual(
    expect.objectContaining({
      textTracks: [
        {
          id: 'youtube:en',
          label: 'English',
          language: 'en',
          kind: 'captions',
          readiness: 'loaded'
        },
        {
          id: 'youtube:fr',
          label: 'French',
          language: 'fr',
          kind: 'captions',
          readiness: 'loaded'
        }
      ],
      captionRendering: 'provider',
      capabilities: expect.objectContaining({
        selectTextTrack: { status: 'available' }
      })
    })
  );
});

test('reports caption rendering as unavailable when the video has no caption tracks', async () => {
  const { harness, patches } = await readyAdapter();
  harness.captionsTracklist = [];

  harness.fireApiChange();

  expect(patches).toContainEqual(
    expect.objectContaining({
      textTracks: [],
      captionRendering: 'unavailable',
      capabilities: expect.objectContaining({
        selectTextTrack: { status: 'unavailable', reason: 'provider' }
      })
    })
  );
});

test('reflects the caption track already active in the player on discovery', async () => {
  const { harness, patches } = await readyAdapter();
  harness.captionsTracklist = [
    { languageCode: 'en', displayName: 'English' },
    { languageCode: 'fr', displayName: 'French' }
  ];
  harness.captionsTrack = { languageCode: 'fr' };

  harness.fireApiChange();

  expect(patches).toContainEqual(
    expect.objectContaining({ selectedTextTrackId: 'youtube:fr' })
  );
});

test('selectTextTrack maps a track id onto a YouTube language code', async () => {
  const { harness, patches, provider } = await readyAdapter();
  harness.captionsTracklist = [
    { languageCode: 'en', displayName: 'English' },
    { languageCode: 'fr', displayName: 'French' }
  ];
  harness.fireApiChange();

  await expect(provider.selectTextTrack?.('youtube:fr')).resolves.toEqual({
    ok: true
  });

  expect(harness.player.setOption).toHaveBeenCalledWith('captions', 'track', {
    languageCode: 'fr'
  });
  expect(patches).toContainEqual(
    expect.objectContaining({ selectedTextTrackId: 'youtube:fr' })
  );
});

test('selectTextTrack(null) turns captions off', async () => {
  const { harness, patches, provider } = await readyAdapter();
  harness.captionsTracklist = [{ languageCode: 'en', displayName: 'English' }];
  harness.fireApiChange();
  await provider.selectTextTrack?.('youtube:en');

  await expect(provider.selectTextTrack?.(null)).resolves.toEqual({
    ok: true
  });

  expect(harness.player.setOption).toHaveBeenLastCalledWith(
    'captions',
    'track',
    {}
  );
  expect(patches).toContainEqual(
    expect.objectContaining({ selectedTextTrackId: null })
  );
});

test('selectTextTrack rejects an id that is not in the current tracklist', async () => {
  const { harness, provider } = await readyAdapter();
  harness.captionsTracklist = [{ languageCode: 'en', displayName: 'English' }];
  harness.fireApiChange();

  await expect(provider.selectTextTrack?.('youtube:de')).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });
  expect(harness.player.setOption).not.toHaveBeenCalled();
});
