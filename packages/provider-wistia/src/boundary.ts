import {
  atBoundaryEnd,
  atBoundaryWrap,
  boundaryEnd,
  boundaryStart,
  resolveTimeBoundary,
  restartsAtBoundaryStart,
  withinBoundary,
  type TimeBoundary
} from '@reely/core';

// The `[startTime, endTime]` window seam. Aurora expresses a start as the
// `current-time` attribute and nothing at all as an end, so the end boundary is
// adapter-enforced: this seam decides what each time report means and the
// playback seam performs the seek, pause and publication it asks for. The
// sanitisation itself is `@reely/core`'s, shared with the YouTube and Vimeo
// ports so that one prop cannot mean three things.
//
// The state is two flags. `ended` is what the boundary pause has to be told
// apart by — the pause the adapter itself issued at the end boundary must not
// be republished as a plain `paused`. `positioned` gates the loop wrap guard,
// which reads a playhead below the start boundary as a restart to correct: a
// player that has not been positioned yet is simply loading, and correcting
// that would fight the initial seek.
//
// One difference from the YouTube and Vimeo ports is deliberate: there is no
// restart token here. `api.time()` is synchronous, so a restart leaves nothing
// deferred for a superseded player to run, and the attachment's own generation
// (`attachment.ts:195`) already makes a replaced player's events inert.
//
// A *natural* `ended` — the media's own end, not this window's — latches
// `ended` just as a boundary end does. Native does the same
// (`provider-native/src/playback.ts:149-159`), and it is what makes `play()`
// after it replay from the start boundary rather than resume at the media's
// end (`:229-239`). The YouTube and Vimeo ports latch it there too, so one
// `startTime` prop means one thing on all four.

// What one time report means once the window is applied.
export type WistiaBoundaryVerdict =
  // The window wrapped: seek to `time` and publish it, rather than the report.
  | { readonly kind: 'restart'; readonly time: number }
  // The end boundary was reached for the first time: `time` is the boundary.
  | { readonly kind: 'end'; readonly time: number }
  // A further report from beyond an end already published. Say nothing.
  | { readonly kind: 'suppress' }
  // An ordinary in-window report.
  | { readonly kind: 'report'; readonly time: number };

export type WistiaBoundaryOptions = {
  readonly startTime?: number;
  readonly endTime?: number;
  readonly loop?: boolean;
};

export type WistiaBoundary = {
  // Where playback starts and where a restart returns to, once the duration is
  // known. `null` duration means "not known yet", which is what the element's
  // load hint is written against.
  readonly startAt: (duration: number | null) => number;
  readonly isAtEnd: (duration: number | null, time: number) => boolean;
  // Clamps a requested seek into the window, replacing the adapter's own
  // 0-to-duration clamp.
  readonly clamp: (duration: number | null, time: number) => number;
  // True between an end — this window's, or the media's own — and the next
  // play, restart, or seek back inside the window.
  readonly hasEnded: () => boolean;
  readonly clearEnded: () => void;
  // Called once per attached player, at the point the duration is first known.
  // Answers the initial seek target, or `undefined` when there is no start to
  // seek to. Resets the state, which is what makes a retried player start from
  // the window rather than from the replaced player's position.
  readonly adopt: (duration: number | null) => number | undefined;
  readonly reviewTime: (
    duration: number | null,
    time: number
  ) => WistiaBoundaryVerdict;
  // What the player's own `ended` means. Answers the position to correct to,
  // or `undefined` to publish the end as before — in which case it latches
  // `hasEnded`, so the next `play()` replays the window. Whether there is
  // anything to correct is `@reely/core`'s shared gate, where the reasoning
  // and the declared divergence from native both live.
  readonly reviewEnded: (duration: number | null) => number | undefined;
  // Where `play()` has to seek before resuming, or `undefined` to just resume.
  readonly resumeFrom: (
    duration: number | null,
    time: number
  ) => number | undefined;
};

export const createWistiaBoundary = (
  options: WistiaBoundaryOptions = {}
): WistiaBoundary => {
  const bounds: TimeBoundary = resolveTimeBoundary(options);
  const loop = options.loop === true;
  let ended = false;
  let positioned = false;

  const startAt = (duration: number | null): number =>
    boundaryStart(bounds, duration);

  const isAtEnd = (duration: number | null, time: number): boolean =>
    atBoundaryEnd(bounds, duration, time);

  return {
    startAt,
    isAtEnd,
    clamp: (duration, time) => withinBoundary(bounds, duration, time),
    hasEnded: () => ended,
    clearEnded: () => {
      ended = false;
    },
    adopt: (duration) => {
      ended = false;
      positioned = true;
      const start = startAt(duration);
      return start > 0 ? start : undefined;
    },
    reviewTime: (duration, time) => {
      if (isAtEnd(duration, time)) {
        if (loop) return { kind: 'restart', time: startAt(duration) };
        if (ended) return { kind: 'suppress' };
        ended = true;
        // `isAtEnd` is only ever true with an effective end, so the fallback
        // does not run; it is what keeps the verdict's time a plain number.
        return { kind: 'end', time: boundaryEnd(bounds, duration) ?? time };
      }
      // The wrap guard, shared with the YouTube and Vimeo ports so the three
      // cannot drift apart on which start they compare against.
      if (atBoundaryWrap(bounds, duration, time, { loop, positioned })) {
        return { kind: 'restart', time: startAt(duration) };
      }
      ended = false;
      return { kind: 'report', time };
    },
    reviewEnded: (duration) => {
      if (restartsAtBoundaryStart(bounds, loop)) return startAt(duration);
      ended = true;
      return undefined;
    },
    resumeFrom: (duration, time) =>
      ended || isAtEnd(duration, time) ? startAt(duration) : undefined
  };
};
