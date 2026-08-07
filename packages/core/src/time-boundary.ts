// The `[startTime, endTime]` window, resolved once from raw options and then
// consulted by the embed providers (YouTube, Vimeo, Wistia) on every time
// report, seek and initial positioning. Those platforms have no trustworthy
// native end mechanism, so each one emulates the boundary from its adapter —
// and they must all emulate it the *same* way.
//
// This mirrors the contract the native provider already implements inline at
// `provider-native/src/playback.ts:61-73` (sanitisation) and `:75-89`
// (effective end). Native keeps its own copy: its boundary state machine is
// entangled with `HTMLVideoElement.seekable` and is out of scope here. The
// duplication is deliberate, and the two sanitisation tables must stay
// identical — change one, change the other.

// The resolved window, and every question the ports ask of it. One object
// rather than a family of free functions: the ports only ever consult a window
// they have already resolved, so the boundary travels with its own behaviour.
export type TimeBoundary = {
  // The sanitised values themselves, for the load hints the embeds write into
  // their own urls and attributes.
  readonly startTime: number;
  readonly endTime: number | undefined;
  // Where the window actually ends, once the duration is known. With no
  // `endTime` this is the duration itself, so a clamp still keeps a seek inside
  // the media; with one, the duration caps it.
  readonly end: (duration: number | null | undefined) => number | undefined;
  // Where playback starts, and where a loop restart returns to. A start past
  // the effective end collapses onto it rather than seeking out of the media.
  readonly start: (duration: number | null | undefined) => number;
  // False whenever no `endTime` was configured: reaching the natural end of the
  // media stays the platform's own event to report, not something the adapter
  // synthesises.
  readonly atEnd: (
    duration: number | null | undefined,
    time: number
  ) => boolean;
  // The loop wrap guard. Every embed keeps its own platform loop switched on
  // (`loop=1`, `end-video-behavior="loop"`, the single-entry playlist), and
  // every one of them wraps to zero rather than to the start boundary — a
  // restart no time report can be told apart from a seek. So a playhead behind
  // the start of a looping, already-positioned player is read as that wrap and
  // corrected.
  //
  // `positioned` is what keeps the reports a load emits before the initial seek
  // from each looking like a wrap. The comparison is against the *duration-
  // clamped* start: a raw start past the duration would make the position the
  // restart itself seeks to look like yet another wrap, and the player would
  // restart on every report for as long as it played.
  readonly atWrap: (
    duration: number | null | undefined,
    time: number,
    state: { readonly loop: boolean; readonly positioned: boolean }
  ) => boolean;
  // The other half of the loop story: what a platform's *own* end-of-media
  // event means. Every embed keeps its own loop mechanism switched on and every
  // one of them restarts at zero, so only a window that begins somewhere else
  // has anything to correct — with no `startTime`, the platform already
  // restarts where the window begins. Written out once here because the three
  // ports have to answer it identically; it was triplicated before, and
  // drifted.
  //
  // DECLARED DIVERGENCE FROM NATIVE, left as it was by #214. Native gates its
  // `ended` handler on `loop` alone (`provider-native/src/playback.ts:149-153`)
  // and never sets `media.loop`, so a looping native video with no `startTime`
  // publishes *no* `ended` — it silently restarts. All three embeds do publish
  // `ended` on every loop iteration in that configuration, because this
  // predicate is false there and the platform's own end passes straight
  // through. That is pre-existing embed behaviour: #214 fanned `startTime` and
  // `endTime` out to the embeds and deliberately did not revise how `loop` fans
  // out, and suppressing `ended` would change what shipped `loop` users already
  // receive. `startTime` is the only thing that makes an embed port intervene
  // at all.
  readonly restartsAtStart: (loop: boolean) => boolean;
  // Clamps a requested time into the window. Providers use it for `seekTo` and
  // `seekBy`; passing `undefined` as the duration leaves the seek unbounded
  // above when no `endTime` is set.
  readonly clamp: (duration: number | null | undefined, time: number) => number;
};

const finiteOrUndefined = (
  value: number | null | undefined
): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

// A start is honoured only when it is finite and positive; an end only when it
// is finite and above the *sanitised* start. Anything else is dropped rather
// than reported, matching native: a nonsense window plays the whole video.
export const createTimeBoundary = (options: {
  readonly startTime?: number;
  readonly endTime?: number;
}): TimeBoundary => {
  const startTime =
    Number.isFinite(options.startTime) && (options.startTime ?? 0) > 0
      ? (options.startTime ?? 0)
      : 0;
  const endTime =
    Number.isFinite(options.endTime) && (options.endTime ?? 0) > startTime
      ? options.endTime
      : undefined;

  const end = (duration: number | null | undefined): number | undefined => {
    const finiteDuration = finiteOrUndefined(duration);
    if (endTime === undefined) return finiteDuration;
    return finiteDuration === undefined
      ? endTime
      : Math.min(endTime, finiteDuration);
  };

  const start = (duration: number | null | undefined): number => {
    const effectiveEnd = end(duration);
    return effectiveEnd === undefined
      ? startTime
      : Math.min(startTime, effectiveEnd);
  };

  const atEnd = (
    duration: number | null | undefined,
    time: number
  ): boolean => {
    if (endTime === undefined) return false;
    const effectiveEnd = end(duration);
    return effectiveEnd !== undefined && time >= effectiveEnd;
  };

  return {
    startTime,
    endTime,
    end,
    start,
    atEnd,
    atWrap: (duration, time, state) => {
      if (!state.loop || !state.positioned) return false;
      const effectiveStart = start(duration);
      return effectiveStart > 0 && time < effectiveStart;
    },
    restartsAtStart: (loop) => loop && startTime > 0,
    clamp: (duration, time) => {
      const effectiveEnd = end(duration);
      return Math.max(
        start(duration),
        effectiveEnd === undefined ? time : Math.min(time, effectiveEnd)
      );
    }
  };
};
