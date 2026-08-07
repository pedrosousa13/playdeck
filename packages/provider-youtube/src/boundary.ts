import {
  atBoundaryEnd,
  atBoundaryWrap,
  boundaryEnd,
  boundaryStart,
  resolveTimeBoundary,
  restartsAtBoundaryStart,
  withinBoundary
} from '@reely/core';
import {
  playerStates,
  providerEvent,
  type EmitProviderState
} from './adapter-values.js';
import type { YouTubePlayer } from './loader.js';
import type { YouTubeTimeUpdates } from './time-updates.js';

// The slice of the player the boundary drives: it positions the playhead,
// stops it at the end of the window and starts it again on a loop restart.
export type YouTubeBoundaryPlayer = Pick<
  YouTubePlayer,
  'seekTo' | 'playVideo' | 'pauseVideo' | 'getPlayerState' | 'getDuration'
>;

export type YouTubeBoundaryOptions = {
  readonly loop?: boolean;
  readonly startTime?: number;
  readonly endTime?: number;
};

export type YouTubeBoundaryDeps = {
  readonly emit: EmitProviderState;
  // Lifecycle guard: a deferred loop resume must not touch a torn-down player.
  readonly isDestroyed: () => boolean;
  readonly getPlayer: () => YouTubeBoundaryPlayer | undefined;
  // The polling seam owns the position mirror and the poll itself; the
  // boundary pins the one and stops the other when it publishes an end.
  readonly timeUpdates: Pick<
    YouTubeTimeUpdates,
    'setCurrentTime' | 'getCurrentTime' | 'stop'
  >;
};

// The `[startTime, endTime]` seam: YouTube publishes no end boundary of its
// own that this adapter can trust, so the window is enforced here, from the
// 250 ms poll. Owns the ended-at-boundary latch, the once-per-attachment
// positioning flag, and the resume generation that makes a superseded loop
// restart inert (mirroring `provider-native/src/playback.ts:91-114`).
//
// One divergence from native is deliberate. Native sets
// `media.currentTime = endTime` at the boundary; polling at 250 ms can only
// notice the boundary after it has passed, so a corrective seek would be a
// visible backward jump plus a postMessage round trip. The emitted
// `currentTime` is pinned to the boundary instead and the playhead is left
// where the player stopped it. Frame-accurate enforcement is out of scope
// (#214).
export type YouTubeBoundary = {
  // The whole-second `start` player var, or undefined when there is no start.
  // A load hint only: it saves loading from zero, and the seek below is still
  // the authority because the var cannot carry a fraction.
  readonly startPlayerVar: number | undefined;
  // Applies the start position once per attachment, at the ready point where
  // the duration is first known. Returns the position it moved to, or
  // undefined when there was nothing to apply and the caller should report the
  // player's own time.
  readonly applyInitialPosition: (
    current: YouTubeBoundaryPlayer
  ) => number | undefined;
  // Called by the poll for every position it reads. False means the boundary
  // consumed the report and the poll must publish nothing for it.
  readonly onTimeReport: (time: number) => boolean;
  // True while playback sits at an end — this window's, or the media's own —
  // so the pause that put it there is not published as a pause of its own.
  readonly isEnded: () => boolean;
  // What the player's own ENDED state change means. True when a looping restart
  // consumed it and the caller must publish nothing; false when the caller
  // publishes the end as before, in which case this latches the ended flag so
  // the next `play()` replays the window from its start.
  readonly onProviderEnded: () => boolean;
  // Moves back to the start boundary when a play command arrives at an end —
  // this window's or the media's own — so the next play replays the window
  // rather than doing nothing.
  readonly applyPlayPosition: (current: YouTubeBoundaryPlayer) => void;
  // Clamps a requested seek into the window, and releases the ended latch when
  // the target lands back inside it.
  readonly seekTarget: (time: number) => number;
  // Releases the latch alone, for a resume the adapter did not ask for: with
  // `controls: true` the viewer can press YouTube's own play button, and a
  // latch left set would keep the boundary from ever firing again.
  readonly clearEnded: () => void;
  // Releases the latch and invalidates a pending loop resume without moving
  // the playhead; the error path uses it.
  readonly clearEndedAndPendingResume: () => void;
  // Forgets the attachment's positioning and latch, and invalidates a pending
  // resume; the teardown path uses it.
  readonly reset: () => void;
};

export const createYouTubeBoundary = (
  options: YouTubeBoundaryOptions,
  { emit, isDestroyed, getPlayer, timeUpdates }: YouTubeBoundaryDeps
): YouTubeBoundary => {
  const bounds = resolveTimeBoundary(options);
  const loop = options.loop === true;
  let positioned = false;
  let boundaryEnded = false;
  let resumeGeneration = 0;

  // The player's duration, or undefined before it knows one. `getDuration()`
  // reports 0 until metadata lands, which is not a duration to clamp against.
  const durationOf = (
    current: YouTubeBoundaryPlayer | undefined
  ): number | undefined => {
    if (!current) return undefined;
    try {
      const duration = current.getDuration();
      return Number.isFinite(duration) && duration > 0 ? duration : undefined;
    } catch {
      return undefined;
    }
  };

  const startOf = (current: YouTubeBoundaryPlayer | undefined): number =>
    boundaryStart(bounds, durationOf(current));

  // Seeks and reports the intended position: a read-back would still return
  // the pre-seek time, and the poll does not run while the player is paused.
  const moveTo = (
    current: YouTubeBoundaryPlayer,
    time: number,
    patch: Parameters<EmitProviderState>[0]
  ): boolean => {
    try {
      current.seekTo(time, true);
    } catch {
      return false;
    }
    timeUpdates.setCurrentTime(time);
    emit(patch);
    return true;
  };

  // Both loop triggers land here: the end boundary, and the wrap guard for a
  // platform loop that restarted at zero instead of at the start boundary.
  const restartFromBoundary = (current: YouTubeBoundaryPlayer): void => {
    boundaryEnded = false;
    const restartTime = startOf(current);
    const generation = ++resumeGeneration;
    const moved = moveTo(current, restartTime, {
      currentTime: restartTime,
      buffering: false
    });
    if (!moved) return;
    // A restart from the player's own ended state needs playback started
    // again; one from mid-playback does not. Deferred so the seek is in flight
    // before the state is read, and dropped if the player went away meanwhile.
    void Promise.resolve().then(() => {
      if (isDestroyed() || generation !== resumeGeneration) return;
      const player = getPlayer();
      if (!player) return;
      try {
        if (player.getPlayerState() !== playerStates.PLAYING)
          player.playVideo();
      } catch {
        // A loop restart must not escape the provider boundary.
      }
    });
  };

  return {
    startPlayerVar:
      bounds.startTime > 0 ? Math.floor(bounds.startTime) : undefined,
    applyInitialPosition: (current) => {
      if (positioned) return undefined;
      positioned = true;
      const start = startOf(current);
      if (start <= 0) return undefined;
      try {
        current.seekTo(start, true);
      } catch {
        return undefined;
      }
      timeUpdates.setCurrentTime(start);
      return start;
    },
    onTimeReport: (time) => {
      const current = getPlayer();
      const duration = durationOf(current);
      if (atBoundaryEnd(bounds, duration, time)) {
        if (loop) {
          if (current) restartFromBoundary(current);
          return false;
        }
        if (boundaryEnded) return false;
        boundaryEnded = true;
        // Polling stops here; the PLAYING branch starts it again on a resume.
        timeUpdates.stop();
        const end = boundaryEnd(bounds, duration) ?? time;
        try {
          current?.pauseVideo();
        } catch {
          // The end is published whether or not the pause landed.
        }
        timeUpdates.setCurrentTime(end);
        emit(
          { playback: 'ended', buffering: false, currentTime: end },
          providerEvent('ended', undefined)
        );
        return false;
      }
      // The wrap guard, shared with the Vimeo and Wistia ports so the three
      // cannot drift apart on which start they compare against.
      if (
        current &&
        atBoundaryWrap(bounds, duration, time, { loop, positioned })
      ) {
        restartFromBoundary(current);
        return false;
      }
      boundaryEnded = false;
      return true;
    },
    isEnded: () => boundaryEnded,
    onProviderEnded: () => {
      const current = getPlayer();
      // Only a start boundary needs correcting: YouTube's own playlist loop
      // already restarts at zero, which is where an unset start boundary is.
      if (current && restartsAtBoundaryStart(bounds, loop)) {
        restartFromBoundary(current);
        return true;
      }
      // The media's own end latches the same flag this window's end does, so
      // the next `play()` replays from the start boundary rather than from
      // wherever YouTube left the playhead. Native does this
      // (`provider-native/src/playback.ts:149-159` then `:229-239`), and so do
      // the Vimeo and Wistia ports.
      boundaryEnded = true;
      return false;
    },
    applyPlayPosition: (current) => {
      // The media's own end is covered by the latch, set from the ENDED state
      // change; this second test is only for the window's end, which the poll
      // can miss when playback is paused across it.
      const end = boundaryEnd(bounds, durationOf(current));
      const atEnd =
        bounds.endTime !== undefined &&
        end !== undefined &&
        timeUpdates.getCurrentTime() >= end;
      if (!boundaryEnded && !atEnd) return;
      boundaryEnded = false;
      const start = startOf(current);
      moveTo(current, start, { currentTime: start });
    },
    seekTarget: (time) => {
      // The player's own duration, as Vimeo and Wistia pass theirs: the seek
      // ceiling is the effective end, the same value the end boundary fires
      // at, so a seek cannot land past the boundary this seam enforces. Before
      // metadata `getDuration()` answers 0, which `durationOf` reads as no
      // duration, so an early seek stays unbounded above as it always was.
      const duration = durationOf(getPlayer());
      const target = withinBoundary(bounds, duration, Math.max(0, time));
      const end = boundaryEnd(bounds, duration);
      if (end === undefined || target < end) boundaryEnded = false;
      return target;
    },
    clearEnded: () => {
      boundaryEnded = false;
    },
    clearEndedAndPendingResume: () => {
      ++resumeGeneration;
      boundaryEnded = false;
    },
    reset: () => {
      ++resumeGeneration;
      boundaryEnded = false;
      positioned = false;
    }
  };
};
