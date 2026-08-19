import type { CommandResult } from '@playdeck/core';
import {
  commandError,
  mediaError,
  providerEvent,
  runCommand,
  withinMediaBounds,
  type EmitProviderState
} from './adapter-values.js';

export type NativePlaybackOptions = {
  readonly loop?: boolean;
  /**
   * Start playback at this offset in seconds. `Root`'s `startTime` prop reaches
   * every provider since #214 -- the three embeds declare the key on their own
   * options bags and enforce the boundary themselves, and `Root` folds the prop
   * into whichever bag the detected source belongs to. This declaration is the
   * native and HLS route to the same prop, and the semantics below are the
   * contract all five providers implement.
   */
  readonly startTime?: number;
  /**
   * End playback at this offset in seconds. Reaches every provider since #214,
   * on the same terms as `startTime` above: adapter-enforced everywhere, never
   * handed to a platform's own end mechanism.
   */
  readonly endTime?: number;
};

export type NativePlaybackDeps = {
  readonly emit: EmitProviderState;
  // Lifecycle guard: a deferred loop replay must not touch the element after
  // the provider has been destroyed.
  readonly isDestroyed: () => boolean;
};

// The playback seam: transport commands plus the [startTime, endTime] boundary
// state machine they share with the playback-driven media events. The mutable
// boundary state (ended-at-boundary, seek-out-of-ended, replay generation,
// initial positioning) lives here and nowhere else; the host wires `handlers`
// to the media element and delegates the commands verbatim.
export type NativePlayback = {
  readonly play: () => Promise<CommandResult>;
  readonly pause: () => Promise<CommandResult>;
  readonly seekTo: (time: number) => Promise<CommandResult>;
  readonly seekBy: (offset: number) => Promise<CommandResult>;
  readonly mute: () => Promise<CommandResult>;
  readonly unmute: () => Promise<CommandResult>;
  readonly setVolume: (volume: number) => Promise<CommandResult>;
  readonly setPlaybackRate: (rate: number) => Promise<CommandResult>;
  readonly retry: () => Promise<CommandResult>;
  // Applies the configured start position once, when metadata first allows it.
  readonly applyInitialPosition: () => void;
  // Invalidates any deferred loop replay; called on destroy.
  readonly cancelPendingReplay: () => void;
  readonly handlers: {
    readonly onPlay: (originalEvent: Event) => void;
    readonly onPlaying: () => void;
    readonly onPause: (originalEvent: Event) => void;
    readonly onEnded: (originalEvent: Event) => void;
    readonly onWaiting: () => void;
    readonly onSeeking: (originalEvent: Event) => void;
    readonly onSeeked: (originalEvent: Event) => void;
    readonly onTimeUpdate: (originalEvent: Event) => void;
    readonly onError: (originalEvent: Event) => void;
  };
};

export const createNativePlayback = (
  media: HTMLVideoElement,
  options: NativePlaybackOptions,
  { emit, isDestroyed }: NativePlaybackDeps
): NativePlayback => {
  const startTime =
    Number.isFinite(options.startTime) && (options.startTime ?? 0) > 0
      ? (options.startTime ?? 0)
      : 0;
  const endTime =
    Number.isFinite(options.endTime) && (options.endTime ?? 0) > startTime
      ? options.endTime
      : undefined;
  const loop = options.loop ?? false;
  let positioned = false;
  let boundaryEnded = false;
  let seekingFromEnded = false;
  let replayGeneration = 0;

  const boundaryStart = (): number =>
    withinMediaBounds(media, startTime, startTime, endTime) ?? startTime;

  const beforeEffectiveEnd = (time: number): boolean => {
    const duration = Number.isFinite(media.duration)
      ? media.duration
      : undefined;
    const effectiveEnd =
      endTime === undefined
        ? duration
        : duration === undefined
          ? endTime
          : Math.min(endTime, duration);
    return effectiveEnd === undefined || time < effectiveEnd;
  };

  const restartFromBoundary = (): void => {
    boundaryEnded = false;
    seekingFromEnded = false;
    const restartTime = boundaryStart();
    const generation = ++replayGeneration;
    media.currentTime = restartTime;
    emit({ currentTime: restartTime, buffering: false });
    void Promise.resolve().then(async () => {
      if (isDestroyed() || generation !== replayGeneration) return;
      try {
        await media.play();
      } catch (cause) {
        if (isDestroyed() || generation !== replayGeneration) return;
        boundaryEnded = true;
        const failure = commandError(cause);
        emit({
          playback: 'ended',
          buffering: false,
          seeking: false,
          error: failure.error
        });
      }
    });
  };

  const onPlay = (originalEvent: Event): void => {
    boundaryEnded = false;
    seekingFromEnded = false;
    emit(
      {
        playback: 'playing',
        buffering: false,
        currentTime: media.currentTime
      },
      providerEvent('play', originalEvent, undefined)
    );
  };
  const onPlaying = (): void => emit({ playback: 'playing', buffering: false });
  const onPause = (originalEvent: Event): void => {
    if (boundaryEnded) return;
    emit(
      { playback: 'paused' },
      providerEvent('pause', originalEvent, undefined)
    );
  };
  const onEnded = (originalEvent: Event): void => {
    if (loop) {
      restartFromBoundary();
      return;
    }
    boundaryEnded = true;
    emit(
      { playback: 'ended', buffering: false },
      providerEvent('ended', originalEvent, undefined)
    );
  };
  const onWaiting = (): void => emit({ buffering: true });
  const onSeeking = (originalEvent: Event): void => {
    if (boundaryEnded && beforeEffectiveEnd(media.currentTime)) {
      boundaryEnded = false;
      seekingFromEnded = true;
    }
    emit(
      { seeking: true },
      providerEvent('seeking', originalEvent, {
        currentTime: media.currentTime
      })
    );
  };
  const onSeeked = (originalEvent: Event): void => {
    const playback = seekingFromEnded ? { playback: 'paused' as const } : {};
    seekingFromEnded = false;
    emit(
      { seeking: false, currentTime: media.currentTime, ...playback },
      providerEvent('seeked', originalEvent, { currentTime: media.currentTime })
    );
  };
  const onTimeUpdate = (originalEvent: Event): void => {
    if (endTime !== undefined && media.currentTime >= endTime) {
      if (loop) {
        restartFromBoundary();
        return;
      }
      media.currentTime = endTime;
      if (!boundaryEnded) {
        boundaryEnded = true;
        media.pause();
        emit(
          { currentTime: endTime, playback: 'ended', buffering: false },
          providerEvent('ended', originalEvent, undefined)
        );
      }
      return;
    }
    boundaryEnded = false;
    emit({ currentTime: media.currentTime });
  };
  const onError = (originalEvent: Event): void => {
    ++replayGeneration;
    boundaryEnded = false;
    seekingFromEnded = false;
    const error = mediaError(media);
    emit(
      {
        lifecycle: 'error',
        activation: 'error',
        playback: 'paused',
        buffering: false,
        seeking: false,
        error
      },
      providerEvent('error', originalEvent, error)
    );
  };

  const seekToBounded = (target: number): Promise<CommandResult> =>
    runCommand(() => {
      if (boundaryEnded && beforeEffectiveEnd(target)) {
        boundaryEnded = false;
        seekingFromEnded = true;
      }
      media.currentTime = target;
    });

  return {
    play: () =>
      runCommand(() => {
        if (
          boundaryEnded ||
          (endTime !== undefined && media.currentTime >= endTime)
        ) {
          boundaryEnded = false;
          media.currentTime = boundaryStart();
        }
        return media.play();
      }),
    pause: () => {
      ++replayGeneration;
      return runCommand(() => media.pause());
    },
    seekTo: (time) => {
      if (!Number.isFinite(time))
        return Promise.resolve({ ok: false, reason: 'provider-error' });
      const target = withinMediaBounds(media, time, startTime, endTime);
      if (target === undefined)
        return Promise.resolve({ ok: false, reason: 'provider-error' });
      return seekToBounded(target);
    },
    seekBy: (offset) => {
      if (!Number.isFinite(offset))
        return Promise.resolve({ ok: false, reason: 'provider-error' });
      const target = withinMediaBounds(
        media,
        media.currentTime + offset,
        startTime,
        endTime
      );
      if (target === undefined)
        return Promise.resolve({ ok: false, reason: 'provider-error' });
      return seekToBounded(target);
    },
    mute: () =>
      runCommand(() => {
        media.muted = true;
      }),
    unmute: () =>
      runCommand(() => {
        media.muted = false;
      }),
    setVolume: (volume) => {
      if (!Number.isFinite(volume))
        return Promise.resolve({ ok: false, reason: 'provider-error' });
      return runCommand(() => {
        media.volume = Math.min(1, Math.max(0, volume));
      });
    },
    setPlaybackRate: (rate) => {
      if (!Number.isFinite(rate) || rate <= 0)
        return Promise.resolve({ ok: false, reason: 'provider-error' });
      return runCommand(() => {
        media.playbackRate = rate;
      });
    },
    retry: () => {
      ++replayGeneration;
      return runCommand(() => {
        positioned = false;
        boundaryEnded = false;
        media.load();
      });
    },
    applyInitialPosition: () => {
      if (positioned) return;
      positioned = true;
      const initialPosition = withinMediaBounds(
        media,
        startTime,
        startTime,
        endTime
      );
      if (initialPosition !== undefined) media.currentTime = initialPosition;
    },
    cancelPendingReplay: () => {
      ++replayGeneration;
    },
    handlers: {
      onPlay,
      onPlaying,
      onPause,
      onEnded,
      onWaiting,
      onSeeking,
      onSeeked,
      onTimeUpdate,
      onError
    }
  };
};
