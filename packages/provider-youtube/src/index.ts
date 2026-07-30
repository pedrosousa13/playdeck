import type {
  Availability,
  PlayerCapabilities,
  ProviderAdapter,
  ProviderEvent,
  ProviderStateListener,
  TimeRange
} from '@reely/core';
import {
  available,
  browserUnavailable,
  clamp01,
  commandFailure,
  loadFailure,
  nextBufferView,
  preReadyCapabilities,
  providerEvent,
  readyCapabilities,
  type BufferView
} from './adapter-values.js';
import {
  loadYouTubeIframeApi,
  type YouTubeIframeApi,
  type YouTubePlayer
} from './loader.js';
import { createYouTubePlayback } from './playback.js';
import { createYouTubeTextTracks } from './text-tracks.js';

export {
  loadYouTubeIframeApi,
  type YouTubeIframeApi,
  type YouTubePlayer,
  type YouTubePlayerConstructor,
  type YouTubePlayerEventHandlers,
  type YouTubePlayerOptions
} from './loader.js';

export { PLAYBACK_CONFIRMATION_TIMEOUT_MS } from './playback.js';

const TIME_UPDATE_INTERVAL_MS = 250;

export type YouTubeProviderOptions = {
  /** Embed host; defaults to the privacy-enhanced youtube-nocookie.com. */
  readonly host?: string;
  /** Overridable iframe API loader so tests can inject a fake API object. */
  readonly loadIframeApi?: () => Promise<YouTubeIframeApi>;
};

type YouTubeCommand =
  | 'play'
  | 'pause'
  | 'seekTo'
  | 'seekBy'
  | 'mute'
  | 'unmute'
  | 'setVolume'
  | 'setPlaybackRate'
  | 'requestFullscreen'
  | 'exitFullscreen'
  | 'retry'
  | 'selectTextTrack';

export type YouTubeProviderAdapter = ProviderAdapter &
  Required<Pick<ProviderAdapter, YouTubeCommand>> & {
    readonly provider: 'youtube';
  };

export const createYouTubeProvider = (
  mount: HTMLElement,
  videoId: string,
  options: YouTubeProviderOptions = {}
): YouTubeProviderAdapter => {
  const listeners = new Set<ProviderStateListener>();
  const ownerDocument = mount.ownerDocument;
  const host = options.host ?? 'https://www.youtube-nocookie.com';
  const loadIframeApi = options.loadIframeApi ?? loadYouTubeIframeApi;
  let attached = false;
  let destroyed = false;
  let loadRequested = false;
  let ready = false;
  let generation = 0;
  let player: YouTubePlayer | undefined;
  let playerTarget: HTMLElement | undefined;
  let timeInterval: ReturnType<typeof setInterval> | undefined;
  // The iframe API proxies commands over postMessage, so getters read stale
  // values right after a command. This mirror tracks the last confirmed or
  // intended position instead; commands emit intent, polling confirms.
  let knownCurrentTime = 0;
  let bufferView: BufferView | undefined;

  const emit = (
    patch: Parameters<ProviderStateListener>[0],
    event?: ProviderEvent
  ): void => listeners.forEach((listener) => listener(patch, event));

  const safeIframe = (): HTMLIFrameElement | undefined => {
    try {
      return player?.getIframe() ?? undefined;
    } catch {
      return undefined;
    }
  };

  const bufferedRanges = (
    current: YouTubePlayer,
    currentTime: number
  ): readonly TimeRange[] => {
    const duration = current.getDuration();
    const fraction = current.getVideoLoadedFraction();
    bufferView =
      Number.isFinite(duration) && duration > 0 && Number.isFinite(fraction)
        ? nextBufferView(bufferView, currentTime, clamp01(fraction) * duration)
        : undefined;
    return bufferView
      ? [{ start: bufferView.anchor, end: bufferView.end }]
      : [];
  };

  const stopTimePolling = (): void => {
    if (timeInterval === undefined) return;
    clearInterval(timeInterval);
    timeInterval = undefined;
  };

  const startTimePolling = (): void => {
    if (timeInterval !== undefined) return;
    timeInterval = setInterval(() => {
      const current = player;
      if (destroyed || !current) return;
      try {
        knownCurrentTime = current.getCurrentTime();
        emit({
          currentTime: knownCurrentTime,
          buffered: bufferedRanges(current, knownCurrentTime)
        });
      } catch {
        // Polling must not escape the provider boundary.
      }
    }, TIME_UPDATE_INTERVAL_MS);
  };

  const timeUpdates = {
    start: startTimePolling,
    stop: stopTimePolling,
    adoptCurrentTime: (current: Pick<YouTubePlayer, 'getCurrentTime'>) => {
      knownCurrentTime = current.getCurrentTime();
      return knownCurrentTime;
    },
    setCurrentTime: (time: number) => {
      knownCurrentTime = time;
    },
    getCurrentTime: () => knownCurrentTime
  };

  const playback = createYouTubePlayback({
    emit,
    isDestroyed: () => destroyed,
    getPlayer: () => player,
    getReadyPlayer: () => guardReady(),
    timeUpdates
  });

  const fullscreenElementIsOurs = (): boolean => {
    const fullscreenElement = ownerDocument.fullscreenElement;
    if (!fullscreenElement) return false;
    const iframe = safeIframe();
    return (
      fullscreenElement === iframe ||
      fullscreenElement === mount ||
      mount.contains(fullscreenElement)
    );
  };

  const onFullscreenChange = (originalEvent: Event): void => {
    if (destroyed) return;
    const fullscreen = fullscreenElementIsOurs();
    emit(
      { fullscreen },
      providerEvent('fullscreenchange', { fullscreen }, originalEvent)
    );
  };

  const fullscreenAvailability = (): Availability => {
    const iframe = safeIframe();
    return typeof iframe?.requestFullscreen === 'function'
      ? available
      : browserUnavailable;
  };

  function playerCapabilities(): PlayerCapabilities {
    return readyCapabilities(
      fullscreenAvailability(),
      textTracks.textTrackAvailability()
    );
  }

  const textTracks = createYouTubeTextTracks({
    emit,
    getReadyPlayer: () => guardReady(),
    getCapabilities: playerCapabilities
  });

  const emitReadyState = (): void => {
    const current = player;
    if (!current) return;
    const duration = current.getDuration();
    // No command has run yet, so these reads are the player's own state.
    const { muted, volume } = playback.adoptVolume(current);
    const currentTime = timeUpdates.adoptCurrentTime(current);
    emit(
      {
        lifecycle: 'ready',
        activation: 'ready',
        // The iframe API drops calls made before onReady, so this is the first
        // moment a command lands (#69).
        commandsReady: true,
        currentTime,
        duration: Number.isFinite(duration) && duration > 0 ? duration : null,
        muted,
        volume,
        playbackRate: current.getPlaybackRate(),
        capabilities: playerCapabilities()
      },
      providerEvent('ready', undefined)
    );
  };

  const teardownPlayer = (): void => {
    playback.settlePendingPlays({ ok: false, reason: 'not-ready' });
    stopTimePolling();
    ready = false;
    // A retry recreates the player, so cached caption state must not leak
    // into the new session's capabilities before its own onApiChange fires.
    // Neither must a buffer anchor: the new player has loaded nothing.
    bufferView = undefined;
    textTracks.reset();
    const current = player;
    player = undefined;
    if (current) {
      try {
        current.destroy();
      } catch {
        // Teardown must not escape the provider boundary.
      }
    }
    playerTarget?.remove();
    playerTarget = undefined;
  };

  const start = async (forGeneration: number): Promise<void> => {
    const api = await loadIframeApi();
    if (destroyed || forGeneration !== generation) return;
    // Google recommends declaring the embedding origin when the JS API is
    // active so the player can validate postMessage targets.
    const embedOrigin = ownerDocument.defaultView?.location?.origin;
    const target = ownerDocument.createElement('div');
    mount.appendChild(target);
    playerTarget = target;
    player = new api.Player(target, {
      host,
      videoId,
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 0,
        playsinline: 1,
        rel: 0,
        ...(embedOrigin ? { origin: embedOrigin } : {})
      },
      events: {
        onReady: () => {
          if (destroyed || forGeneration !== generation) return;
          ready = true;
          // The captions module's own discovery signal (onApiChange) is
          // undocumented and not guaranteed to fire on its own, so proactively
          // load it as a safety net; unverified against a real player (see
          // issue #11).
          if (typeof player?.loadModule === 'function') {
            try {
              player.loadModule('captions');
            } catch {
              // Best-effort; must not block emitting ready state.
            }
          }
          emitReadyState();
        },
        onStateChange: ({ data }) => {
          if (destroyed || forGeneration !== generation) return;
          playback.handlers.onPlayerStateChange(data);
        },
        onError: ({ data }) => {
          if (destroyed || forGeneration !== generation) return;
          playback.handlers.onPlayerError(data);
        },
        onPlaybackRateChange: ({ data }) => {
          if (destroyed || forGeneration !== generation) return;
          emit(
            { playbackRate: data },
            providerEvent('ratechange', { playbackRate: data })
          );
        },
        onApiChange: () => {
          if (destroyed || forGeneration !== generation) return;
          textTracks.discover();
        }
      }
    });
  };

  const guardReady = (): YouTubePlayer | undefined =>
    destroyed || !ready ? undefined : player;

  return {
    provider: 'youtube',
    attach: () => {
      if (attached || destroyed) return;
      attached = true;
      ownerDocument.addEventListener('fullscreenchange', onFullscreenChange);
      emit({
        lifecycle: 'loading',
        activation: 'loading-provider',
        capabilities: preReadyCapabilities()
      });
    },
    load: async () => {
      if (destroyed || loadRequested) return;
      loadRequested = true;
      await start(generation);
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      generation += 1;
      teardownPlayer();
      if (attached) {
        ownerDocument.removeEventListener(
          'fullscreenchange',
          onFullscreenChange
        );
      }
      listeners.clear();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    play: playback.play,
    pause: playback.pause,
    seekTo: playback.seekTo,
    seekBy: playback.seekBy,
    mute: playback.mute,
    unmute: playback.unmute,
    setVolume: playback.setVolume,
    setPlaybackRate: playback.setPlaybackRate,
    selectTextTrack: textTracks.selectTextTrack,
    requestFullscreen: async () => {
      if (destroyed || !player) return { ok: false, reason: 'not-ready' };
      // Fullscreen must wrap the whole iframe: YouTube policy requires the
      // provider chrome to stay visible and interactive.
      const target = safeIframe() ?? mount;
      if (typeof target.requestFullscreen !== 'function') {
        return { ok: false, reason: 'unsupported' };
      }
      try {
        await target.requestFullscreen();
        return { ok: true };
      } catch (cause) {
        return commandFailure(cause);
      }
    },
    exitFullscreen: async () => {
      if (!fullscreenElementIsOurs()) return { ok: true };
      if (typeof ownerDocument.exitFullscreen !== 'function') {
        return { ok: false, reason: 'unsupported' };
      }
      try {
        await ownerDocument.exitFullscreen();
        return { ok: true };
      } catch (cause) {
        return commandFailure(cause);
      }
    },
    retry: async () => {
      if (destroyed) return { ok: false, reason: 'not-ready' };
      const forGeneration = ++generation;
      teardownPlayer();
      loadRequested = true;
      try {
        await start(forGeneration);
        return { ok: true };
      } catch (cause) {
        if (destroyed || forGeneration !== generation) {
          return { ok: false, reason: 'not-ready' };
        }
        return loadFailure(cause);
      }
    }
  };
};
