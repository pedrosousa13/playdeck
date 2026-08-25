import type { CommandResult, PlayerError } from '@playdeck/core';
import {
  commandError,
  mediaError,
  providerEvent,
  runCommand,
  withinMediaBounds,
  type EmitProviderState
} from './adapter-values.js';

// `loop`, `startTime` and `endTime` are Playdeck's own props on `Player.Root`
// and work the same on every provider (ADR-0004): the three embeds declare them
// on their own option bags, and this type is where the native and HLS adapters
// implement them. `Root` folds its props into the bag belonging to the detected
// source's provider -- an embed bag, or this one -- so none of these is a
// second place a `Player.Root` consumer writes the setting.
export type NativePlaybackOptions = {
  /**
   * Restart the media when it ends. With a `startTime`, the restart returns
   * there rather than to zero.
   */
  readonly loop?: boolean;
  /**
   * Start playback at this offset in seconds. A value that is not finite, or
   * not above zero, is no start at all.
   *
   * Zero is a real value to write on a media element and it is deliberately not
   * written. The media load algorithm has already put the playhead at zero, so
   * the write can only take effect where something else moved it -- and on a
   * live source whose seekable window starts above zero that means pulling it
   * back to the start of the DVR window, which is not what asking for the start
   * of the media meant.
   *
   * A start the source cannot be positioned at is not dropped in silence. Since
   * #418 the provider publishes a non-fatal `configuration` notice on
   * `PlayerState.error` — presentational, so a protective notice from the same
   * attach outranks it — and leaves the playhead wherever this load left it,
   * which is the clamped position where one was written and the element's own
   * starting position where none was. The commonest cause is a WebKit element
   * that reports a zero
   * duration and an empty seekable window until it has played: 51 of 60
   * measured loads asking for 5s on a 10s clip stayed at 0. The notice reports
   * that; it does not make the offset apply.
   *
   * DECLARED DIVERGENCE FROM THE EMBEDS, since #381. There the start is a
   * *floor* on every reported position: a playhead that arrives below it
   * without a Playdeck command -- an SDK-side seek, the platform's own scrub
   * bar -- is seeked back into the window. Here it is applied once per load, by
   * `applyInitialPosition` below, and nothing re-applies it, so a viewer who
   * seeks below the start stays there. `seekTo` and `seekBy` are clamped into
   * the window on every provider, so only the uncommanded positions differ.
   * Native was out of scope for #381 for the reason it was for #214: its
   * boundary state machine is entangled with `HTMLVideoElement.seekable` --
   * `withinMediaBounds` reads the seekable ranges, and a live source's window
   * slides -- so a floor here is a decision about DVR windows rather than the
   * same one the embeds took. The end of the window does *not* diverge: this
   * seam writes `media.currentTime = endTime` at the boundary and since #381
   * every embed seeks back onto it too.
   */
  readonly startTime?: number;
  /**
   * End playback at this offset in seconds, publishing `ended` there rather
   * than at the media's own end. The adapter enforces the boundary itself and
   * never hands it to the element's own end mechanism. An end that is not
   * finite, or not above the sanitised `startTime`, is no end at all.
   */
  readonly endTime?: number;
};

// What a `startTime` the source could not be positioned at publishes. The
// offset is still not applied — that is #465 — but the drop is no longer
// silent, which is what #418 reported: measured over 60 real WebKit loads with
// `startTime: 5` on a 10s clip, 51 of them dropped the offset and the consumer
// was told nothing. Non-fatal: the media plays, from wherever this load left
// the playhead. Never `recoverable`: the remedy is a change the consumer
// makes, so a retry re-runs the same configuration against the same source and
// reaches the same answer (#198).
//
// Static, like every other notice here, and deliberately naming neither the
// requested offset nor the position reached. Both are already on
// `PlayerState.currentTime` and in the consumer's own props, and a message that
// re-worded itself per load would be unreadable to a monitoring system — the
// ground #330 stood on.
//
// `'presentational'`: a start offset that did not apply left nothing about the
// viewer unprotected, so it must yield the notice slot to any protective notice
// the same attach raises (#368).
const startTimeConfigurationNotice: PlayerError = {
  category: 'configuration',
  fatal: false,
  recoverable: false,
  severity: 'presentational',
  message:
    'The configured startTime could not be applied to this source, so playback begins somewhere other than the position that was asked for.'
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
      // Anything other than the offset the caller asked for is a refusal, and
      // since #418 it is reported rather than dropped in silence. Three shapes
      // reach here: no seekable range intersects the configured window at all,
      // so there is nowhere legal to land; the clamp landed on the empty
      // `seekable` and zero `duration` a WebKit element reports before it has
      // played, which answers 0; and the clamp landed inside a window still
      // being parsed, a fraction of the clip. The consumer is told in all
      // three, because from outside they are one thing: the offset they
      // configured is not where the playhead is.
      //
      // Keyed on the position rather than on whether a write happened. A start
      // the element already holds writes nothing and is not a refusal — the
      // caller got the position they asked for — and the write/skip rules
      // below are unchanged by the notice.
      if (initialPosition !== startTime)
        emit({ error: startTimeConfigurationNotice });
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
