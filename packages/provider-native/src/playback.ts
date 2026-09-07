import type { CommandResult, PlayerError } from '@playdeck/core';
import {
  commandError,
  declinesSeekTo,
  mediaError,
  providerEvent,
  runCommand,
  withinDeclaredBounds,
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
   * A start the source cannot be positioned at is not dropped in silence, since
   * #418. The provider publishes a non-fatal `configuration` notice on
   * `PlayerState.error` -- presentational, so a protective notice from the same
   * attach outranks it -- and leaves the playhead wherever this load left it:
   * the clamped position where one was written, the element's own starting
   * position where none was. The notice reports the refusal; it does not make
   * the offset apply.
   *
   * The refusal is detected by reading the playhead back, and on some engines
   * that read has to wait. The first read is in the same tick as the write:
   * where the engine clamps before the setter returns, that read already
   * shows the refusal. Where it does not, the provider polls `media.seeking`
   * -- which the HTML seek algorithm itself clears once a seek has finished,
   * refusal or not -- and takes its deferred read on the first poll that
   * finds it false. See the comment above `playheadAfterMovingTo` in
   * `playback.ts` for the measurements this is built on and for why
   * `media.seeking` is the instrument rather than a `seeked` listener or a
   * fixed delay.
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

// What a `startTime` the source could not be positioned at publishes. Reporting
// the refusal is the whole of it: the offset is still not applied, and the
// notice is what turns a start that vanished into a start the consumer can see
// was refused. Non-fatal, because the media plays — from wherever this load
// left the playhead. Never `recoverable`: the remedy is a change the consumer
// makes, so a retry re-runs the same configuration against the same source and
// reaches the same answer (#198).
//
// The shape that motivated it, measured on 2026-08-23 against Playwright's
// Linux WebKit, 6 parallel workers, a 10s WebM trickled so the parse lags
// playback, `startTime: 5`: of 60 loads, 51 arrived at `loadedmetadata` with a
// zero `duration` and an empty `seekable` and dropped the offset, 8 applied it,
// and 1 wrote nothing for an unrelated reason. Chromium and Firefox were not
// run in that arm, so it says nothing about them; a contradicting result is one
// where a paused WebKit element reports a seekable window before it has played.
//
// The message is static and names neither the requested offset nor the position
// reached — both are already on `PlayerState.currentTime` and in the consumer's
// own props, and a message that re-worded itself per load would be unreadable
// to a monitoring system, the ground #330 stood on.
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
    'The configured startTime could not be applied: the media could not be positioned there, so playback begins at a different position.'
};

// How far from the requested offset the playhead may settle and still count as
// the position the consumer asked for.
//
// Not a measured value, and deliberately not one. Every outcome #465 observed
// was either exact -- both engines landed on 5.000 where they honoured the
// write -- or wrong by seconds: 5 became 0 on a chromium element reporting
// `seekable [[0, 0]]`, and 9 was clamped by firefox to 5.84 on the WebM and
// 6.28 on the MP4, 3 of 3 each, never advancing after. Nothing measured lands
// in between, so the number's only job is to keep an engine that answers the
// nearest frame rather than the requested instant from being reported as a
// refusal. A quarter of a second is well below anything a viewer would call the
// wrong place and far below every refusal there is evidence of.
const SETTLED_POSITION_TOLERANCE_SECONDS = 0.25;

// How often `applyInitialPosition`'s deferred confirmation polls
// `media.seeking` while it is still true.
//
// A `setTimeout`, not `requestAnimationFrame`: rAF is throttled or stopped
// outright once a tab is backgrounded, and a startTime refusal is exactly as
// real there as in a focused tab, so the poll cannot depend on the page being
// visible to keep running.
const SEEKING_POLL_INTERVAL_MS = 50;

// How long the deferred confirmation waits for `media.seeking` to clear
// before giving up on this load's check.
//
// Fifteen seconds, the same number this repo's embeds use for their own
// "that is never coming" timeouts -- `PLAYER_READY_TIMEOUT_MS` in
// provider-vimeo's and provider-youtube's `attachment.ts`,
// `API_READY_TIMEOUT_MS` in provider-wistia's -- and chosen the same way: long
// enough that nothing measured here has ever needed it, so reaching it means
// the seek itself is stalled rather than merely slow. A stalled seek is a
// different failure than a refused startTime, and the consumer already sees
// the pending position on `PlayerState.currentTime`, so the deadline drops the
// check without publishing anything: undecided, not a refusal that was never
// established.
const START_POSITION_SETTLE_TIMEOUT_MS = 15_000;

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
  // The disposer for whatever `startTime` notice `applyInitialPosition` most
  // recently published, or `undefined` when nothing published by this seam
  // currently stands. Held so a later load's decision -- the one `retry`
  // resets `positioned` to get -- can withdraw a refusal that has since been
  // corrected, which the notice would otherwise go on reporting for the rest
  // of this provider's life (#475).
  let withdrawStartTimeNotice: (() => void) | undefined;
  let boundaryEnded = false;
  let seekingFromEnded = false;
  // Where the last end-boundary correction actually left the playhead, which is
  // not always the value it wrote. See `onTimeUpdate`.
  let correctionLandedAt: number | undefined;
  let replayGeneration = 0;
  // A counter of its own rather than a reuse of `replayGeneration`: that one
  // guards the boundary loop's deferred `play()`, and bumping it on every seek
  // would also cancel a legitimate in-flight loop replay a seek happens to
  // race with, which is not a change this fix is asking for. This one exists
  // only so `applyInitialPosition`'s deferred confirmation can tell "this is
  // not the load, or the playhead, it was scheduled for" apart from
  // destruction, which `isDestroyed` already covers on its own.
  let positionCheckGeneration = 0;
  // The confirmation's own pending poll, tracked so `abandonPositionCheck` can
  // cancel it outright rather than leave it to discover on its next tick that
  // `positionCheckGeneration` has moved past it.
  let pendingPositionCheck: ReturnType<typeof setTimeout> | undefined;

  // Shared by every path that makes a scheduled confirmation stale: a retry
  // reloading the source, a seek command moving the playhead, and destroy.
  // Bumping the counter is what the poll itself checks for; cancelling the
  // timer on top of that is what stops it running at all rather than running
  // once more to find out it no longer applies.
  const abandonPositionCheck = (): void => {
    ++positionCheckGeneration;
    clearTimeout(pendingPositionCheck);
    pendingPositionCheck = undefined;
  };

  const boundaryStart = (): number =>
    withinMediaBounds(media, startTime, startTime, endTime) ?? startTime;

  // Moves the playhead to `target` and answers where the element put it, or
  // `undefined` where nothing was written.
  //
  // The read-back is synchronous, and that is a measurement rather than a
  // reading of the specification. HTML has the seek algorithm continue "in
  // parallel" after the setter returns, which would leave `currentTime`
  // answering the value just written; both engines that could be run instead
  // apply their own clamp before the setter returns. Measured on 2026-09-01,
  // 3 runs per engine, Playwright's Linux chromium and firefox against this
  // repo's `apps/storybook/public/tracer-10s.mp4` (20,078 bytes) with the
  // response rewritten to `Accept-Ranges: none`: chromium reported `seekable
  // [[0, 0]]`, took `currentTime = 5` and read back 0.000 in the same
  // statement, and firefox reported `[[0, 10]]`, took the same write and read
  // back 5.000. Both elements still held those values a `seeked` event later.
  //
  // Firefox's full window there is a property of the clip and not of the
  // header: 20 KB arrives in one response, so nothing is left to fetch by
  // range. #465's table, measured on a different rig, has firefox answering
  // `[[0, 5.84]]` on the same arm; the read-back was not measured there.
  //
  // WebKit could not be run locally for any of this, and it degrades unsafely
  // rather than safely. An engine whose setter answers the value written before
  // its own clamp makes `reached === target` here, so a start that did not
  // apply would publish no notice through this synchronous read alone -- the
  // silent drop #418 exists to prevent, on the engine #418 was measured on.
  // That is why `applyInitialPosition` does not stop at this read: where it
  // reports success, a deferred read runs later and publishes the notice
  // there instead if the playhead has not kept up.
  //
  // The failure this synchronous read alone misses is a race rather than a
  // flat limitation, which is what makes a deferred read worth adding rather
  // than a permanent WebKit exception. CI measured
  // `e2e/native-start-time.spec.ts`'s origin-without-byte-ranges case on
  // WebKit across two runs on 2026-09-01: the first reported the playhead at 0
  // with no notice on the initial attempt and both retries; the second passed
  // the initial attempt and failed a retry. Chromium and firefox passed
  // throughout both runs. What the two runs establish is that this
  // synchronous read alone sometimes misses on WebKit and sometimes does not.
  //
  // A single deferred read on a fixed delay is not what closes that gap, and
  // this repo measured one failing rather than assumed it. CI's WebKit job ran
  // the same case on 2026-09-06 with the deferred read scheduled on the very
  // next macrotask after the synchronous one (`setTimeout(fn, 0)`), and two
  // attempts of three still reported the playhead at 0 with no notice
  // published, through a 5 second poll of the outcome. What that measured is
  // that WebKit's own seek task -- the one that reads `seekable`, finds it
  // empty, and aborts the seek -- is not reliably ordered ahead of a single
  // deferred read at a fixed delay. It says nothing about how long that task
  // takes; it says a guessed delay is not a sound instrument for waiting on it.
  //
  // The instrument that is not a guess is `media.seeking`. The HTML seek
  // algorithm sets it true at the start of every seek and false again when the
  // seek concludes -- on completion, and also on the abort this provider's
  // refusal shape produces, where `seekable` has no ranges to land in. Both
  // paths clear it, and the abort path is the one that fires no `seeked`,
  // which is why `applyInitialPosition` polls this property instead of
  // listening for that event. "The engine has finished deciding" is
  // `media.seeking === false`, on every engine measured here, rather than a
  // delay tuned to any one of them.
  //
  // The exposure is narrower than all of WebKit:
  // #418's own shape, a `duration` of 0 with an empty `seekable`, clamps the
  // target away from the requested offset and is reported by the
  // `target !== startTime` branch in `applyInitialPosition` without either
  // read being consulted at all. What the deferred read exists for is a
  // WebKit load that publishes a duration reaching the offset and then does
  // not move.
  //
  // So this synchronous check costs one property read and nothing else, and a
  // `seeked` listener would still be the wrong instrument for the deferred one
  // even with `seeking` available to poll: the seek this whole mechanism
  // exists to catch is the one the element abandons, and an abandoned seek
  // fires no `seeked` at all, so a listener would wait for an event that is
  // not coming. `media.seeking` is a property rather than an event, so
  // `applyInitialPosition` polls it on a `setTimeout` -- not
  // `requestAnimationFrame`, which is throttled or stopped outright in a
  // backgrounded tab, and the refusal this exists to catch is exactly as real
  // there as in a focused one -- and takes its one deferred read on the first
  // poll that finds `seeking` false, bounded by a deadline neither engine here
  // has been measured to need. See `applyInitialPosition` for both constants
  // and for what the deadline does instead of publishing.
  const playheadAfterMovingTo = (target: number): number | undefined => {
    // A write asking for the position the element already holds is not a no-op
    // -- see `applyInitialPosition` -- and it is not a refusal either.
    if (target === media.currentTime) return target;
    if (declinesSeekTo(media, target)) return undefined;
    media.currentTime = target;
    return media.currentTime;
  };

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
  const onPlaying = (): void => {
    emit({ playback: 'playing', buffering: false });
  };
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
  const onWaiting = (): void => {
    emit({ buffering: true });
  };
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
      // Only where the correction has somewhere to move. A write runs the seek
      // algorithm, whose `timeupdate` re-enters here with the playhead now
      // wherever that seek landed -- still at or past `endTime`, which still
      // satisfies the test above. So an unguarded correction seeks again, and
      // again, for as long as the player is attached.
      //
      // Two positions have nowhere to move, and they are not the same test.
      // `endTime` itself is where the correction would put the playhead, and a
      // same-value write is not a no-op -- it starts a seek, which is what
      // `playheadAfterMovingTo` above refuses for the same reason.
      //
      // `correctionLandedAt` is the other, and it is what keeps the loop cut on
      // a real element. The element does not have to land on the value written:
      // the seek algorithm clamps the target into `seekable` and engines snap
      // to a frame, so the playhead can settle a hair PAST `endTime` -- against
      // which `!== endTime` is true forever and the whole cycle resumes. Where
      // it settles is read straight back off the setter, because the seek
      // algorithm sets the official playback position synchronously and defers
      // only the notification. While the playhead is still sitting on what the
      // last correction produced, correcting again would ask the element to
      // redo a seek it has already answered; anything that actually moves it --
      // further overshoot from decoding, a seek command, a replay -- makes the
      // position differ and re-arms the correction. The target is the constant
      // `endTime`, so where a correction lands is a property of the element and
      // the media, not of when it was issued.
      //
      // Both are keyed on the position rather than on `boundaryEnded` because a
      // playhead can arrive past the boundary after the latch is set, and that
      // overshoot still has to come back.
      const playhead = media.currentTime;
      if (playhead !== endTime && playhead !== correctionLandedAt) {
        media.currentTime = endTime;
        correctionLandedAt = media.currentTime;
      }
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
      // A seek command means the playhead a deferred initial-position check
      // would see is no longer the one the initial write produced -- see
      // `abandonPositionCheck`.
      abandonPositionCheck();
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
      // Invalidates a pending initial-position check the same way: `positioned`
      // below is about to be reset, so any check already scheduled against the
      // load this replaces must not confirm or refuse against the reload.
      abandonPositionCheck();
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
      // The latch, set before any of the work and never reset except by
      // `retry`, which reloads the source. Deliberate, and #465 looked at
      // whether a later `loadedmetadata` should get another go: it should not.
      // Every refusal below is a settled property of this load rather than a
      // window that has yet to fill in — the media is shorter than the offset,
      // or the element declines to seek and goes on declining after
      // `readyState 4` — so a second attempt would re-reach the same answer and
      // republish the same notice. A retry that arrived later would also be a
      // start applied to a viewer who had already moved the playhead, which is
      // the floor behaviour this seam declines to have (see
      // `NativePlaybackOptions.startTime`).
      if (positioned) return;
      positioned = true;
      // Withdraw whatever this seam published about the load `retry` just
      // replaced, before deciding this one: a reload is a fresh decision (see
      // the comment above), and a refusal about media that is no longer
      // attached must not go on describing this load too. A no-op when
      // nothing is held (#475).
      withdrawStartTimeNotice?.();
      withdrawStartTimeNotice = undefined;
      // Nothing to apply without a start offset. The media load algorithm has
      // already put the playhead at 0, and if metadata arrives after playback
      // has begun, writing 0 is not applying a start position — it is
      // rewinding playback that already happened.
      if (startTime === 0) return;
      // `duration` is the bound, and `seekable` is not it — #465, which
      // replaced the hypothesis the issue was filed on. The element publishes a
      // correct duration at the first `loadedmetadata`, 96 of 96 runs across
      // chromium and firefox on a 10s clip, while `readyState` is 1 and the
      // seekable window is zero-length or a fraction; there is no separate
      // declared duration anywhere to go and fetch. So the offset is measured
      // against how long the media is, which is what stops a start beyond the
      // end of the media from being applied blindly.
      //
      // `seekable` still decides one thing, and it is not where to land: it
      // decides whether the element will move at all. Bounding on `duration`
      // alone would write 5 into a chromium element reporting `[[0, 0]]` and
      // report success, which is the worse defect — the same measurement waited
      // for `readyState 4`, `networkState 1` and `buffered [[0, 10]]` and the
      // write still landed at 0, 6 of 6 runs. What it no longer does is supply
      // the position: a window that does not cover the offset is a refusal
      // rather than an instruction to land on its nearest edge. That removes
      // the write onto a seekable edge the declared window does not reach --
      // a live source answering `startTime: 5` against `seekable [[100, 200]]`
      // used to pull the playhead back to 100 and report success, and now
      // writes nothing and reports the refusal.
      //
      // It does not remove #407's write, and the block above this function
      // describes a hazard that is still live. Where `duration` and the
      // seekable extent grow together -- the partly-parsed shape #407 measured
      // -- the duration bound answers the same number the seekable clamp used
      // to, and `declinesSeekTo` accepts it, because a target sitting exactly
      // on a range's end is inside that range. So the leading edge is still
      // written there. This package's `reports a start position clamped into a
      // partly-parsed window` is that case and still records the write; what
      // changed for it is only that the consumer is told, through #418's
      // notice.
      const target = withinDeclaredBounds(media, startTime, startTime, endTime);
      const reached = playheadAfterMovingTo(target);
      // Keyed on where the playhead ended up, not on whether a write happened
      // and not on what the write was predicted to do. A start the element
      // already holds writes nothing and is not a refusal — the caller got the
      // position they asked for. A start the element took and then did not move
      // to is a refusal, and before #465 it was the one shape that reported
      // success while doing nothing.
      if (
        target !== startTime ||
        reached === undefined ||
        Math.abs(reached - target) > SETTLED_POSITION_TOLERANCE_SECONDS
      ) {
        withdrawStartTimeNotice = emit({ error: startTimeConfigurationNotice });
        return;
      }
      // The synchronous read above reported success, which on WebKit is not
      // the same thing as the engine having finished deciding -- see the
      // comment above `playheadAfterMovingTo`. `media.seeking` is what the
      // HTML seek algorithm itself uses to say that: true from the moment this
      // seek started, and cleared again whether it completed or was aborted.
      // So this polls `seeking` rather than guessing a delay for
      // `currentTime`, and takes its one deferred read on the first poll that
      // finds `seeking` false -- immediately, where the engine had already
      // finished by the time the first poll runs (chromium and firefox, which
      // is why they see one poll and no more), or however many polls later
      // WebKit's own seek task needs.
      //
      // Asymmetric on purpose: a playhead the deferred read finds ABOVE the
      // target is playback that started in the meantime, not a refusal, so
      // only a playhead still short of it by more than the same tolerance
      // counts. A write the engine actually refuses leaves the playhead at
      // wherever this load's earlier position was -- 0, or an intermediate
      // clamp -- which is below the target whenever a start above zero was
      // configured, so "below" is what a refusal produces and "above" never
      // is one.
      const generation = ++positionCheckGeneration;
      const deadline = Date.now() + START_POSITION_SETTLE_TIMEOUT_MS;
      const poll = (): void => {
        // Every reason this drops silently: a retry reloaded the source or a
        // seek command ran, either of which calls `abandonPositionCheck` and
        // both bumps `positionCheckGeneration` (mismatching `generation` here)
        // and cancels this very timer; the provider was destroyed, likewise
        // via `abandonPositionCheck` from `cancelPendingReplay`, and checked
        // directly too since a destroyed element is not this poll's to read
        // regardless of which path reached it; or the deadline above passed
        // with the seek still unsettled, which is stalled media rather than a
        // decided refusal -- see `START_POSITION_SETTLE_TIMEOUT_MS`.
        if (isDestroyed() || generation !== positionCheckGeneration) return;
        if (media.seeking && Date.now() < deadline) {
          pendingPositionCheck = setTimeout(poll, SEEKING_POLL_INTERVAL_MS);
          return;
        }
        pendingPositionCheck = undefined;
        // Reaching the deadline still seeking is dropped here rather than
        // reported: see `START_POSITION_SETTLE_TIMEOUT_MS` for why that is
        // undecided rather than a refusal.
        if (media.seeking) return;
        if (target - media.currentTime > SETTLED_POSITION_TOLERANCE_SECONDS)
          withdrawStartTimeNotice = emit({
            error: startTimeConfigurationNotice
          });
      };
      pendingPositionCheck = setTimeout(poll, SEEKING_POLL_INTERVAL_MS);
    },
    cancelPendingReplay: () => {
      ++replayGeneration;
      // Destroy is the third path that makes a pending confirmation stale,
      // alongside a retry and a seek command -- see `abandonPositionCheck`.
      abandonPositionCheck();
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
