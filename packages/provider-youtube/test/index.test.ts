// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "navigation": { "disableChildFrameNavigation": true } } }
//
// This suite stays offline, and the option above is what now keeps it so. The
// adapter builds the embed iframe itself and gives it a real `src`, and
// happy-dom loads an iframe's page as soon as the element is connected — so
// every attach here would otherwise reach youtube-nocookie.com over the
// network. With child-frame navigation disabled the frame keeps its url and
// fetches nothing, so the url stays assertable and no request leaves. Before
// the iframe was the adapter's, the fake's `data-embed-src` is what kept this
// promise; the promise is the same one.
//
// `provider-vimeo/test/index.test.ts` buys the same guarantee with
// `disableIframePageLoading`, which happy-dom deprecates in favour of this
// setting and which logs a `NotSupportedError` per frame rather than staying
// quiet. Same intent, newer spelling.

import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import {
  PlayerController,
  type ProviderEvent,
  type ProviderStatePatch
} from '@playdeck/core';
import {
  createYouTubeProvider,
  PLAYBACK_CONFIRMATION_TIMEOUT_MS,
  PLAYER_READY_TIMEOUT_MS,
  type YouTubeIframeApi,
  type YouTubePlayer,
  type YouTubePlayerOptions,
  type YouTubeProviderOptions
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
  readonly iframe: HTMLIFrameElement;
  readonly options: YouTubePlayerOptions;
  readonly player: YouTubePlayer;
  state: number;
  currentTime: number;
  duration: number;
  loadedFraction: number;
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
  // Handed an iframe that already exists, the real API adopts it rather than
  // building one of its own, and answers it from `getIframe()`. Everything
  // about the embed — its host, its video and its player vars — is on the
  // `src` the caller wrote, so this fake reads nothing from `options` but the
  // events.
  const Player = function (
    iframe: HTMLIFrameElement,
    options: YouTubePlayerOptions
  ) {
    const harness: FakePlayerHarness = {
      iframe,
      options,
      state: playerStates.UNSTARTED,
      currentTime: 0,
      duration: 120,
      loadedFraction: 0,
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
        getVideoLoadedFraction: () => harness.loadedFraction,
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

// Where the embed is described now: the adapter builds the iframe, so its host,
// its video and every player var are on the url it carries into the document
// rather than in the options the constructor is called with.
const embedUrl = (harness: FakePlayerHarness): URL =>
  new URL(harness.iframe.src);

const embedVars = (harness: FakePlayerHarness): Record<string, string> =>
  Object.fromEntries(embedUrl(harness).searchParams);

const createAdapter = (
  videoId = 'dQw4w9WgXcQ',
  options: YouTubeProviderOptions = {}
) => {
  const fake = createFakeYouTube();
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const provider = createYouTubeProvider(mount, videoId, {
    ...options,
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

const readyAdapter = async (
  videoId?: string,
  options: YouTubeProviderOptions = {}
) => {
  const adapter = createAdapter(videoId, options);
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

// --- rejected video id ---

test.each([
  ['a script-injection payload', '"><script>alert(1)</script>'],
  ['a path-traversal payload with a quote break', '../../evil" x="y'],
  ['a value containing whitespace', 'a b']
])('rejects a video id that is %s', async (_form, videoId) => {
  const { events, fake, patches, provider } = createAdapter(videoId);

  await provider.attach();
  await provider.load();
  await provider.destroy();

  expect(patches).toContainEqual(
    expect.objectContaining({
      lifecycle: 'error',
      activation: 'error',
      commandsReady: false,
      error: expect.objectContaining({
        category: 'source',
        fatal: true,
        recoverable: true
      })
    })
  );
  expect(patches[0]?.error?.message).not.toContain(videoId);
  expect(events).toContainEqual(expect.objectContaining({ type: 'error' }));

  // The iframe API's player constructor is the acceptance-critical call site:
  // it must never be reached on the rejected path.
  expect(fake.players).toHaveLength(0);

  // Every command on a rejected adapter is a no-op that resolves rather than
  // hangs or throws.
  await expect(provider.play()).resolves.toEqual({
    ok: false,
    reason: 'not-ready'
  });
});

test('rejects a video id even when loop is requested, never reaching the playlist var', async () => {
  const { fake, provider } = createAdapter('a b', { loop: true });

  await provider.attach();
  await provider.load();

  expect(fake.players).toHaveLength(0);
});

test('reports the rejected-id error to a subscriber that arrives late', async () => {
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const provider = createYouTubeProvider(mount, 'a b');

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

test('a valid video id still constructs the player exactly as before, unaffected by validation', async () => {
  const { fake, provider } = createAdapter('M7lc1UVf-VE');

  await provider.attach();
  await provider.load();

  expect(fake.players).toHaveLength(1);
  const harness = fake.players[0]!;
  expect(embedUrl(harness).origin).toBe('https://www.youtube-nocookie.com');
  expect(embedUrl(harness).pathname).toBe('/embed/M7lc1UVf-VE');
  expect(embedVars(harness)).toMatchObject({
    enablejsapi: '1',
    autoplay: '0',
    controls: '0',
    loop: '0',
    playsinline: '1',
    rel: '0'
  });
  expect(harness.iframe.getAttribute('width')).toBe('100%');
  expect(harness.iframe.getAttribute('height')).toBe('100%');
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
  expect(embedUrl(harness).origin).toBe('https://www.youtube-nocookie.com');
  expect(embedUrl(harness).pathname).toBe('/embed/M7lc1UVf-VE');
  expect(embedVars(harness)).toMatchObject({
    autoplay: '0',
    origin: window.location.origin,
    playsinline: '1'
  });
  expect(mount.contains(harness.iframe)).toBe(true);
});

// The `Referer` header goes out with the iframe's very first request, so the
// policy has to be on the element before it is in the document: an attribute
// written afterwards changes nothing about a request already sent. That
// ordering is the whole point of building the iframe here rather than letting
// the iframe API build one.
test('declares the referrer policy before the embed iframe enters the document', async () => {
  const { fake, mount, provider } = createAdapter('M7lc1UVf-VE');
  const policiesAtAppend: (string | null)[] = [];
  const append = mount.appendChild.bind(mount);
  mount.appendChild = (<T extends Node>(node: T): T => {
    policiesAtAppend.push(
      node instanceof Element ? node.getAttribute('referrerpolicy') : null
    );
    return append(node);
  }) as typeof mount.appendChild;

  await provider.attach();
  await provider.load();

  expect(policiesAtAppend).toEqual(['strict-origin-when-cross-origin']);
  expect(fake.players[0]!.iframe.getAttribute('referrerpolicy')).toBe(
    'strict-origin-when-cross-origin'
  );
});

// `host` decides the origin the embed iframe is built from, so only the two
// origins YouTube serves that embed from are honoured. These two are written
// into the embed url unchanged.
test.each([
  ['https://www.youtube.com'],
  ['https://www.youtube-nocookie.com']
] as const)('uses the %s host option as given', async (host) => {
  const { fake, provider } = createAdapter('M7lc1UVf-VE', { host });

  await provider.attach();
  await provider.load();

  const harness = fake.players[0]!;
  expect(embedUrl(harness).origin).toBe(host);
  // The `origin` player var is the embedding page's own origin for an accepted
  // `host` as much as for a rejected one: it is the origin YouTube validates
  // postMessage against, and it never tracks `host` in either direction.
  expect(embedVars(harness)).toMatchObject({
    origin: window.location.origin
  });
});

// The comparison is on the parsed origin, so the spellings a browser resolves
// to the same origin are recognised rather than read as a third host.
test.each([
  ['a trailing slash', 'https://www.youtube.com/', 'https://www.youtube.com'],
  [
    'upper-case letters',
    'HTTPS://WWW.YOUTUBE-NOCOOKIE.COM',
    'https://www.youtube-nocookie.com'
  ]
] as const)(
  'accepts a recognised host option written with %s',
  async (_label, host, expected) => {
    const { fake, provider } = createAdapter('M7lc1UVf-VE', { host });

    await provider.attach();
    await provider.load();

    const harness = fake.players[0]!;
    expect(embedUrl(harness).origin).toBe(expected);
    expect(embedVars(harness)).toMatchObject({
      origin: window.location.origin
    });
  }
);

// An unrecognised `host` falls back rather than throwing: a misconfigured
// option must degrade to the safe embed, not break the page. The lookalike is
// on the list because an origin that merely ends in a YouTube name is a
// different origin, and the malformed and empty values because `new URL()`
// rejects both — all four are the same answer.
test.each([
  ['an unrelated origin', 'https://videos.example.com'],
  ['a lookalike origin', 'https://www.youtube.com.example.com'],
  ['a malformed url', 'www.youtube.com'],
  ['an empty string', '']
] as const)(
  'falls back to the privacy-enhanced host when the host option is %s',
  async (_label, host) => {
    const { fake, provider } = createAdapter('M7lc1UVf-VE', { host });

    await provider.attach();
    await provider.load();

    const harness = fake.players[0]!;
    expect(embedUrl(harness).origin).toBe('https://www.youtube-nocookie.com');
    // The `origin` player var is the embedding page's own origin, not the
    // host — it is what a wrong `host` would have disclosed the page to. It
    // never carries the rejected value.
    expect(embedVars(harness)).toMatchObject({
      origin: window.location.origin
    });
  }
);

// The fallback above used to be silent; it now also publishes a non-fatal
// `configuration` notice, so a rejected `host` is observable rather than
// merely safe (#235).
test('does not publish a notice when host is unset', () => {
  const { patches } = createAdapter('M7lc1UVf-VE');

  expect(patches).toHaveLength(0);
});

test.each([
  ['https://www.youtube.com'],
  ['https://www.youtube-nocookie.com']
] as const)('does not publish a notice for the %s host option', (host) => {
  const { patches } = createAdapter('M7lc1UVf-VE', { host });

  expect(patches).toHaveLength(0);
});

test.each([
  ['an unrelated origin', 'https://videos.example.com'],
  ['a lookalike origin', 'https://www.youtube.com.example.com'],
  ['a malformed url', 'www.youtube.com'],
  ['an empty string', '']
] as const)(
  'publishes a configuration notice when the host option is %s',
  (_label, host) => {
    const { patches } = createAdapter('M7lc1UVf-VE', { host });

    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({
      error: {
        category: 'configuration',
        fatal: false,
        recoverable: false
      }
    });
    // Not a state transition: only `error` is set.
    expect(patches[0]?.lifecycle).toBeUndefined();
    expect(patches[0]?.activation).toBeUndefined();
    expect(patches[0]?.commandsReady).toBeUndefined();
    // Names the option and the fallback, never the rejected value.
    expect(patches[0]?.error?.message).toBe(
      'The host option was rejected, so the default host was used.'
    );
    if (host) expect(patches[0]?.error?.message).not.toContain(host);
  }
);

test('delivers the host notice to a subscriber that registers late', () => {
  const fake = createFakeYouTube();
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const provider = createYouTubeProvider(mount, 'M7lc1UVf-VE', {
    host: 'https://videos.example.com',
    loadIframeApi: () => Promise.resolve(fake.api)
  });

  const late: ProviderStatePatch[] = [];
  provider.subscribe((patch) => late.push(patch));

  expect(late).toHaveLength(1);
  expect(late[0]).toMatchObject({
    error: { category: 'configuration', fatal: false, recoverable: false }
  });
});

// Vimeo's own embed url sets `controls` the same way
// (`provider-vimeo/src/attachment.ts:62`, `options.controls === true ? '1' :
// '0'`): unset and `false` both mean chromeless. This pins YouTube to the
// same polarity so the two cannot drift.
test.each([
  ['unset', undefined, '0'],
  ['false', false, '0'],
  ['true', true, '1']
] as const)(
  'sets the controls player var to the expected value when the controls option is %s',
  async (_label, controls, expected) => {
    const { fake, provider } = createAdapter('M7lc1UVf-VE', { controls });

    await provider.attach();
    await provider.load();

    const harness = fake.players[0]!;
    expect(embedVars(harness)).toMatchObject({ controls: expected });
  }
);

// SIDEPRO-210. `loop: 1` on its own is a documented no-op for a single-video
// embed -- YouTube loops a *playlist*, so the one video has to be named as its
// own single-entry playlist for the loop var to mean anything. Setting one
// without the other is the same silent no-op the issue is about, so both vars
// are pinned together here.
test.each([
  ['unset', undefined],
  ['false', false]
] as const)(
  'leaves the embed un-looped when the loop option is %s',
  async (_label, loop) => {
    const { fake, provider } = createAdapter('M7lc1UVf-VE', { loop });

    await provider.attach();
    await provider.load();

    const vars = embedVars(fake.players[0]!);
    expect(vars).toMatchObject({ loop: '0' });
    expect(vars).not.toHaveProperty('playlist');
  }
);

test('loops a single video by naming it as its own playlist', async () => {
  const { fake, provider } = createAdapter('M7lc1UVf-VE', { loop: true });

  await provider.attach();
  await provider.load();

  expect(embedVars(fake.players[0]!)).toMatchObject({
    loop: '1',
    playlist: 'M7lc1UVf-VE'
  });
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
        selectTextTrack: { status: 'unavailable', reason: 'source' },
        chapters: { status: 'unavailable', reason: 'provider' },
        fullscreen: { status: 'available' },
        pictureInPicture: { status: 'unavailable', reason: 'provider' },
        airPlay: { status: 'unavailable', reason: 'provider' },
        customControls: { status: 'unavailable', reason: 'policy' }
      })
    })
  );
  expect(events).toContainEqual(expect.objectContaining({ type: 'ready' }));
});

// The one duration revision a load performs. Measured August 2026 over 7 loads
// of 4 videos: `onReady` answers a whole-second metadata duration and the exact
// media duration replaces it at the transition to PLAYING, every time. The pair
// below is a real one. The re-read in the PLAYING branch of
// `onPlayerStateChange` is the only thing that carries the correction into
// state — drop it, or drop `duration` from that patch, and the rounded value
// stands for the rest of the session (#403).
test('republishes a duration the player revises between ready and playing', async () => {
  vi.useFakeTimers();
  const { fake, patches, provider } = createAdapter();
  await provider.attach();
  await provider.load();
  const harness = fake.players[0]!;

  harness.duration = 1344;
  harness.fireReady();

  expect(patches).toContainEqual(
    expect.objectContaining({ lifecycle: 'ready', duration: 1344 })
  );

  harness.duration = 1343.661;
  harness.fireStateChange(playerStates.PLAYING);
  await vi.advanceTimersByTimeAsync(300);

  expect(patches).toContainEqual(
    expect.objectContaining({ playback: 'playing', duration: 1343.661 })
  );
  // The revision is the last word on the duration, not merely present
  // somewhere: a later patch restating 1344 would mis-scale the seek bar just
  // as a missing republish would.
  expect(
    patches.filter((patch) => patch.duration !== undefined).at(-1)?.duration
  ).toBe(1343.661);
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

test('reports a muted volume-arrow press as the one change it makes', async () => {
  const { events, fake, provider } = createAdapter();
  await provider.attach();
  await provider.load();
  const harness = fake.players[0]!;
  // A muted player at half volume: the ready snapshot adopts both, so the
  // mirrors start where the press finds them.
  harness.muted = true;
  harness.volume = 50;
  harness.fireReady();
  const before = events.filter(({ type }) => type === 'volumechange').length;

  // The command pair a muted `ArrowUp` issues (#274): the unmute that restores
  // the sound, and the volume request that records the level it is restoring
  // to. The second asks for the volume the adapter already holds, so it is
  // silent here and on every other adapter. The unmute is the one real change,
  // and every other adapter reports it once too — through its event path
  // rather than its command path: native's element fires `volumechange` for
  // the `muted` assignment and HLS inherits that, Vimeo's `volumechange`
  // subscription carries the muted half, and Wistia's is `mute-change`. One
  // press, one real change, one event, on all five (#365).
  await expect(provider.unmute?.()).resolves.toEqual({ ok: true });
  await expect(provider.setVolume?.(0.5)).resolves.toEqual({ ok: true });

  expect(harness.player.setVolume).toHaveBeenCalledWith(50);
  expect(
    events.filter(({ type }) => type === 'volumechange').length - before
  ).toBe(1);
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

// --- buffered ranges (#91) ---
//
// `getVideoLoadedFraction()` is not the fraction of the video that is loaded:
// measured against live YouTube it is the END of the buffered range holding the
// playhead, over duration. It jumps on a forward seek and falls back again on a
// backward one, so the range's start is not knowable. The playhead is the only
// point we know to be inside that range, so it anchors what we report.

const bufferedIn = (
  patches: readonly ProviderStatePatch[]
): ReadonlyArray<ProviderStatePatch['buffered']> =>
  patches
    .filter((patch) => patch.buffered !== undefined)
    .map((patch) => patch.buffered);

test('reports the buffered edge as a range anchored at the playhead', async () => {
  vi.useFakeTimers();
  const { harness, patches } = await readyAdapter();

  harness.duration = 1344;
  harness.currentTime = 941;
  harness.loadedFraction = 0.7162;
  harness.fireStateChange(playerStates.PLAYING);
  await vi.advanceTimersByTimeAsync(300);

  expect(bufferedIn(patches).at(-1)).toEqual([
    { start: 941, end: 1344 * 0.7162 }
  ]);
  // The scaled fraction as a range from zero would have claimed the first 950
  // seconds were buffered when only ~33 of them were.
  expect(bufferedIn(patches)).not.toContainEqual([
    { start: 0, end: 1344 * 0.7162 }
  ]);
});

test('holds the range start where playback entered the buffer', async () => {
  vi.useFakeTimers();
  const { harness, patches } = await readyAdapter();

  harness.duration = 120;
  harness.currentTime = 10;
  harness.loadedFraction = 0.5;
  harness.fireStateChange(playerStates.PLAYING);
  await vi.advanceTimersByTimeAsync(300);

  // Playing on does not narrow the range: 10 was inside the buffer, and the
  // buffer holding the playhead has not changed, so 10 is still a start we can
  // prove. Anchoring on the playhead instead would drag the start along.
  harness.currentTime = 20;
  harness.loadedFraction = 0.6;
  await vi.advanceTimersByTimeAsync(300);

  expect(bufferedIn(patches).at(-1)).toEqual([{ start: 10, end: 72 }]);
});

test('widens the range start when the playhead moves back inside the buffer', async () => {
  vi.useFakeTimers();
  const { harness, patches } = await readyAdapter();

  harness.duration = 120;
  harness.currentTime = 20;
  harness.loadedFraction = 0.5;
  harness.fireStateChange(playerStates.PLAYING);
  await vi.advanceTimersByTimeAsync(300);

  // Still the same buffer -- the edge did not move -- so the earlier playhead
  // proves more of it than the anchor did.
  harness.currentTime = 8;
  await vi.advanceTimersByTimeAsync(300);

  expect(bufferedIn(patches).at(-1)).toEqual([{ start: 8, end: 60 }]);
});

test('restarts the range when a seek lands past the known buffer edge', async () => {
  vi.useFakeTimers();
  const { harness, patches } = await readyAdapter();

  harness.duration = 1344;
  harness.currentTime = 9;
  harness.loadedFraction = 0.02436;
  harness.fireStateChange(playerStates.PLAYING);
  await vi.advanceTimersByTimeAsync(300);

  // The measured YouTube signature for a forward seek into fresh buffer: the
  // playhead lands beyond the edge we knew, and the fraction jumps with it.
  // Nothing about the old range applies, so the anchor cannot survive.
  harness.currentTime = 941;
  harness.loadedFraction = 0.7162;
  await vi.advanceTimersByTimeAsync(300);

  expect(bufferedIn(patches).at(-1)).toEqual([
    { start: 941, end: 1344 * 0.7162 }
  ]);
});

test('reports only what the playhead proves after a backward seek', async () => {
  vi.useFakeTimers();
  const { harness, patches } = await readyAdapter();

  harness.duration = 1344;
  harness.currentTime = 941;
  harness.loadedFraction = 0.7162;
  harness.fireStateChange(playerStates.PLAYING);
  await vi.advanceTimersByTimeAsync(300);

  // Seeking back into an earlier cached region: the fraction drops to that
  // region's edge, and the range shrinks to what the playhead now stands in.
  // The 941-974 buffer is still loaded, but nothing here can say so.
  harness.currentTime = 2.4;
  harness.loadedFraction = 0.02436;
  await vi.advanceTimersByTimeAsync(300);

  expect(bufferedIn(patches).at(-1)).toEqual([
    { start: 2.4, end: 1344 * 0.02436 }
  ]);
});

test('reports no buffered range when the edge sits behind the playhead', async () => {
  vi.useFakeTimers();
  const { harness, patches } = await readyAdapter();

  // Mid-seek the playhead can land outside the buffer the fraction describes.
  harness.duration = 120;
  harness.currentTime = 70;
  harness.loadedFraction = 0.25;
  harness.fireStateChange(playerStates.PLAYING);
  await vi.advanceTimersByTimeAsync(300);

  expect(bufferedIn(patches).at(-1)).toEqual([]);
});

// The edge landing exactly on the playhead is a zero-length range, which is
// not a range: a consumer drawing it gets a sliver of "buffered" covering
// nothing. `end <= currentTime`, not `<` -- and nothing asserted the
// difference until this test (#101).
test('reports no buffered range when the edge sits exactly on the playhead', async () => {
  vi.useFakeTimers();
  const { harness, patches } = await readyAdapter();

  harness.duration = 120;
  harness.currentTime = 60;
  harness.loadedFraction = 0.5;
  harness.fireStateChange(playerStates.PLAYING);
  await vi.advanceTimersByTimeAsync(300);

  expect(bufferedIn(patches).at(-1)).toEqual([]);
});

// `getVideoLoadedFraction` is documented as a fraction, but this adapter has
// no way to hold the SDK to that, and an unclamped value scales straight into
// a range end past the end of the video.
test('never reports a buffer end past the duration, whatever fraction arrives', async () => {
  vi.useFakeTimers();
  const { harness, patches } = await readyAdapter();

  harness.duration = 120;
  harness.currentTime = 10;
  harness.loadedFraction = 1.5;
  harness.fireStateChange(playerStates.PLAYING);
  await vi.advanceTimersByTimeAsync(300);

  expect(bufferedIn(patches).at(-1)).toEqual([{ start: 10, end: 120 }]);
});

test('reports no buffered range without a usable duration', async () => {
  vi.useFakeTimers();
  const { harness, patches } = await readyAdapter();

  harness.duration = 0;
  harness.currentTime = 0;
  harness.loadedFraction = 0.5;
  harness.fireStateChange(playerStates.PLAYING);
  await vi.advanceTimersByTimeAsync(300);

  expect(bufferedIn(patches).at(-1)).toEqual([]);
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

test('proactively loads the captions module once the player reports ready', async () => {
  const { harness } = await readyAdapter();

  expect(harness.player.loadModule).toHaveBeenCalledWith('captions');
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

test('names a caption track with no display name after its language', async () => {
  const { harness, patches } = await readyAdapter();
  harness.captionsTracklist = [{ languageCode: 'fr' }];

  harness.fireApiChange();

  expect(patches).toContainEqual(
    expect.objectContaining({
      textTracks: [
        {
          id: 'youtube:fr',
          label: 'français',
          language: 'fr',
          kind: 'captions',
          readiness: 'loaded'
        }
      ]
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
        selectTextTrack: { status: 'unavailable', reason: 'source' }
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

test('retry clears stale caption state before the new player reports ready', async () => {
  const { fake, harness, patches, provider } = await readyAdapter();
  harness.captionsTracklist = [{ languageCode: 'en', displayName: 'English' }];
  harness.fireApiChange();
  expect(patches).toContainEqual(
    expect.objectContaining({
      capabilities: expect.objectContaining({
        selectTextTrack: { status: 'available' }
      })
    })
  );

  await provider.retry?.();
  const retriedHarness = fake.players[1]!;
  const patchCountBeforeReady = patches.length;
  retriedHarness.fireReady();

  // The retried player has not fired its own onApiChange yet, so its
  // caption state must be empty, not the previous player's stale tracklist.
  expect(patches.slice(patchCountBeforeReady)).toContainEqual(
    expect.objectContaining({
      lifecycle: 'ready',
      capabilities: expect.objectContaining({
        selectTextTrack: { status: 'unavailable', reason: 'source' }
      })
    })
  );
  await expect(provider.selectTextTrack?.('youtube:en')).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });
});

// guardReady() refuses until the player exists, and the iframe API discards
// calls made before onReady — so attach and load are both too early.
test('youtube declares command readiness only at onReady', async () => {
  const adapter = createAdapter();

  await adapter.provider.attach();
  await adapter.provider.load();
  expect(adapter.patches).not.toContainEqual(
    expect.objectContaining({ commandsReady: true })
  );

  adapter.fake.players.at(-1)?.fireReady();

  expect(adapter.patches).toContainEqual(
    expect.objectContaining({ commandsReady: true })
  );
});

// The mount is a bare <div> and the IFrame API exposes no intrinsic media
// size, so there is nothing to measure. Absence is the contract: it is what
// leaves `--playdeck-media-aspect-ratio` unset, so the consumer's own
// `var(…, 16 / 9)` fallback is the one that applies. A member returning
// `undefined` forever would be a worse lie than not having one.
test('youtube declares no dimension channel', async () => {
  const adapter = createAdapter();

  await adapter.provider.attach();
  await adapter.provider.load();
  adapter.fake.players.at(-1)?.fireReady();

  expect(adapter.provider.subscribeDimensions).toBeUndefined();
  expect('subscribeDimensions' in adapter.provider).toBe(false);
});

// --- the [startTime, endTime] boundary (#214) ---
//
// The end boundary is adapter-enforced: YouTube's `end` player var is whole-
// second only, its interaction with the loop + single-entry-playlist trick is
// undocumented, and it is not known to publish the ENDED state change the
// adapter needs. So only the `start` var is written, purely as a load hint,
// and everything observable comes from the 250 ms poll.

// Drives the poll one tick with a position the player now reports.
const pollAt = async (harness: FakePlayerHarness, time: number) => {
  harness.currentTime = time;
  await vi.advanceTimersByTimeAsync(300);
};

const endedPatches = (patches: readonly ProviderStatePatch[]) =>
  patches.filter((patch) => patch.playback === 'ended');

test('starts playback at the start boundary rather than at zero', async () => {
  const { harness, patches } = await readyAdapter('M7lc1UVf-VE', {
    startTime: 12.5
  });

  expect(harness.player.seekTo).toHaveBeenCalledWith(12.5, true);
  expect(patches).toContainEqual(
    expect.objectContaining({ lifecycle: 'ready', currentTime: 12.5 })
  );
});

// The var is a load hint only -- whole-second, so a fractional start still
// needs the adapter seek above. The `end` var is deliberately never written.
test('writes the whole-second start player var as a load hint', async () => {
  const { fake, provider } = createAdapter('M7lc1UVf-VE', {
    startTime: 12.5,
    endTime: 20
  });

  await provider.attach();
  await provider.load();

  const vars = embedVars(fake.players[0]!);
  expect(vars).toMatchObject({ start: '12' });
  expect(vars).not.toHaveProperty('end');
});

test('publishes one ended patch at the end boundary and pauses the player', async () => {
  vi.useFakeTimers();
  const { events, harness, patches, provider } = await readyAdapter(
    'M7lc1UVf-VE',
    { endTime: 20 }
  );

  harness.fireStateChange(playerStates.PLAYING);
  await pollAt(harness, 20.2);

  expect(patches).toContainEqual({
    playback: 'ended',
    buffering: false,
    currentTime: 20
  });
  expect(events).toContainEqual(expect.objectContaining({ type: 'ended' }));
  expect(harness.player.pauseVideo).toHaveBeenCalledTimes(1);

  // The poll is stopped at the boundary, but a stray report must not publish a
  // second end either.
  await pollAt(harness, 21);
  expect(endedPatches(patches)).toHaveLength(1);
  expect(provider.provider).toBe('youtube');
});

// With `controls: true` the viewer can press YouTube's own play button, which
// reaches the adapter as a bare PLAYING state change. It has to release the
// ended latch the same way Vimeo's `play` and Wistia's `play` do, or the
// boundary never fires again and the video runs on to its natural end.
test('a resume from the provider chrome re-enforces the end boundary', async () => {
  vi.useFakeTimers();
  const { harness, patches } = await readyAdapter('M7lc1UVf-VE', {
    controls: true,
    endTime: 20
  });

  harness.fireStateChange(playerStates.PLAYING);
  await pollAt(harness, 20.2);
  harness.fireStateChange(playerStates.PAUSED);
  expect(endedPatches(patches)).toHaveLength(1);

  harness.fireStateChange(playerStates.PLAYING);
  await pollAt(harness, 21);

  expect(endedPatches(patches)).toHaveLength(2);
  expect(harness.player.pauseVideo).toHaveBeenCalledTimes(2);
});

test('the pause the end boundary causes publishes no paused patch', async () => {
  vi.useFakeTimers();
  const { harness, patches } = await readyAdapter('M7lc1UVf-VE', {
    endTime: 20
  });

  harness.fireStateChange(playerStates.PLAYING);
  await pollAt(harness, 20.2);
  harness.fireStateChange(playerStates.PAUSED);

  expect(patches).not.toContainEqual(
    expect.objectContaining({ playback: 'paused' })
  );
});

test('startTime and endTime together bound the window', async () => {
  vi.useFakeTimers();
  const { harness, patches } = await readyAdapter('M7lc1UVf-VE', {
    startTime: 5,
    endTime: 20
  });

  expect(harness.player.seekTo).toHaveBeenCalledWith(5, true);
  harness.fireStateChange(playerStates.PLAYING);
  await pollAt(harness, 12);
  expect(patches).toContainEqual(expect.objectContaining({ currentTime: 12 }));

  await pollAt(harness, 20.1);
  expect(patches).toContainEqual({
    playback: 'ended',
    buffering: false,
    currentTime: 20
  });
});

// YouTube loops a playlist from zero, and it is undocumented whether the
// `start` var applies to the second pass. The wrap guard does not depend on
// it: a report from before the start boundary is what triggers the restart.
test('loop with a start boundary wraps back to the start, not to zero', async () => {
  vi.useFakeTimers();
  const { harness, patches } = await readyAdapter('M7lc1UVf-VE', {
    loop: true,
    startTime: 5
  });

  harness.fireStateChange(playerStates.PLAYING);
  await pollAt(harness, 30);
  await pollAt(harness, 0.4);

  expect(harness.player.seekTo).toHaveBeenLastCalledWith(5, true);
  expect(patches).toContainEqual({ currentTime: 5, buffering: false });
  expect(patches).not.toContainEqual(
    expect.objectContaining({ currentTime: 0.4 })
  );
});

test('loop with an end boundary restarts instead of ending', async () => {
  vi.useFakeTimers();
  const { harness, patches } = await readyAdapter('M7lc1UVf-VE', {
    loop: true,
    endTime: 20
  });

  harness.fireStateChange(playerStates.PLAYING);
  await pollAt(harness, 20.2);

  expect(harness.player.seekTo).toHaveBeenLastCalledWith(0, true);
  expect(patches).toContainEqual({ currentTime: 0, buffering: false });
  expect(endedPatches(patches)).toHaveLength(0);
  expect(harness.player.pauseVideo).not.toHaveBeenCalled();
});

// Same table as the core helper's, asserted through what the adapter does:
// a start that sanitises away issues no seek and writes no player var.
test.each([
  ['unset', undefined],
  ['zero', 0],
  ['negative', -1],
  ['not a number', Number.NaN],
  ['infinite', Number.POSITIVE_INFINITY]
] as const)(
  'ignores a %s start boundary entirely',
  async (_label, startTime) => {
    const { harness } = await readyAdapter('M7lc1UVf-VE', { startTime });

    expect(harness.player.seekTo).not.toHaveBeenCalled();
    expect(embedVars(harness)).not.toHaveProperty('start');
  }
);

// An end that is absent, non-finite, or not above the sanitised start is no
// end: the video runs on and YouTube's own ENDED stays the only end there is.
test.each([
  ['unset', undefined],
  ['not a number', Number.NaN],
  ['infinite', Number.POSITIVE_INFINITY],
  ['equal to the start', 5],
  ['below the start', 3]
] as const)('ignores an end boundary that is %s', async (_label, endTime) => {
  vi.useFakeTimers();
  const { harness, patches } = await readyAdapter('M7lc1UVf-VE', {
    startTime: 5,
    endTime
  });

  harness.fireStateChange(playerStates.PLAYING);
  await pollAt(harness, 30);

  expect(endedPatches(patches)).toHaveLength(0);
  expect(patches).toContainEqual(expect.objectContaining({ currentTime: 30 }));
});

test('clamps an end boundary past the duration onto the duration', async () => {
  vi.useFakeTimers();
  const { harness, patches } = await readyAdapter('M7lc1UVf-VE', {
    endTime: 500
  });

  harness.duration = 120;
  harness.fireStateChange(playerStates.PLAYING);
  await pollAt(harness, 120.3);

  expect(patches).toContainEqual({
    playback: 'ended',
    buffering: false,
    currentTime: 120
  });
});

test('play after a boundary end resumes from the start boundary', async () => {
  vi.useFakeTimers();
  const { harness, patches, provider } = await readyAdapter('M7lc1UVf-VE', {
    startTime: 5,
    endTime: 20
  });

  harness.fireStateChange(playerStates.PLAYING);
  await pollAt(harness, 20.2);
  // The player reports the pause the boundary asked it for.
  harness.fireStateChange(playerStates.PAUSED);

  const resumed = provider.play?.();
  // Three times: the initial positioning at ready, the seek back onto the end
  // boundary the poll overshot (#381), and this restart.
  expect(harness.player.seekTo).toHaveBeenCalledTimes(3);
  expect(harness.player.seekTo).toHaveBeenLastCalledWith(5, true);
  expect(patches).toContainEqual({ currentTime: 5 });
  expect(harness.player.playVideo).toHaveBeenCalledTimes(1);

  harness.fireStateChange(playerStates.PLAYING);
  await expect(resumed).resolves.toEqual({ ok: true });

  // Stopping the poll at the boundary must not have stopped the world: the
  // PLAYING branch starts it again, and time flows from the restart.
  await pollAt(harness, 7);
  expect(patches).toContainEqual(expect.objectContaining({ currentTime: 7 }));
});

// The platform's own end, not the window's: with a `startTime` and no
// `endTime` the video runs to the media's end and YouTube reports ENDED. A
// `play()` after that is a replay of the window, so it goes back to the start
// boundary rather than to zero -- the native contract
// (`provider-native/src/playback.ts:229-235`), which Vimeo and Wistia keep too.
test('play after the media ends naturally resumes from the start boundary', async () => {
  vi.useFakeTimers();
  const { harness, patches, provider } = await readyAdapter('M7lc1UVf-VE', {
    startTime: 30
  });

  harness.fireStateChange(playerStates.PLAYING);
  harness.currentTime = 120;
  harness.fireStateChange(playerStates.ENDED);
  expect(endedPatches(patches)).toHaveLength(1);

  const resumed = provider.play?.();
  // Twice: the initial positioning at ready, and this replay.
  expect(harness.player.seekTo).toHaveBeenCalledTimes(2);
  expect(harness.player.seekTo).toHaveBeenLastCalledWith(30, true);
  expect(harness.player.playVideo).toHaveBeenCalledTimes(1);

  harness.fireStateChange(playerStates.PLAYING);
  await expect(resumed).resolves.toEqual({ ok: true });
});

// --- the start boundary is a floor, not a load position (#381) ---
// It used to be applied once, at ready, and nothing re-applied it. Both ends of
// the window are corrected through one predicate now, `@playdeck/core`'s
// `correction`, which the Vimeo and Wistia ports consult identically. The poll
// is the only report YouTube gives, so it is the only place a position that
// arrived without a Playdeck command can be seen — including the viewer's own
// drag of YouTube's scrub bar under `controls: true`.

test('pulls a polled position below the start boundary back into the window', async () => {
  vi.useFakeTimers();
  const { harness, patches } = await readyAdapter('M7lc1UVf-VE', {
    startTime: 20
  });
  harness.fireStateChange(playerStates.PLAYING);

  await pollAt(harness, 5);

  expect(harness.player.seekTo).toHaveBeenLastCalledWith(20, true);
  expect(patches).toContainEqual({ currentTime: 20 });
  expect(patches).not.toContainEqual(
    expect.objectContaining({ currentTime: 5 })
  );
});

// A correction issues a seek, the seek is reported by the next poll, and that
// report must not correct again: `correction` answers undefined for its own
// target.
test('does not correct the position its own correction produced', async () => {
  vi.useFakeTimers();
  const { harness, patches } = await readyAdapter('M7lc1UVf-VE', {
    startTime: 20
  });
  harness.fireStateChange(playerStates.PLAYING);
  await pollAt(harness, 5);

  await pollAt(harness, 20);

  // The positioning seek at ready, then the one correction.
  expect(harness.player.seekTo).toHaveBeenCalledTimes(2);
  expect(patches).toContainEqual(expect.objectContaining({ currentTime: 20 }));
});

// The seek clamp already pulls a *commanded* position into the window, so the
// report it lands on must not be corrected on top of it. The two agree by
// construction — every `correction` answer is the `clamp` of the same time —
// and this is the assertion that keeps them agreeing, matching the Vimeo and
// Wistia ports test for test.
test('does not correct a seek command the clamp already pulled in', async () => {
  vi.useFakeTimers();
  const { harness, patches, provider } = await readyAdapter('M7lc1UVf-VE', {
    startTime: 20,
    endTime: 40
  });
  harness.fireStateChange(playerStates.PLAYING);

  await expect(provider.seekTo?.(0)).resolves.toEqual({ ok: true });
  expect(harness.player.seekTo).toHaveBeenLastCalledWith(20, true);

  await pollAt(harness, 20);

  // The positioning seek at ready and the clamped command, and nothing behind
  // them: the poll that reports where the clamp landed answers no correction.
  expect(harness.player.seekTo).toHaveBeenCalledTimes(2);
  expect(patches).toContainEqual(expect.objectContaining({ currentTime: 20 }));
});

// The end of the window, through the same predicate. The poll notices the
// boundary only after it has passed, so the pause lands with the playhead
// already outside the window; pinning the report alone left a frame outside it
// on screen while `currentTime` said the boundary.
test('seeks the playhead back onto the end boundary it overshot', async () => {
  vi.useFakeTimers();
  const { harness, patches } = await readyAdapter('M7lc1UVf-VE', {
    endTime: 20
  });
  harness.fireStateChange(playerStates.PLAYING);

  await pollAt(harness, 20.2);

  expect(harness.player.pauseVideo).toHaveBeenCalledTimes(1);
  expect(harness.player.seekTo).toHaveBeenLastCalledWith(20, true);
  expect(patches).toContainEqual({
    playback: 'ended',
    buffering: false,
    currentTime: 20
  });
});

test('issues no corrective seek for a report that lands on the end boundary', async () => {
  vi.useFakeTimers();
  const { harness } = await readyAdapter('M7lc1UVf-VE', { endTime: 20 });
  harness.fireStateChange(playerStates.PLAYING);

  await pollAt(harness, 20);

  expect(harness.player.pauseVideo).toHaveBeenCalledTimes(1);
  expect(harness.player.seekTo).not.toHaveBeenCalled();
});

test('a seek past the end boundary clamps rather than ending playback', async () => {
  const { harness, patches, provider } = await readyAdapter('M7lc1UVf-VE', {
    startTime: 5,
    endTime: 20
  });

  await expect(provider.seekTo?.(50)).resolves.toEqual({ ok: true });
  expect(harness.player.seekTo).toHaveBeenLastCalledWith(20, true);
  expect(endedPatches(patches)).toHaveLength(0);

  await expect(provider.seekTo?.(1)).resolves.toEqual({ ok: true });
  expect(harness.player.seekTo).toHaveBeenLastCalledWith(5, true);
});

// The window's ceiling is the effective end -- the end boundary capped by the
// duration -- so an `endTime` past the media clamps onto the media, exactly as
// it does on Vimeo and Wistia. One prop, one meaning (#214).
test('clamps a seek to the duration when the end boundary is past it', async () => {
  const { harness, provider } = await readyAdapter('M7lc1UVf-VE', {
    endTime: 1_000
  });
  harness.duration = 60;

  await expect(provider.seekTo?.(900)).resolves.toEqual({ ok: true });
  expect(harness.player.seekTo).toHaveBeenLastCalledWith(60, true);
});

test('clamps a seek to the duration with no window configured', async () => {
  const { harness, provider } = await readyAdapter();

  await expect(provider.seekTo?.(5_000)).resolves.toEqual({ ok: true });
  expect(harness.player.seekTo).toHaveBeenLastCalledWith(120, true);
});

// Before metadata lands `getDuration()` answers 0, which is no ceiling to
// clamp against; the seek keeps the unbounded-above behaviour it has always
// had until the player knows a duration.
test('leaves a seek unbounded above while the duration is unknown', async () => {
  const { harness, provider } = await readyAdapter();
  harness.duration = 0;

  await expect(provider.seekTo?.(5_000)).resolves.toEqual({ ok: true });
  expect(harness.player.seekTo).toHaveBeenLastCalledWith(5_000, true);
});

// --- liveness is a documented gap (#187) ---
//
// This adapter cannot tell a live broadcast from a VOD, so it publishes no
// `live` at all rather than guessing one. The test pins that: the key is
// absent from every patch, not present holding `null`. See the README's
// "What it reports honestly" for the surface that was checked and why the
// undocumented `getVideoData().isLive` was left alone.
//
// DELETE THIS TEST, and the README section it pins, if this adapter is ever
// made live-capable.
test('pins the liveness gap: no patch ever carries a live key (#187)', async () => {
  vi.useFakeTimers();
  const { harness, patches, provider } = await readyAdapter();

  const playing = provider.play();
  harness.fireStateChange(playerStates.PLAYING);
  await expect(playing).resolves.toEqual({ ok: true });

  // A duration that arrives late, then grows -- the shape a broadcast's
  // elapsed time has, and the one a VOD has while metadata settles.
  harness.duration = 300;
  harness.currentTime = 12;
  harness.loadedFraction = 0.4;
  await vi.advanceTimersByTimeAsync(300);
  harness.duration = 600;
  harness.currentTime = 24;
  await vi.advanceTimersByTimeAsync(300);

  await expect(provider.seekTo?.(30)).resolves.toEqual({ ok: true });
  harness.fireStateChange(playerStates.BUFFERING);
  harness.fireStateChange(playerStates.PLAYING);
  await vi.advanceTimersByTimeAsync(300);
  harness.fireStateChange(playerStates.PAUSED);
  harness.fireStateChange(playerStates.ENDED);

  // The lifecycle really ran, so the absence below is not a vacuous pass.
  expect(patches).toContainEqual(
    expect.objectContaining({ lifecycle: 'ready' })
  );
  expect(patches).toContainEqual(
    expect.objectContaining({ playback: 'playing' })
  );
  expect(patches.filter((patch) => 'live' in patch)).toEqual([]);
});

// The IFrame Player API documents no chapter method and no chapter event, and
// the Data API's video resource carries no chapter property either. That is a
// published fact rather than an omission: the collection stays empty, the
// capability says why, and no command rejects over it (#182).
test('reports chapters as unavailable for the provider without failing a command', async () => {
  const controller = new PlayerController();
  const { fake, provider } = createAdapter();
  controller.setProvider(provider);
  await provider.attach();
  await provider.load();
  fake.players[0]!.fireReady();

  expect(controller.getState().chapters).toEqual([]);
  expect(controller.getState().capabilities.chapters).toEqual({
    status: 'unavailable',
    reason: 'provider'
  });
  expect(controller.getState().error).toBeNull();
  expect(await controller.seekTo(10)).toEqual({ ok: true });
});

// --- subscriber isolation (#233) ---

// The deliberate throw below is rethrown on a fresh task so it still reaches
// uncaught-error handling; captured rather than run, which is what keeps it
// from landing in the runner as an unhandled error.
const captureRethrows = (): unknown[] => {
  const errors: unknown[] = [];
  const real = globalThis.queueMicrotask;
  // Wrapped rather than replaced: the fake player applies its command effects
  // on a later microtask, and swallowing those would stall this suite.
  globalThis.queueMicrotask = (task: () => void) =>
    real(() => {
      try {
        task();
      } catch (error) {
        errors.push(error);
      }
    });
  onTestFinished(() => {
    globalThis.queueMicrotask = real;
  });
  return errors;
};

// #95, reached through the adapter's own fan-out rather than the controller's
// (#233): a bare `Set.forEach` stops at the first throw, so every subscriber
// behind the thrower missed that notification — and the throw escaped back
// into the caller of `emit`, which on this path is the iframe API's own event
// dispatch.
test('a throwing subscriber does not starve the subscribers behind it', async () => {
  const { harness, provider } = await readyAdapter();
  captureRethrows();
  provider.subscribe(() => {
    throw new Error('subscriber blew up');
  });
  const after = vi.fn();
  provider.subscribe(after);

  harness.currentTime = 12;
  expect(() => harness.fireStateChange(playerStates.PLAYING)).not.toThrow();

  expect(after.mock.calls.at(-1)?.[0]).toMatchObject({
    playback: 'playing',
    currentTime: 12
  });
});

// --- attach deadline (#327) ---

// Distinct from the loader's `API_READY_TIMEOUT_MS`, which bounds the iframe
// API *script* initialising, and from `PLAYBACK_CONFIRMATION_TIMEOUT_MS`, which
// bounds a play command. Neither covers the player never becoming ready, which
// is the ordinary shape of a blocked embed: a page CSP without
// `frame-src www.youtube-nocookie.com`, an extension or DNS blocking the frame,
// a captive portal, or a vendor frame that loads but never posts back.
//
// Wistia already ships exactly this backstop and says why at
// `provider-wistia/src/attachment.ts:45-58`. Before this, YouTube and Vimeo
// silently inherited an unbounded wait.
test('reports an error when the player never becomes ready', async () => {
  vi.useFakeTimers();
  const { patches, provider } = createAdapter();
  await provider.attach();
  await provider.load();

  // The frame exists and the constructor ran; `onReady` simply never arrives.
  expect(patches.at(-1)).toMatchObject({ lifecycle: 'loading' });

  await vi.advanceTimersByTimeAsync(PLAYER_READY_TIMEOUT_MS);

  expect(patches.at(-1)).toMatchObject({
    lifecycle: 'error',
    activation: 'error',
    error: {
      category: 'provider',
      recoverable: true
    }
  });
  // The message has to name the embed rather than the API, because the
  // actionable cause is nearly always the consumer's own CSP.
  expect(String(patches.at(-1)?.error?.message)).toMatch(/embed|frame|ready/i);
});

// Asserted on the timer count rather than on the absence of an error patch.
// The callback also guards on `ready`, so an outcome assertion passes whether
// or not the timer was cleared and proves nothing about the clearing -- checked
// by removing each protection in turn, and the outcome test survived both. This
// one fails the moment `clearReadyDeadline()` leaves `onReady`.
test('clears the deadline when the player becomes ready', async () => {
  vi.useFakeTimers();
  const { fake, patches, provider } = createAdapter();
  await provider.attach();
  await provider.load();
  const armed = vi.getTimerCount();
  fake.players[0]!.fireReady();

  expect(vi.getTimerCount()).toBeLessThan(armed);

  const afterReady = patches.length;
  await vi.advanceTimersByTimeAsync(PLAYER_READY_TIMEOUT_MS * 2);
  // And the outcome the clearing exists to protect: a ready player is never
  // knocked into an error state by its own backstop firing late.
  expect(patches.slice(afterReady)).not.toContainEqual(
    expect.objectContaining({ lifecycle: 'error' })
  );
});

test('leaves nothing pending after destroy', async () => {
  vi.useFakeTimers();
  const { patches, provider } = createAdapter();
  await provider.attach();
  await provider.load();
  expect(vi.getTimerCount()).toBeGreaterThan(0);

  await provider.destroy();

  // A destroyed adapter holds no timer at all, so the deadline cannot outlive
  // the player it was armed for.
  expect(vi.getTimerCount()).toBe(0);

  const afterDestroy = patches.length;
  await vi.advanceTimersByTimeAsync(PLAYER_READY_TIMEOUT_MS * 2);
  expect(patches.slice(afterDestroy)).toHaveLength(0);
});
