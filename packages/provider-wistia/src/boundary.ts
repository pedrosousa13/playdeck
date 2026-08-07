import {
  atBoundaryEnd,
  atBoundaryWrap,
  boundaryEnd,
  boundaryStart,
  resolveTimeBoundary,
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
// Two differences from the YouTube and Vimeo ports are deliberate. There is no
// restart token here: `api.time()` is synchronous, so a restart leaves nothing
// deferred for a superseded player to run, and the attachment's own generation
// (`attachment.ts:195`) already makes a replaced player's events inert. And a
// *natural* `ended` — the media's own end, not this window's — leaves `ended`
// clear, because the pause Wistia fires with it is the platform's to report.

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
  // True between an end this seam published and the next play, restart, or
  // seek back inside the window.
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
  // or `undefined` to publish the end as before. Only a looping player with a
  // start boundary has anything to correct: Wistia's `end-video-behavior`
  // restarts it at zero.
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
    reviewEnded: (duration) =>
      loop && bounds.startTime > 0 ? startAt(duration) : undefined,
    resumeFrom: (duration, time) =>
      ended || isAtEnd(duration, time) ? startAt(duration) : undefined
  };
};
