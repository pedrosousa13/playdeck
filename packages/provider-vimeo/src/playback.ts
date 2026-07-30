import type {
  Availability,
  PlayerCapabilities,
  ProviderAdapter,
  ProviderStatePatch,
  TimeRange
} from '@reely/core';
import {
  available,
  numberField,
  providerEvent,
  runVimeoCommand,
  type EmitProviderState,
  type IsStalePlayer,
  type VimeoMountElement
} from './adapter-values.js';
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
    player: Pick<VimeoPlaybackPlayer, 'setVolume' | 'setPlaybackRate'>,
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
  { emit, isStale, getPlayer, getCapabilities }: VimeoPlaybackDeps
): VimeoPlayback => {
  let currentTime = 0;
  let duration: number | null = null;
  let volumeAvailability: Availability = available;
  let playbackRateAvailability: Availability = available;

  const clampVolume = (volume: number): number =>
    Math.min(1, Math.max(0, volume));

  const seekTarget = (time: number): number =>
    Math.max(0, duration === null ? time : Math.min(duration, time));

  return {
    play: () => runVimeoCommand(getPlayer(), (player) => player.play()),
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
        const seconds = numberField(data, 'seconds') ?? duration ?? currentTime;
        currentTime = seconds;
        emit(
          { playback: 'ended', buffering: false, currentTime: seconds },
          providerEvent('ended', undefined, data)
        );
      },
      onTimeUpdate: (data) => {
        const seconds = numberField(data, 'seconds');
        const nextDuration = numberField(data, 'duration');
        if (seconds === undefined) return;
        currentTime = seconds;
        if (nextDuration !== undefined) duration = nextDuration;
        emit({
          currentTime: seconds,
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
        currentTime = seconds;
        emit(
          { seeking: false, currentTime: seconds },
          providerEvent('seeked', { currentTime: seconds }, data)
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
