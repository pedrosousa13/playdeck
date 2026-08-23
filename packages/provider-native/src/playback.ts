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
   * contract all five providers implement — with one native divergence since
   * #411: a `startTime` of 0 now writes no position at all, so a live source
   * whose seekable window starts above 0 is left wherever the engine put it
   * rather than clamped back to the start of its DVR window.
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
  // Considers the configured start position once per load, when metadata first
  // allows it, and applies it only when the write can move the playhead
  // somewhere the caller asked for: a `startTime` of 0 and a `startTime` the
  // element already holds are both left alone. See the definition for why a
  // write the element could satisfy for free is not free.
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
    // Runs once, on the first `loadedmetadata` after each load. Writes only
    // when the write can move the playhead somewhere the caller asked for.
    //
    // A `currentTime` write that asks for the position the element already
    // holds is not a no-op: it starts a seek, and #407 measured what a seek
    // into a partly-parsed WebKit element costs. The write is clamped into
    // `seekable`, which on a source still being parsed reaches a fraction of
    // the clip, so the playhead lands exactly on the leading edge; WebKit then
    // fires `seeking`, `seeked` and `ended` from there, the network goes to
    // `stalled`, and the duration stays frozen at that fraction for good —
    // those are the observed events (e2e/reference.spec.ts:98-115).
    //
    // The element also ends up paused, and that last step is INFERRED, not
    // observed: no run captured `paused === true` at `currentTime === 0`, and
    // the reproduced wedges all kept `paused === false`. The inference is
    // sound because both halves of it are measured separately — #411 trapped
    // `HTMLMediaElement.prototype.pause` across 200 contended WebKit runs and
    // recorded no JS call in any of them, the ordinary end-of-clip pause
    // included, so the engine pauses at end of media unaided; and the write
    // above is what puts the element at end of media.
    //
    // This ran on EVERY native load before #411, the default `startTime` of 0
    // included. What was measured is the element's state at `loadedmetadata`,
    // which is when this runs, rather than at the instant of the write the way
    // #407 measured: on a progressively parsed WebM the parse reports a
    // duration that grows and playback has caught up with it, so metadata
    // arrives with `currentTime === duration` and `ended` already true — e.g.
    // `{paused: false, readyState: 4, currentTime: 0.000887, duration:
    // 0.000887, ended: true}`, seen repeatedly, with no run count recorded.
    // The counted evidence is a small arm rather than that one: serving the
    // WebM in trickled chunks so the parse lags playback, 3 of 3 runs wedged
    // at `currentTime 0` with the duration frozen at 0.0039 with this write in
    // place, and 0 of 3 with it suppressed, each of those playing through to
    // 1.000.
    //
    // The result a viewer saw was a clip that loaded completely and sat at
    // 0:00, with `playback: 'ended'` published for a clip that never showed a
    // frame.
    applyInitialPosition: () => {
      if (positioned) return;
      positioned = true;
      // Nothing to apply without a start offset. The media load algorithm has
      // already put the playhead at 0, and if metadata arrives after playback
      // has begun, writing 0 is not applying a start position — it is
      // rewinding playback that already happened.
      if (startTime === 0) return;
      const initialPosition = withinMediaBounds(
        media,
        startTime,
        startTime,
        endTime
      );
      if (initialPosition === undefined) return;
      // The same rule for a real start the element is already sitting on.
      if (initialPosition === media.currentTime) return;
      media.currentTime = initialPosition;
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
