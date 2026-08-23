import type { CommandResult, ProviderAdapter } from '@playdeck/core';
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
import type { YouTubeBoundary } from './boundary.js';
import type { YouTubePlayer } from './loader.js';
import type { YouTubeTimeUpdates } from './time-updates.js';

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

export type YouTubePlaybackDeps = {
  readonly emit: EmitProviderState;
  readonly isDestroyed: () => boolean;
  // The player as soon as it exists; the player reports state changes against
  // it from before the moment it will accept a command.
  readonly getPlayer: () => YouTubeCommandPlayer | undefined;
  // The player once it will accept a command; undefined before onReady, after
  // a teardown, and after destroy.
  readonly getReadyPlayer: () => YouTubeCommandPlayer | undefined;
  // The polling seam holds the position mirror, so playback reads and reports
  // the playhead through it rather than keeping a second copy.
  readonly timeUpdates: Pick<
    YouTubeTimeUpdates,
    'start' | 'stop' | 'adoptCurrentTime' | 'setCurrentTime' | 'getCurrentTime'
  >;
  // The [startTime, endTime] window: it clamps the seeks, repositions a play
  // that arrives at the end of the window, and tells the pause and ended
  // branches which of their events it caused itself.
  readonly boundary: Pick<
    YouTubeBoundary,
    | 'applyPlayPosition'
    | 'clearEnded'
    | 'clearEndedAndPendingResume'
    | 'isEnded'
    | 'onProviderEnded'
    | 'seekTarget'
  >;
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
  timeUpdates,
  boundary
}: YouTubePlaybackDeps): YouTubePlayback => {
  let pendingPlays: PendingPlay[] = [];
  // The iframe API proxies commands over postMessage, so getters read stale
  // values right after a command. These mirrors track the last confirmed or
  // intended values instead; commands emit intent, and `adoptVolume` confirms
  // by reading `isMuted()` and `getVolume()` back off the player. That
  // read-back happens at ready and nowhere else: the IFrame Player API
  // publishes no volume event — `onReady`, `onStateChange`,
  // `onPlaybackQualityChange`, `onPlaybackRateChange`, `onError` and
  // `onApiChange` are the set, and `attachment.ts` subscribes to five of them
  // — and nothing polls volume the way the position mirror is polled. So a
  // change a viewer makes in YouTube's own chrome is not observed here until
  // the next ready adopt (#365).
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

  // Moves the mirrors onto the values a command intends and publishes them,
  // but only where at least one of the two actually moved: an accepted command
  // asking for what the adapter already holds changed nothing, and reporting
  // it would count a change the media never made. The controller fans every
  // provider event straight out rather than deduping, so an unconditional emit
  // here is one a consumer counting `volumechange` would see (#365). Every
  // other adapter is already silent on such a command: native assigns the
  // element's `volume`/`muted` and lets the element fire only on a real
  // change, HLS delegates to native, and Vimeo and Wistia publish nothing at
  // all for an accepted command — their only emit off a volume command is a
  // capability downgrade on a `setVolume` refused as `unsupported`, which
  // reports what the player cannot do rather than a volume.
  //
  // The comparison takes the next values as arguments and does the assignment
  // itself, because it is the only way it can see both sides: each caller used
  // to overwrite the mirror before asking for the emit, leaving nothing to
  // compare against.
  //
  // `volume` is the unrounded clamped value the mirror keeps, never the 0-100
  // integer the player is sent: 0.501 and 0.502 are two distinct requests that
  // round onto the same player step, and comparing the rounded value would
  // silence the second and invent a precision boundary the adapter never had.
  const emitVolumeIntent = (muted: boolean, volume: number): void => {
    if (muted === knownMuted && volume === knownVolume) return;
    knownMuted = muted;
    knownVolume = volume;
    emit({ muted, volume }, providerEvent('volumechange', { muted, volume }));
  };

  const seekToTime = (time: number): Promise<CommandResult> => {
    if (!Number.isFinite(time)) {
      return Promise.resolve({ ok: false, reason: 'provider-error' });
    }
    // Clamped into the configured window: the floor is the start boundary (0
    // when none is set) and the ceiling the effective end, which is the same
    // place the boundary itself stops playback.
    const target = boundary.seekTarget(time);
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
      // A play at an end — this window's, or the media's own — replays the
      // window from the start boundary, matching native
      // (`provider-native/src/playback.ts:229-239`).
      boundary.applyPlayPosition(current);
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
    // The commands themselves still reach the player whether or not the
    // mirrors move, and that call is load-bearing rather than defensive: with
    // no volume event and no volume poll, `adoptVolume` at ready is the only
    // thing that ever re-reads the player, so re-asserting a mirror the
    // command did not move is the only mechanism that re-converges a player
    // whose volume has drifted from it — nothing else would notice until the
    // next `onReady`. The command result is the same accepted result it
    // always was.
    mute: () =>
      runCommand((current) => {
        current.mute();
        emitVolumeIntent(true, knownVolume);
      }),
    unmute: () =>
      runCommand((current) => {
        current.unMute();
        emitVolumeIntent(false, knownVolume);
      }),
    setVolume: (volume) => {
      if (!Number.isFinite(volume)) {
        return Promise.resolve({ ok: false, reason: 'provider-error' });
      }
      return runCommand((current) => {
        current.setVolume(Math.round(clamp01(volume) * 100));
        emitVolumeIntent(knownMuted, clamp01(volume));
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
          // Playback resumed, whether this adapter asked for it or the viewer
          // pressed YouTube's own play button. Either way the window is open
          // again, so the end boundary has to be able to fire a second time
          // (`provider-native`, `:129-131`; Vimeo `onPlay`; Wistia `onPlay`).
          boundary.clearEnded();
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
          // The boundary paused the player itself to stop at an end — this
          // window's, or the media's own — and already published that as an
          // end; reporting it again as a pause would contradict it
          // (`provider-native`, `:142-148`).
          if (boundary.isEnded()) return;
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
          // A looping embed with a start boundary restarts from that boundary
          // rather than from wherever YouTube's playlist loop lands. Every
          // other end is published as it always was, and latches the boundary
          // so the next `play()` replays the window from its start.
          if (boundary.onProviderEnded()) return;
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
        boundary.clearEndedAndPendingResume();
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
