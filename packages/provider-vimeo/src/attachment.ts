import type {
  CommandResult,
  MediaDimensions,
  PlayerCapabilities,
  PlayerError,
  VimeoSource
} from '@reely/core';
import {
  asRecord,
  errorString,
  numberField,
  providerEvent,
  type EmitProviderState,
  type IsStalePlayer,
  type VimeoMountElement
} from './adapter-values.js';
import type { VimeoChromelessAvailability } from './chromeless-availability.js';
import {
  loadVimeoSdk,
  type VimeoSdkPlayer,
  type VimeoSdkQuality,
  type VimeoSdkTextTrack
} from './loader.js';
import type { VimeoPlayback } from './playback.js';
import type { VimeoPresentation } from './presentation.js';
import type { VimeoQualityLevels } from './quality-levels.js';
import type { VimeoTextTracks } from './text-tracks.js';

export type VimeoProviderOptions = {
  readonly controls?: boolean;
  readonly dnt?: boolean;
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

// The fields of the host's options the embed url carries, read when the embed
// is built rather than snapshotted at construction.
type VimeoEmbedOptions = {
  readonly controls?: boolean;
  readonly dnt?: boolean;
};

const vimeoEmbedUrl = (
  source: VimeoSource,
  options: VimeoEmbedOptions,
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

export type VimeoAttachmentDeps = {
  readonly emit: EmitProviderState;
  readonly options: VimeoEmbedOptions;
  // The host's capabilities snapshot, for the state published on ready.
  readonly getCapabilities: () => PlayerCapabilities;
  readonly chromeless: Pick<VimeoChromelessAvailability, 'probe' | 'adopt'>;
  readonly playback: Pick<VimeoPlayback, 'adopt' | 'handlers'>;
  readonly presentation: Pick<VimeoPresentation, 'handlers'>;
  readonly qualityLevels: Pick<VimeoQualityLevels, 'adopt' | 'handlers'>;
  readonly textTracks: Pick<
    VimeoTextTracks,
    'adopt' | 'handlers' | 'reset' | 'clearCueListeners'
  >;
  // Drops the host's provider-state subscribers on destroy.
  readonly clearStateListeners: () => void;
};

// The attachment seam: the adapter's binding to its embed — attach, the SDK
// load, the iframe and player construction with every seam's event wiring,
// teardown, and the retry that replaces one player with the next. Owns the
// attached/destroyed/started flags, the player and its iframe, the measured
// media shape, and the start generation that makes a superseded player's
// events inert. Exposes the player guards every other seam depends on.
export type VimeoAttachment = {
  readonly attach: () => void;
  readonly load: () => Promise<void>;
  readonly destroy: () => void;
  readonly retry: () => Promise<CommandResult>;
  readonly subscribeDimensions: (
    listener: (dimensions: MediaDimensions | undefined) => void
  ) => () => void;
  // The player while it will accept a command: undefined before one is
  // constructed, and again after teardown or destroy.
  readonly getPlayer: () => VimeoSdkPlayer | undefined;
  readonly isStale: IsStalePlayer;
};

export const createVimeoAttachment = (
  mount: VimeoMountElement,
  source: VimeoSource,
  {
    emit,
    options,
    getCapabilities,
    chromeless,
    playback,
    presentation,
    qualityLevels,
    textTracks,
    clearStateListeners
  }: VimeoAttachmentDeps
): VimeoAttachment => {
  const dimensionListeners = new Set<
    (dimensions: MediaDimensions | undefined) => void
  >();
  let attached = false;
  let destroyed = false;
  let started = false;
  let generation = 0;
  let activePlayer: VimeoSdkPlayer | undefined;
  let activeIframe: HTMLIFrameElement | undefined;
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
    on('fullscreenchange', presentation.handlers.onFullscreenChange);
    on('enterpictureinpicture', presentation.handlers.onEnterPictureInPicture);
    on('leavepictureinpicture', presentation.handlers.onLeavePictureInPicture);
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
      // A command is accepted from here, and the SDK queues calls it receives
      // before its own ready resolves. Declaring at `player.ready()` instead
      // would never fire behind a blocked iframe (#69).
      emit({ commandsReady: true });
      const chromelessProbe = chromeless.probe();
      await player.ready();
      if (isStale(thisGeneration, player)) return { ok: true };
      const [
        initialDuration,
        initialMuted,
        initialVolume,
        initialPlaybackRate,
        initialTracks,
        initialQualities,
        chromelessVerdict,
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
        chromelessProbe,
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
      chromeless.adopt(chromelessVerdict);
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
          capabilities: getCapabilities()
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

  return {
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
      clearStateListeners();
      textTracks.clearCueListeners();
      dimensionListeners.clear();
    },
    retry: async () => {
      if (destroyed) return { ok: false, reason: 'not-ready' };
      const thisGeneration = ++generation;
      teardown();
      started = true;
      return start(thisGeneration);
    },
    subscribeDimensions: (listener) => {
      dimensionListeners.add(listener);
      return () => dimensionListeners.delete(listener);
    },
    getPlayer: () => (destroyed ? undefined : activePlayer),
    isStale: (player) => destroyed || player !== activePlayer
  };
};
