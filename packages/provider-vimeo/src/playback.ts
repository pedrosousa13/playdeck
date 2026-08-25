import type {
  Availability,
  PlayerCapabilities,
  ProviderAdapter,
  ProviderStatePatch,
  TimeRange
} from '@playdeck/core';
import {
  available,
  numberField,
  providerEvent,
  runVimeoCommand,
  type EmitProviderState,
  type IsStalePlayer,
  type VimeoMountElement
} from './adapter-values.js';
import type { VimeoBoundary } from './boundary.js';
import type { VimeoSdkPlayer } from './loader.js';

// The SDK hands back `[start, end]` pairs. Anything else is not a range we can
// vouch for, so it is dropped rather than guessed at.
const toRanges = (
  ranges: ReadonlyArray<readonly number[]>
): readonly TimeRange[] =>
  ranges.flatMap(([start, end]) =>
    typeof start === 'number' &&
    typeof end === 'number' &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    end >= start
      ? [{ start, end }]
      : []
  );

// The slice of the player the transport commands drive and the player-reported
// state changes read: no embed, track or teardown access.
export type VimeoPlaybackPlayer = Pick<
  VimeoSdkPlayer,
  | 'play'
  | 'pause'
  | 'setCurrentTime'
  | 'setMuted'
  | 'setVolume'
  | 'setPlaybackRate'
  | 'getMuted'
  | 'getBuffered'
>;

type VimeoPlaybackCommand =
  | 'play'
  | 'pause'
  | 'seekTo'
  | 'seekBy'
  | 'mute'
  | 'unmute'
  | 'setVolume'
  | 'setPlaybackRate';

// The player's own values as they read at attach, before any command has run.
export type VimeoPlaybackValues = {
  readonly duration: number | null;
  readonly muted: boolean;
  readonly volume: number;
  readonly playbackRate: number;
};

export type VimeoPlaybackDeps = {
  readonly emit: EmitProviderState;
  readonly isStale: IsStalePlayer;
  readonly getPlayer: () => VimeoPlaybackPlayer | undefined;
  // The host's capabilities snapshot, republished when a command proves a
  // capability this embed does not have.
  readonly getCapabilities: () => PlayerCapabilities;
  // The `[startTime, endTime]` window this seam enforces (#214).
  readonly boundary: VimeoBoundary;
};

// The playback-command seam: the transport commands and the playhead, duration
// and buffer the player reports back. Owns the two capabilities only a refused
// command can disprove — Vimeo answers `setVolume` and `setPlaybackRate` on
// every embed and only rejects the ones the platform or the plan withholds.
export type VimeoPlayback = Required<
  Pick<ProviderAdapter, VimeoPlaybackCommand>
> & {
  // Vimeo's cue payload carries no timings, so the tracks-and-captions seam
  // reads the playhead through this rather than keeping a second copy.
  readonly getCurrentTime: () => number;
  // Adopts the player's own values at attach and pushes the mount element's
  // overrides back into it, returning the patch fragment the attachment seam
  // folds into its ready state.
  readonly adopt: (
    player: Pick<
      VimeoPlaybackPlayer,
      'setVolume' | 'setPlaybackRate' | 'setCurrentTime'
    >,
    values: VimeoPlaybackValues
  ) => ProviderStatePatch;
  readonly handlers: {
    readonly onPlay: (data?: unknown) => void;
    readonly onPlaying: () => void;
    readonly onPause: (data?: unknown) => void;
    readonly onEnded: (data?: unknown) => void;
    readonly onTimeUpdate: (data?: unknown) => void;
    readonly onProgress: (
      player: Pick<VimeoPlaybackPlayer, 'getBuffered'>
    ) => void;
    readonly onBufferStart: () => void;
    readonly onBufferEnd: () => void;
    readonly onSeeking: (data?: unknown) => void;
    readonly onSeeked: (data?: unknown) => void;
    readonly onVolumeChange: (
      player: Pick<VimeoPlaybackPlayer, 'getMuted'>,
      data?: unknown
    ) => void;
    readonly onPlaybackRateChange: (data?: unknown) => void;
    readonly onDurationChange: (data?: unknown) => void;
  };
  // The `setVolume` facet of the host's capabilities.
  readonly setVolumeAvailability: () => Availability;
  // The `setPlaybackRate` facet of the host's capabilities.
  readonly setPlaybackRateAvailability: () => Availability;
};

export const createVimeoPlayback = (
  mount: Pick<VimeoMountElement, 'volume' | 'playbackRate'>,
  { emit, isStale, getPlayer, getCapabilities, boundary }: VimeoPlaybackDeps
): VimeoPlayback => {
  let currentTime = 0;
  let duration: number | null = null;
  let volumeAvailability: Availability = available;
  let playbackRateAvailability: Availability = available;

  const clampVolume = (volume: number): number =>
    Math.min(1, Math.max(0, volume));

  const seekTarget = (time: number): number => boundary.clamp(duration, time);

  // Puts the playhead back at the start boundary and picks playback up again.
  // Vimeo's own `loop=1` stays on the embed, so this only corrects the
  // position — the `play()` is for the case where the platform did stop.
  const restartFromBoundary = (): void => {
    boundary.setEnded(false);
    const target = boundary.start(duration);
    const token = boundary.openRestart();
    currentTime = target;
    emit({ currentTime: target, buffering: false });
    const player = getPlayer();
    if (!player) return;
    void Promise.resolve(player.setCurrentTime(target)).then(
      () => {
        if (!boundary.isRestartCurrent(token) || isStale(player)) return;
        void Promise.resolve(player.play()).catch(() => undefined);
      },
      () => undefined
    );
  };

  // Pulls a position the adapter never commanded back into the window and
  // answers where it was pulled to, or undefined when it was already inside.
  // The start boundary is a floor rather than a position `adopt` applies once
  // (#381), so a below-start position is corrected whatever put it there: an
  // SDK-side seek, a repeat `ready`, or the viewer dragging Vimeo's own scrub
  // bar. `seekTo` and `seekBy` are clamped into the same window, and the two
  // agree by construction — a clamped command lands on a position `correction`
  // leaves alone, so it is never corrected a second time.
  //
  // Nor can the correction chase itself: `correction` answers undefined for the
  // position it just asked for, so the `seeked` and `timeupdate` this seek
  // produces publish as ordinary reports rather than triggering another seek.
  //
  // It leaves the loop rule alone rather than being asked after it: a looping
  // embed's below-start playhead belongs to `wrapped`, which restarts *and*
  // resumes it, and `correction` declines that position wherever it is asked
  // from. That matters here and not on the time report — this handler has no
  // wrap test in front of it, and correcting onto the start would leave a
  // position `wrapped` no longer recognises, retiring the restart.
  const correctPosition = (time: number): number | undefined => {
    const target = boundary.correction(duration, time);
    if (target === undefined) return undefined;
    const player = getPlayer();
    if (player)
      void Promise.resolve(player.setCurrentTime(target)).catch(
        () => undefined
      );
    return target;
  };

  return {
    play: () =>
      runVimeoCommand(getPlayer(), async (player) => {
        // A play from the end boundary is a replay, not a resume: the playhead
        // is still sitting on the boundary the adapter ended at.
        if (boundary.hasEnded() || boundary.atEnd(duration, currentTime)) {
          boundary.setEnded(false);
          const target = boundary.start(duration);
          currentTime = target;
          await player.setCurrentTime(target);
        }
        return player.play();
      }),
    pause: () => runVimeoCommand(getPlayer(), (player) => player.pause()),
    seekTo: (time) => {
      if (!Number.isFinite(time))
        return Promise.resolve({ ok: false, reason: 'provider-error' });
      const target = seekTarget(time);
      return runVimeoCommand(getPlayer(), (player) =>
        player.setCurrentTime(target)
      );
    },
    seekBy: (offset) => {
      if (!Number.isFinite(offset))
        return Promise.resolve({ ok: false, reason: 'provider-error' });
      const target = seekTarget(currentTime + offset);
      return runVimeoCommand(getPlayer(), (player) =>
        player.setCurrentTime(target)
      );
    },
    mute: () => runVimeoCommand(getPlayer(), (player) => player.setMuted(true)),
    unmute: () =>
      runVimeoCommand(getPlayer(), (player) => player.setMuted(false)),
    setVolume: async (volume) => {
      if (!Number.isFinite(volume))
        return { ok: false, reason: 'provider-error' };
      const result = await runVimeoCommand(getPlayer(), (player) =>
        player.setVolume(clampVolume(volume))
      );
      if (!result.ok && result.reason === 'unsupported') {
        volumeAvailability = { status: 'unavailable', reason: 'provider' };
        emit({ capabilities: getCapabilities() });
      }
      return result;
    },
    setPlaybackRate: async (rate) => {
      if (!Number.isFinite(rate) || rate <= 0)
        return { ok: false, reason: 'provider-error' };
      const result = await runVimeoCommand(getPlayer(), (player) =>
        player.setPlaybackRate(rate)
      );
      if (!result.ok && result.reason === 'unsupported') {
        playbackRateAvailability = {
          status: 'unavailable',
          reason: 'provider-plan'
        };
        emit({ capabilities: getCapabilities() });
      }
      return result;
    },
    getCurrentTime: () => currentTime,
    adopt: (player, values) => {
      duration = values.duration;
      // The embed url's `#t=` fragment is a load hint; this is the authority,
      // and it also re-arms the boundary for the player a retry just built.
      boundary.adopt();
      const initialPosition = boundary.start(duration);
      if (initialPosition > 0) {
        currentTime = initialPosition;
        void Promise.resolve(player.setCurrentTime(initialPosition)).catch(
          () => undefined
        );
      }
      if (
        mount.volume !== undefined &&
        Number.isFinite(mount.volume) &&
        mount.volume !== values.volume
      ) {
        void player.setVolume(clampVolume(mount.volume)).catch(() => undefined);
      }
      if (
        mount.playbackRate !== undefined &&
        Number.isFinite(mount.playbackRate) &&
        mount.playbackRate > 0 &&
        mount.playbackRate !== values.playbackRate
      ) {
        void player.setPlaybackRate(mount.playbackRate).catch(() => undefined);
      }
      return {
        currentTime,
        duration,
        muted: values.muted,
        volume: values.volume,
        playbackRate: values.playbackRate,
        ...(duration === null
          ? {}
          : { seekable: [{ start: 0, end: duration }] })
      };
    },
    handlers: {
      onPlay: (data) => {
        boundary.setEnded(false);
        const seconds = numberField(data, 'seconds');
        if (seconds !== undefined) currentTime = seconds;
        emit(
          {
            playback: 'playing',
            buffering: false,
            ...(seconds === undefined ? {} : { currentTime: seconds })
          },
          providerEvent('play', undefined, data)
        );
      },
      onPlaying: () => emit({ playback: 'playing', buffering: false }),
      onPause: (data) => {
        // The pause the end boundary itself asked for, and the synthetic one
        // Vimeo fires just before `ended`, are both bookkeeping — neither is a
        // viewer pausing.
        if (boundary.hasEnded()) return;
        if (numberField(data, 'percent') === 1) return;
        const seconds = numberField(data, 'seconds');
        if (seconds !== undefined) currentTime = seconds;
        emit(
          {
            playback: 'paused',
            ...(seconds === undefined ? {} : { currentTime: seconds })
          },
          providerEvent('pause', undefined, data)
        );
      },
      onEnded: (data) => {
        // Only a looping window with a start boundary needs correcting; with
        // no start, `loop=1` already restarts where the window begins and the
        // embed's own end stays the end it has always published (the same gate
        // the YouTube and Wistia ports apply).
        if (boundary.restartsOnEnded()) {
          restartFromBoundary();
          return;
        }
        const seconds = numberField(data, 'seconds') ?? duration ?? currentTime;
        currentTime = seconds;
        boundary.setEnded(true);
        emit(
          { playback: 'ended', buffering: false, currentTime: seconds },
          providerEvent('ended', undefined, data)
        );
      },
      onTimeUpdate: (data) => {
        const seconds = numberField(data, 'seconds');
        const nextDuration = numberField(data, 'duration');
        if (seconds === undefined) return;
        if (nextDuration !== undefined) duration = nextDuration;
        if (boundary.atEnd(duration, seconds)) {
          if (boundary.loop) {
            restartFromBoundary();
            return;
          }
          // Every report past the boundary is out of the window, so nothing is
          // published until playback is back inside it. The overshoot itself is
          // corrected rather than only pinned in the report (#381): Vimeo
          // reports time on its own cadence, so the pause lands after the embed
          // has already run past the boundary, and pinning alone left the
          // viewer looking at a frame outside the window for as long as the
          // player stayed there while `currentTime` said the boundary. The
          // pause goes first so the seek is not overtaken by playback.
          if (boundary.hasEnded()) return;
          boundary.setEnded(true);
          const end = boundary.end(duration) ?? seconds;
          const overshoot = boundary.correction(duration, seconds);
          currentTime = end;
          const player = getPlayer();
          if (player) {
            void Promise.resolve(player.pause()).catch(() => undefined);
            if (overshoot !== undefined)
              void Promise.resolve(player.setCurrentTime(overshoot)).catch(
                () => undefined
              );
          }
          emit(
            { playback: 'ended', buffering: false, currentTime: end },
            providerEvent('ended', undefined, data)
          );
          return;
        }
        // Vimeo's own `loop=1` wraps to zero, not to the start boundary.
        if (boundary.wrapped(duration, seconds)) {
          restartFromBoundary();
          return;
        }
        currentTime = correctPosition(seconds) ?? seconds;
        boundary.setEnded(false);
        emit({
          currentTime,
          ...(nextDuration === undefined ? {} : { duration: nextDuration })
        });
      },
      // `progress.seconds` is the end of the range holding the playhead, not a
      // range from zero, so it cannot describe the buffer on its own: after a
      // seek it both hides real ranges and spans the hole in between (#91).
      // `getBuffered()` reports the ranges themselves.
      onProgress: (player) => {
        void player.getBuffered().then(
          (ranges) => {
            if (isStale(player)) return;
            emit({ buffered: toRanges(ranges) });
          },
          () => undefined
        );
      },
      onBufferStart: () => emit({ buffering: true }),
      onBufferEnd: () => emit({ buffering: false }),
      onSeeking: (data) => {
        const seconds = numberField(data, 'seconds') ?? currentTime;
        emit(
          { seeking: true },
          providerEvent('seeking', { currentTime: seconds }, data)
        );
      },
      onSeeked: (data) => {
        const seconds = numberField(data, 'seconds') ?? currentTime;
        // The seek nobody here asked for lands in this handler, and a paused
        // embed reports no `timeupdate` after one — so the window is applied
        // here as well, before the position is published rather than after.
        currentTime = correctPosition(seconds) ?? seconds;
        // A seek back inside the window retires the boundary end it landed
        // from, so the next pause is reported normally again.
        if (!boundary.atEnd(duration, currentTime)) boundary.setEnded(false);
        emit(
          { seeking: false, currentTime },
          providerEvent('seeked', { currentTime }, data)
        );
      },
      onVolumeChange: (player, data) => {
        const volume = numberField(data, 'volume');
        if (volume === undefined) return;
        void player.getMuted().then(
          (muted) => {
            if (isStale(player)) return;
            emit(
              { muted, volume },
              providerEvent('volumechange', { muted, volume }, data)
            );
          },
          () => undefined
        );
      },
      onPlaybackRateChange: (data) => {
        const playbackRate = numberField(data, 'playbackRate');
        if (playbackRate === undefined) return;
        emit(
          { playbackRate },
          providerEvent('ratechange', { playbackRate }, data)
        );
      },
      onDurationChange: (data) => {
        const nextDuration = numberField(data, 'duration');
        if (nextDuration === undefined) return;
        duration = nextDuration;
        emit({
          duration: nextDuration,
          seekable: [{ start: 0, end: nextDuration }]
        });
      }
    },
    setVolumeAvailability: () => volumeAvailability,
    setPlaybackRateAvailability: () => playbackRateAvailability
  };
};
