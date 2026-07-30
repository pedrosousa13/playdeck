import type {
  Availability,
  CommandResult,
  PlayerCapabilities,
  ProviderAdapter,
  ProviderEvent,
  ProviderStateListener,
  TimeRange
} from '@reely/core';
import {
  available,
  blockedError,
  browserUnavailable,
  clamp01,
  commandFailure,
  loadFailure,
  nextBufferView,
  playbackError,
  playerStates,
  preReadyCapabilities,
  providerEvent,
  readyCapabilities,
  runYouTubeCommand,
  type BufferView
} from './adapter-values.js';
import {
  loadYouTubeIframeApi,
  type YouTubeIframeApi,
  type YouTubePlayer
} from './loader.js';
import { createYouTubeTextTracks } from './text-tracks.js';

export {
  loadYouTubeIframeApi,
  type YouTubeIframeApi,
  type YouTubePlayer,
  type YouTubePlayerConstructor,
  type YouTubePlayerEventHandlers,
  type YouTubePlayerOptions
} from './loader.js';

/**
 * YouTube reports a blocked autoplay attempt by silently staying paused, so an
 * unconfirmed play request is reported as blocked after this window.
 */
export const PLAYBACK_CONFIRMATION_TIMEOUT_MS = 3_000;

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

type PendingPlay = {
  readonly resolve: (result: CommandResult) => void;
  readonly timer: ReturnType<typeof setTimeout>;
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
  let pendingPlays: PendingPlay[] = [];
  let timeInterval: ReturnType<typeof setInterval> | undefined;
  // The iframe API proxies commands over postMessage, so getters read stale
  // values right after a command. These mirrors track the last confirmed or
  // intended values instead; commands emit intent, events and polling confirm.
  let knownMuted = false;
  let knownVolume = 1;
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

  const settlePendingPlays = (result: CommandResult): void => {
    const settled = pendingPlays;
    pendingPlays = [];
    settled.forEach(({ resolve, timer }) => {
      clearTimeout(timer);
      resolve(result);
    });
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
    knownMuted = current.isMuted();
    knownVolume = clamp01(current.getVolume() / 100);
    knownCurrentTime = current.getCurrentTime();
    emit(
      {
        lifecycle: 'ready',
        activation: 'ready',
        // The iframe API drops calls made before onReady, so this is the first
        // moment a command lands (#69).
        commandsReady: true,
        currentTime: knownCurrentTime,
        duration: Number.isFinite(duration) && duration > 0 ? duration : null,
        muted: knownMuted,
        volume: knownVolume,
        playbackRate: current.getPlaybackRate(),
        capabilities: playerCapabilities()
      },
      providerEvent('ready', undefined)
    );
  };

  const emitVolumeIntent = (): void => {
    const muted = knownMuted;
    const volume = knownVolume;
    emit({ muted, volume }, providerEvent('volumechange', { muted, volume }));
  };

  const onPlayerStateChange = (data: number): void => {
    const current = player;
    if (destroyed || !current) return;
    if (data === playerStates.PLAYING) {
      settlePendingPlays({ ok: true });
      const duration = current.getDuration();
      knownCurrentTime = current.getCurrentTime();
      emit(
        {
          playback: 'playing',
          buffering: false,
          currentTime: knownCurrentTime,
          duration: Number.isFinite(duration) && duration > 0 ? duration : null
        },
        providerEvent('play', undefined)
      );
      startTimePolling();
      return;
    }
    if (data === playerStates.PAUSED) {
      stopTimePolling();
      knownCurrentTime = current.getCurrentTime();
      emit(
        { playback: 'paused', currentTime: knownCurrentTime },
        providerEvent('pause', undefined)
      );
      return;
    }
    if (data === playerStates.ENDED) {
      stopTimePolling();
      knownCurrentTime = current.getCurrentTime();
      emit(
        {
          playback: 'ended',
          buffering: false,
          currentTime: knownCurrentTime
        },
        providerEvent('ended', undefined)
      );
      return;
    }
    if (data === playerStates.BUFFERING) {
      // Buffering means the play request was accepted and media is loading.
      // Blocked autoplay never buffers, so a pending play is confirmed here
      // instead of timing out as blocked on a slow network.
      settlePendingPlays({ ok: true });
      emit({ buffering: true });
      return;
    }
    if (data === playerStates.CUED) {
      emit({ buffering: false });
    }
  };

  const onPlayerError = (code: number): void => {
    if (destroyed) return;
    stopTimePolling();
    const error = playbackError(code);
    settlePendingPlays({ ok: false, reason: 'provider-error', error });
    emit(
      {
        lifecycle: 'error',
        activation: 'error',
        buffering: false,
        error
      },
      providerEvent('error', error)
    );
  };

  const teardownPlayer = (): void => {
    settlePendingPlays({ ok: false, reason: 'not-ready' });
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
          onPlayerStateChange(data);
        },
        onError: ({ data }) => {
          if (destroyed || forGeneration !== generation) return;
          onPlayerError(data);
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

  const runCommand = (
    command: (current: YouTubePlayer) => void
  ): Promise<CommandResult> => runYouTubeCommand(guardReady(), command);

  const seekToTime = (time: number): Promise<CommandResult> => {
    if (!Number.isFinite(time)) {
      return Promise.resolve({ ok: false, reason: 'provider-error' });
    }
    const target = Math.max(0, time);
    return runCommand((current) => {
      current.seekTo(target, true);
      // Emit the intended position: a read-back here would still return the
      // pre-seek time, and paused playback never polls a correction.
      knownCurrentTime = target;
      emit({ currentTime: target });
    });
  };

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
    play: () => {
      const current = guardReady();
      if (!current) {
        return Promise.resolve({ ok: false, reason: 'not-ready' });
      }
      if (current.getPlayerState() === playerStates.PLAYING) {
        return Promise.resolve({ ok: true });
      }
      return new Promise<CommandResult>((resolve) => {
        const pending: PendingPlay = {
          resolve,
          timer: setTimeout(() => {
            pendingPlays = pendingPlays.filter((entry) => entry !== pending);
            // Double-check before reporting blocked in case a state-change
            // event was missed: an accepted request shows up as playing or
            // buffering. A play that starts from the iframe chrome after a
            // genuine blocked report is a user action, so the blocked
            // autoplay outcome stays accurate, matching the core semantics.
            let playerState: number | undefined;
            try {
              playerState = current.getPlayerState();
            } catch {
              playerState = undefined;
            }
            if (
              playerState === playerStates.PLAYING ||
              playerState === playerStates.BUFFERING
            ) {
              resolve({ ok: true });
              return;
            }
            resolve({ ok: false, reason: 'blocked', error: blockedError() });
          }, PLAYBACK_CONFIRMATION_TIMEOUT_MS)
        };
        pendingPlays.push(pending);
        try {
          current.playVideo();
        } catch (cause) {
          pendingPlays = pendingPlays.filter((entry) => entry !== pending);
          clearTimeout(pending.timer);
          resolve(commandFailure(cause));
        }
      });
    },
    pause: () => runCommand((current) => current.pauseVideo()),
    seekTo: (time) => seekToTime(time),
    seekBy: (offset) => {
      if (!Number.isFinite(offset)) {
        return Promise.resolve({ ok: false, reason: 'provider-error' });
      }
      const current = guardReady();
      if (!current) return Promise.resolve({ ok: false, reason: 'not-ready' });
      // The mirror is the freshest honest base: a getter read right after an
      // earlier seek command would still return the pre-seek position.
      return seekToTime(knownCurrentTime + offset);
    },
    mute: () =>
      runCommand((current) => {
        current.mute();
        knownMuted = true;
        emitVolumeIntent();
      }),
    unmute: () =>
      runCommand((current) => {
        current.unMute();
        knownMuted = false;
        emitVolumeIntent();
      }),
    setVolume: (volume) => {
      if (!Number.isFinite(volume)) {
        return Promise.resolve({ ok: false, reason: 'provider-error' });
      }
      return runCommand((current) => {
        current.setVolume(Math.round(clamp01(volume) * 100));
        knownVolume = clamp01(volume);
        emitVolumeIntent();
      });
    },
    setPlaybackRate: (rate) => {
      if (!Number.isFinite(rate) || rate <= 0) {
        return Promise.resolve({ ok: false, reason: 'provider-error' });
      }
      return runCommand((current) => current.setPlaybackRate(rate));
    },
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
