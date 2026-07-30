import type { CommandResult, ProviderAdapter } from '@reely/core';
import {
  blockedError,
  clamp01,
  commandFailure,
  playbackError,
  playerStates,
  providerEvent,
  runYouTubeCommand,
  type EmitProviderState
} from './adapter-values.js';
import type { YouTubePlayer } from './loader.js';

/**
 * YouTube reports a blocked autoplay attempt by silently staying paused, so an
 * unconfirmed play request is reported as blocked after this window.
 */
export const PLAYBACK_CONFIRMATION_TIMEOUT_MS = 3_000;

// The slice of the player the transport commands drive and the player-reported
// state changes read: no iframe, module or teardown access.
export type YouTubeCommandPlayer = Pick<
  YouTubePlayer,
  | 'playVideo'
  | 'pauseVideo'
  | 'seekTo'
  | 'mute'
  | 'unMute'
  | 'setVolume'
  | 'setPlaybackRate'
  | 'getPlayerState'
  | 'getCurrentTime'
  | 'getDuration'
  | 'isMuted'
  | 'getVolume'
>;

type PendingPlay = {
  readonly resolve: (result: CommandResult) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

type YouTubeCommand =
  | 'play'
  | 'pause'
  | 'seekTo'
  | 'seekBy'
  | 'mute'
  | 'unmute'
  | 'setVolume'
  | 'setPlaybackRate';

// The polling seam holds the position mirror, so playback reads and reports
// the playhead through it rather than keeping a second copy.
export type YouTubePlaybackTimeUpdates = {
  readonly start: () => void;
  readonly stop: () => void;
  readonly adoptCurrentTime: (
    current: Pick<YouTubePlayer, 'getCurrentTime'>
  ) => number;
  readonly setCurrentTime: (time: number) => void;
  readonly getCurrentTime: () => number;
};

export type YouTubePlaybackDeps = {
  readonly emit: EmitProviderState;
  readonly isDestroyed: () => boolean;
  // The player as soon as it exists; the player reports state changes against
  // it from before the moment it will accept a command.
  readonly getPlayer: () => YouTubeCommandPlayer | undefined;
  // The player once it will accept a command; undefined before onReady, after
  // a teardown, and after destroy.
  readonly getReadyPlayer: () => YouTubeCommandPlayer | undefined;
  readonly timeUpdates: YouTubePlaybackTimeUpdates;
};

// The playback-command seam: the transport commands, the volume mirrors they
// emit intent through, and the player-reported state changes that confirm
// them. Owns the queue of play requests still waiting for confirmation —
// YouTube accepts `playVideo()` silently whether or not it will honor it, so a
// play is only answered once the player says it is playing or buffering, or
// the confirmation window closes on it.
export type YouTubePlayback = Required<
  Pick<ProviderAdapter, YouTubeCommand>
> & {
  // Answers every play still waiting for confirmation. The attachment seam
  // calls it on teardown, where no confirmation can ever arrive.
  readonly settlePendingPlays: (result: CommandResult) => void;
  // Adopts the player's own volume as the mirrors' starting point, for the
  // ready snapshot the attachment seam publishes.
  readonly adoptVolume: (
    current: Pick<YouTubeCommandPlayer, 'isMuted' | 'getVolume'>
  ) => { readonly muted: boolean; readonly volume: number };
  readonly handlers: {
    readonly onPlayerStateChange: (data: number) => void;
    readonly onPlayerError: (code: number) => void;
  };
};

export const createYouTubePlayback = ({
  emit,
  isDestroyed,
  getPlayer,
  getReadyPlayer,
  timeUpdates
}: YouTubePlaybackDeps): YouTubePlayback => {
  let pendingPlays: PendingPlay[] = [];
  // The iframe API proxies commands over postMessage, so getters read stale
  // values right after a command. These mirrors track the last confirmed or
  // intended values instead; commands emit intent, events and polling confirm.
  let knownMuted = false;
  let knownVolume = 1;

  const settlePendingPlays = (result: CommandResult): void => {
    const settled = pendingPlays;
    pendingPlays = [];
    settled.forEach(({ resolve, timer }) => {
      clearTimeout(timer);
      resolve(result);
    });
  };

  const runCommand = (
    command: (current: YouTubeCommandPlayer) => void
  ): Promise<CommandResult> => runYouTubeCommand(getReadyPlayer(), command);

  const emitVolumeIntent = (): void => {
    const muted = knownMuted;
    const volume = knownVolume;
    emit({ muted, volume }, providerEvent('volumechange', { muted, volume }));
  };

  const seekToTime = (time: number): Promise<CommandResult> => {
    if (!Number.isFinite(time)) {
      return Promise.resolve({ ok: false, reason: 'provider-error' });
    }
    const target = Math.max(0, time);
    return runCommand((current) => {
      current.seekTo(target, true);
      // Emit the intended position: a read-back here would still return the
      // pre-seek time, and paused playback never polls a correction.
      timeUpdates.setCurrentTime(target);
      emit({ currentTime: target });
    });
  };

  return {
    play: () => {
      const current = getReadyPlayer();
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
      if (!getReadyPlayer()) {
        return Promise.resolve({ ok: false, reason: 'not-ready' });
      }
      // The mirror is the freshest honest base: a getter read right after an
      // earlier seek command would still return the pre-seek position.
      return seekToTime(timeUpdates.getCurrentTime() + offset);
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
    settlePendingPlays,
    adoptVolume: (current) => {
      knownMuted = current.isMuted();
      knownVolume = clamp01(current.getVolume() / 100);
      return { muted: knownMuted, volume: knownVolume };
    },
    handlers: {
      onPlayerStateChange: (data) => {
        const current = getPlayer();
        if (isDestroyed() || !current) return;
        if (data === playerStates.PLAYING) {
          settlePendingPlays({ ok: true });
          const duration = current.getDuration();
          emit(
            {
              playback: 'playing',
              buffering: false,
              currentTime: timeUpdates.adoptCurrentTime(current),
              duration:
                Number.isFinite(duration) && duration > 0 ? duration : null
            },
            providerEvent('play', undefined)
          );
          timeUpdates.start();
          return;
        }
        if (data === playerStates.PAUSED) {
          timeUpdates.stop();
          emit(
            {
              playback: 'paused',
              currentTime: timeUpdates.adoptCurrentTime(current)
            },
            providerEvent('pause', undefined)
          );
          return;
        }
        if (data === playerStates.ENDED) {
          timeUpdates.stop();
          emit(
            {
              playback: 'ended',
              buffering: false,
              currentTime: timeUpdates.adoptCurrentTime(current)
            },
            providerEvent('ended', undefined)
          );
          return;
        }
        if (data === playerStates.BUFFERING) {
          // Buffering means the play request was accepted and media is
          // loading. Blocked autoplay never buffers, so a pending play is
          // confirmed here instead of timing out as blocked on a slow network.
          settlePendingPlays({ ok: true });
          emit({ buffering: true });
          return;
        }
        if (data === playerStates.CUED) {
          emit({ buffering: false });
        }
      },
      onPlayerError: (code) => {
        if (isDestroyed()) return;
        timeUpdates.stop();
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
      }
    }
  };
};
