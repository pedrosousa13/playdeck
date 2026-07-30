import type {
  Availability,
  CommandResult,
  MediaDimensions,
  PlayerCapabilities,
  PlayerError,
  ProviderAdapter,
  ProviderEvent,
  ProviderStateListener,
  VimeoSource
} from '@reely/core';
import {
  asRecord,
  available,
  errorString,
  numberField,
  providerCheck,
  providerEvent,
  runVimeoCommand,
  type VimeoMountElement
} from './adapter-values.js';
import {
  loadVimeoSdk,
  type VimeoSdkPlayer,
  type VimeoSdkQuality,
  type VimeoSdkTextTrack
} from './loader.js';
import { createVimeoPlayback } from './playback.js';
import { createVimeoQualityLevels } from './quality-levels.js';
import { createVimeoTextTracks } from './text-tracks.js';

export type { VimeoMountElement } from './adapter-values.js';
export { loadVimeoSdk, resetVimeoSdkLoader } from './loader.js';
export type {
  VimeoSdkConstructor,
  VimeoSdkEventListener,
  VimeoSdkModule,
  VimeoSdkPlayer,
  VimeoSdkQuality,
  VimeoSdkTextTrack
} from './loader.js';

export type VimeoProviderOptions = {
  readonly controls?: boolean;
  readonly dnt?: boolean;
};

type VimeoCommand =
  | 'play'
  | 'pause'
  | 'seekTo'
  | 'seekBy'
  | 'mute'
  | 'unmute'
  | 'setVolume'
  | 'setPlaybackRate'
  | 'selectQuality'
  | 'selectTextTrack'
  | 'requestFullscreen'
  | 'exitFullscreen'
  | 'requestPictureInPicture'
  | 'exitPictureInPicture'
  | 'retry';

export type VimeoProviderAdapter = ProviderAdapter &
  Required<Pick<ProviderAdapter, VimeoCommand>> & {
    readonly provider: 'vimeo';
  };

const loadFailure = (cause: unknown): PlayerError => {
  const name = errorString(cause, 'name');
  const category =
    name === 'PrivacyError' || name === 'PasswordError'
      ? 'policy'
      : name === 'NotFoundError'
        ? 'source'
        : 'provider';
  return {
    category,
    fatal: true,
    recoverable: category === 'provider',
    message:
      errorString(cause, 'message') || 'The Vimeo player could not load.',
    cause
  };
};

const vimeoWatchUrl = (source: VimeoSource): string =>
  `https://vimeo.com/${source.videoId}${source.hash ? `/${source.hash}` : ''}`;

const vimeoEmbedUrl = (
  source: VimeoSource,
  options: VimeoProviderOptions,
  muted: boolean | undefined
): string => {
  const url = new URL(`https://player.vimeo.com/video/${source.videoId}`);
  if (source.hash) url.searchParams.set('h', source.hash);
  url.searchParams.set('controls', options.controls === true ? '1' : '0');
  url.searchParams.set('dnt', options.dnt === false ? '0' : '1');
  url.searchParams.set('playsinline', '1');
  if (muted) url.searchParams.set('muted', '1');
  return url.href;
};

const planLimitedAccountTypes = new Set(['free', 'basic']);

// Tiers verified against the live oEmbed API plus Vimeo's documented paid
// lineups (legacy and 2023 rename). Unknown future tiers stay unresolved so a
// gated tier is never misreported as chromeless-capable.
const chromelessAccountTypes = new Set([
  'plus',
  'pro',
  'business',
  'premium',
  'enterprise',
  'custom',
  'starter',
  'standard',
  'advanced'
]);

const chromelessAvailability = async (
  source: VimeoSource
): Promise<Availability> => {
  try {
    const response = await fetch(
      `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(
        vimeoWatchUrl(source)
      )}`
    );
    if (!response.ok) return providerCheck;
    const data: unknown = await response.json();
    const accountType =
      typeof data === 'object' &&
      data !== null &&
      'account_type' in data &&
      typeof data.account_type === 'string'
        ? data.account_type
        : undefined;
    if (!accountType) return providerCheck;
    if (planLimitedAccountTypes.has(accountType)) {
      return { status: 'unavailable', reason: 'provider-plan' };
    }
    return chromelessAccountTypes.has(accountType) ? available : providerCheck;
  } catch {
    return providerCheck;
  }
};

const settleWithFallback = <Value>(
  promise: Promise<Value>,
  fallback: Value,
  milliseconds: number
): Promise<Value> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });

export const createVimeoProvider = (
  mount: VimeoMountElement,
  source: VimeoSource,
  options: VimeoProviderOptions = {}
): VimeoProviderAdapter => {
  const listeners = new Set<ProviderStateListener>();
  const dimensionListeners = new Set<
    (dimensions: MediaDimensions | undefined) => void
  >();
  let attached = false;
  let destroyed = false;
  let started = false;
  let generation = 0;
  let activePlayer: VimeoSdkPlayer | undefined;
  let activeIframe: HTMLIFrameElement | undefined;
  let pictureInPictureAvailability: Availability = available;
  let customControlsAvailability: Availability = providerCheck;
  let activeDimensions: MediaDimensions | undefined;

  // Anything that is not two finite positive numbers publishes as "not known".
  // A missing figure defaults to 0 so it fails the same `> 0` test the SDK's
  // own zeroes do, rather than needing a separate undefined check.
  const emitDimensions = (width = 0, height = 0): void => {
    const dimensions =
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
        ? { width, height }
        : undefined;
    activeDimensions = dimensions;
    dimensionListeners.forEach((listener) => listener(dimensions));
  };

  const clearDimensions = (): void => {
    if (activeDimensions === undefined) return;
    emitDimensions();
  };

  const emit = (
    patch: Parameters<ProviderStateListener>[0],
    event?: ProviderEvent
  ): void => listeners.forEach((listener) => listener(patch, event));

  const playback = createVimeoPlayback(mount, {
    emit,
    isStale: (player) => destroyed || player !== activePlayer,
    getPlayer: () => (destroyed ? undefined : activePlayer),
    getCapabilities: () => capabilities()
  });

  const qualityLevels = createVimeoQualityLevels({
    emit,
    getPlayer: () => (destroyed ? undefined : activePlayer)
  });

  const textTracks = createVimeoTextTracks({
    emit,
    isStale: (player) => destroyed || player !== activePlayer,
    getPlayer: () => (destroyed ? undefined : activePlayer),
    getCurrentTime: playback.getCurrentTime,
    getCapabilities: () => capabilities()
  });

  const capabilities = (): PlayerCapabilities => ({
    seek: available,
    setVolume: playback.setVolumeAvailability(),
    setPlaybackRate: playback.setPlaybackRateAvailability(),
    selectQuality: qualityLevels.selectQualityAvailability(),
    selectTextTrack: textTracks.selectTextTrackAvailability(),
    fullscreen: available,
    pictureInPicture: pictureInPictureAvailability,
    // The SDK exposes remote-playback methods, but this adapter wires no
    // command surface for them yet, so they are unavailable through Reely
    // rather than forever "unknown".
    airPlay: { status: 'unavailable', reason: 'provider' },
    customControls: customControlsAvailability
  });

  const isStale = (thisGeneration: number, player?: VimeoSdkPlayer): boolean =>
    destroyed ||
    thisGeneration !== generation ||
    (player !== undefined && player !== activePlayer);

  const teardown = (): void => {
    const player = activePlayer;
    const iframe = activeIframe;
    activePlayer = undefined;
    activeIframe = undefined;
    // Cues belong to the player being discarded; a retry must not inherit them.
    // Neither must its measured shape: the replacement may take a while to
    // answer, or never answer, and until it does a leftover ratio describes a
    // video that is no longer there.
    textTracks.reset();
    clearDimensions();
    if (player) {
      try {
        void Promise.resolve(player.destroy()).catch(() => undefined);
      } catch {
        // Teardown must not escape the provider boundary.
      }
    }
    iframe?.remove();
  };

  const wireEvents = (player: VimeoSdkPlayer, thisGeneration: number): void => {
    const on = (name: string, listener: (data?: unknown) => void): void =>
      player.on(name, (data?: unknown) => {
        if (isStale(thisGeneration, player)) return;
        listener(data);
      });

    const { handlers: playbackHandlers } = playback;
    on('play', playbackHandlers.onPlay);
    on('playing', playbackHandlers.onPlaying);
    on('pause', playbackHandlers.onPause);
    on('ended', playbackHandlers.onEnded);
    on('timeupdate', playbackHandlers.onTimeUpdate);
    on('progress', () => playbackHandlers.onProgress(player));
    // Unlike `progress`, `resize` carries the new intrinsic size in its own
    // payload, so it needs no getter round trip — and therefore no second,
    // post-await `isStale` guard the way `progress` does above. The one `on`
    // already applies to every listener is the only one this needs.
    on('resize', (data) => {
      emitDimensions(
        numberField(data, 'videoWidth'),
        numberField(data, 'videoHeight')
      );
    });
    on('bufferstart', playbackHandlers.onBufferStart);
    on('bufferend', playbackHandlers.onBufferEnd);
    on('seeking', playbackHandlers.onSeeking);
    on('seeked', playbackHandlers.onSeeked);
    on('volumechange', (data) => playbackHandlers.onVolumeChange(player, data));
    on('playbackratechange', playbackHandlers.onPlaybackRateChange);
    on('qualitychange', qualityLevels.handlers.onQualityChange);
    on('durationchange', playbackHandlers.onDurationChange);
    on('fullscreenchange', (data) => {
      const fullscreen = asRecord(data).fullscreen === true;
      emit(
        { fullscreen },
        providerEvent('fullscreenchange', { fullscreen }, data)
      );
    });
    on('enterpictureinpicture', (data) =>
      emit(
        { pictureInPicture: true },
        providerEvent(
          'pictureinpicturechange',
          { pictureInPicture: true },
          data
        )
      )
    );
    on('leavepictureinpicture', (data) =>
      emit(
        { pictureInPicture: false },
        providerEvent(
          'pictureinpicturechange',
          { pictureInPicture: false },
          data
        )
      )
    );
    on('cuechange', textTracks.handlers.onCueChange);
    on('texttrackchange', (data) =>
      textTracks.handlers.onTextTrackChange(player, data)
    );
    on('error', (data) => {
      const record = asRecord(data);
      if (typeof record.method === 'string') return;
      const error = loadFailure(
        Object.assign(new Error(), {
          name: typeof record.name === 'string' ? record.name : 'Error',
          message:
            typeof record.message === 'string'
              ? record.message
              : 'The Vimeo player reported an error.'
        })
      );
      emit(
        {
          lifecycle: 'error',
          activation: 'error',
          playback: 'paused',
          buffering: false,
          seeking: false,
          error
        },
        providerEvent('error', error, data)
      );
    });
  };

  const start = async (thisGeneration: number): Promise<CommandResult> => {
    try {
      const Sdk = await loadVimeoSdk();
      if (isStale(thisGeneration)) return { ok: true };
      const iframe = mount.ownerDocument.createElement('iframe');
      iframe.src = vimeoEmbedUrl(source, options, mount.muted);
      iframe.setAttribute(
        'allow',
        'autoplay; fullscreen; picture-in-picture; encrypted-media'
      );
      iframe.setAttribute('allowfullscreen', '');
      iframe.setAttribute('title', 'Vimeo video player');
      iframe.style.position = 'absolute';
      iframe.style.inset = '0';
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = '0';
      mount.appendChild(iframe);
      const player = new Sdk(iframe);
      activePlayer = player;
      activeIframe = iframe;
      wireEvents(player, thisGeneration);
      // `runCommand` accepts from here, and the SDK queues calls it receives
      // before its own ready resolves. Declaring at `player.ready()` instead
      // would never fire behind a blocked iframe (#69).
      emit({ commandsReady: true });
      const availabilityPromise =
        options.controls === true
          ? Promise.resolve<Availability>({
              status: 'unavailable',
              reason: 'provider'
            })
          : settleWithFallback(
              chromelessAvailability(source),
              providerCheck,
              4000
            );
      await player.ready();
      if (isStale(thisGeneration, player)) return { ok: true };
      const [
        initialDuration,
        initialMuted,
        initialVolume,
        initialPlaybackRate,
        initialTracks,
        initialQualities,
        chromeless,
        initialWidth,
        initialHeight
      ] = await Promise.all([
        player.getDuration().catch(() => null),
        player.getMuted().catch(() => mount.muted ?? false),
        player.getVolume().catch(() => mount.volume ?? 1),
        player.getPlaybackRate().catch(() => mount.playbackRate ?? 1),
        player
          .getTextTracks()
          .catch((): ReadonlyArray<VimeoSdkTextTrack> => []),
        player.getQualities().catch((): ReadonlyArray<VimeoSdkQuality> => []),
        availabilityPromise,
        // An embed that does not answer these leaves the size unknown, which
        // is a fallback the consumer already handles — never a reason to fail
        // the attach.
        player.getVideoWidth().catch((): undefined => undefined),
        player.getVideoHeight().catch((): undefined => undefined)
      ]);
      if (isStale(thisGeneration, player)) return { ok: true };
      emitDimensions(initialWidth, initialHeight);
      const textTrackPatch = textTracks.adopt(player, initialTracks);
      const qualityPatch = qualityLevels.adopt(initialQualities);
      customControlsAvailability = chromeless;
      const playbackPatch = playback.adopt(player, {
        duration: initialDuration,
        muted: initialMuted,
        volume: initialVolume,
        playbackRate: initialPlaybackRate
      });
      emit(
        {
          lifecycle: 'ready',
          activation: 'ready',
          playback: 'paused',
          buffering: false,
          seeking: false,
          ...playbackPatch,
          ...textTrackPatch,
          ...qualityPatch,
          capabilities: capabilities()
        },
        providerEvent('ready', undefined)
      );
      return { ok: true };
    } catch (cause) {
      if (isStale(thisGeneration)) return { ok: true };
      teardown();
      const error = loadFailure(cause);
      emit(
        { lifecycle: 'error', activation: 'error', error },
        providerEvent('error', error)
      );
      return { ok: false, reason: 'provider-error', error };
    }
  };

  const runCommand = (
    command: (player: VimeoSdkPlayer) => Promise<unknown>
  ): Promise<CommandResult> =>
    runVimeoCommand(destroyed ? undefined : activePlayer, command);

  return {
    provider: 'vimeo',
    attach: () => {
      if (attached || destroyed) return;
      attached = true;
    },
    load: async () => {
      if (destroyed || started) return;
      started = true;
      await start(++generation);
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      ++generation;
      teardown();
      listeners.clear();
      textTracks.clearCueListeners();
      dimensionListeners.clear();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeDimensions: (listener) => {
      dimensionListeners.add(listener);
      return () => dimensionListeners.delete(listener);
    },
    play: playback.play,
    pause: playback.pause,
    seekTo: playback.seekTo,
    seekBy: playback.seekBy,
    mute: playback.mute,
    unmute: playback.unmute,
    setVolume: playback.setVolume,
    setPlaybackRate: playback.setPlaybackRate,
    selectQuality: qualityLevels.selectQuality,
    selectTextTrack: textTracks.selectTextTrack,
    subscribeCues: textTracks.subscribeCues,
    setCaptionRenderer: textTracks.setCaptionRenderer,
    requestFullscreen: () => runCommand((player) => player.requestFullscreen()),
    exitFullscreen: () => runCommand((player) => player.exitFullscreen()),
    requestPictureInPicture: async () => {
      const result = await runCommand((player) =>
        player.requestPictureInPicture()
      );
      if (!result.ok && result.reason === 'unsupported') {
        pictureInPictureAvailability = {
          status: 'unavailable',
          reason: 'provider'
        };
        emit({ capabilities: capabilities() });
      }
      return result;
    },
    exitPictureInPicture: () =>
      runCommand((player) => player.exitPictureInPicture()),
    retry: async () => {
      if (destroyed) return { ok: false, reason: 'not-ready' };
      const thisGeneration = ++generation;
      teardown();
      started = true;
      return start(thisGeneration);
    }
  };
};
