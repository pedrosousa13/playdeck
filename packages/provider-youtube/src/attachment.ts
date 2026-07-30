import type { CommandResult, PlayerCapabilities } from '@reely/core';
import {
  loadFailure,
  preReadyCapabilities,
  providerEvent,
  type EmitProviderState
} from './adapter-values.js';
import type { YouTubeIframeApi, YouTubePlayer } from './loader.js';
import type { YouTubePlayback } from './playback.js';
import type { YouTubePresentation } from './presentation.js';
import type { YouTubeTextTracks } from './text-tracks.js';
import type { YouTubeTimeUpdates } from './time-updates.js';

export type YouTubeAttachmentDeps = {
  readonly emit: EmitProviderState;
  readonly host: string;
  readonly loadIframeApi: () => Promise<YouTubeIframeApi>;
  // The host's ready capabilities snapshot, for the state published on ready.
  readonly getCapabilities: () => PlayerCapabilities;
  readonly playback: Pick<
    YouTubePlayback,
    'settlePendingPlays' | 'adoptVolume' | 'handlers'
  >;
  readonly presentation: Pick<YouTubePresentation, 'handlers'>;
  readonly textTracks: Pick<YouTubeTextTracks, 'discover' | 'reset'>;
  readonly timeUpdates: Pick<YouTubeTimeUpdates, 'adoptCurrentTime' | 'reset'>;
  // Drops the host's provider-state subscribers on destroy.
  readonly clearStateListeners: () => void;
};

// The attachment seam: the adapter's binding to its iframe player — attach,
// the iframe API load, player construction with every seam's event wiring,
// teardown, and the retry that replaces one player with the next. Owns the
// attached/destroyed/ready flags, the player and the element it replaced, and
// the start generation that makes a superseded player's events inert. Exposes
// the player guards every other seam depends on.
export type YouTubeAttachment = {
  readonly attach: () => void;
  readonly load: () => Promise<void>;
  readonly destroy: () => void;
  readonly retry: () => Promise<CommandResult>;
  readonly isDestroyed: () => boolean;
  // The player as soon as it is constructed, ready or not.
  readonly getPlayer: () => YouTubePlayer | undefined;
  // The player once it will accept a command: the iframe API drops calls made
  // before onReady (#69), so a command before then is not-ready, not lost.
  readonly getReadyPlayer: () => YouTubePlayer | undefined;
  // The player's iframe. `getIframe()` throws once the player is torn down,
  // which is not an error any caller can act on.
  readonly getIframe: () => HTMLIFrameElement | undefined;
};

export const createYouTubeAttachment = (
  mount: HTMLElement,
  videoId: string,
  {
    emit,
    host,
    loadIframeApi,
    getCapabilities,
    playback,
    presentation,
    textTracks,
    timeUpdates,
    clearStateListeners
  }: YouTubeAttachmentDeps
): YouTubeAttachment => {
  const ownerDocument = mount.ownerDocument;
  const { onFullscreenChange } = presentation.handlers;
  let attached = false;
  let destroyed = false;
  let loadRequested = false;
  let ready = false;
  let generation = 0;
  let player: YouTubePlayer | undefined;
  let playerTarget: HTMLElement | undefined;

  const getIframe = (): HTMLIFrameElement | undefined => {
    try {
      return player?.getIframe() ?? undefined;
    } catch {
      return undefined;
    }
  };

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
        capabilities: getCapabilities()
      },
      providerEvent('ready', undefined)
    );
  };

  const teardownPlayer = (): void => {
    playback.settlePendingPlays({ ok: false, reason: 'not-ready' });
    // A retry recreates the player, so cached caption state must not leak
    // into the new session's capabilities before its own onApiChange fires.
    // Neither must a buffer anchor: the new player has loaded nothing.
    timeUpdates.reset();
    ready = false;
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

  return {
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
      clearStateListeners();
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
    },
    isDestroyed: () => destroyed,
    getPlayer: () => player,
    getReadyPlayer: () => (destroyed || !ready ? undefined : player),
    getIframe
  };
};
