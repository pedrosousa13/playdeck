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
  //
  // Answers `NaN` for a `NaN` time, deliberately, and this is the one place it
  // and `correction` diverge. This answers for a position Playdeck was *asked*
  // to go to: all three ports reject a non-finite command with `provider-error`
  // before they reach here, and having no `undefined` in its answer this could
  // only substitute some in-window position for the nonsense one — turning a
  // command that should be refused into a seek that quietly moves the playhead
  // somewhere nobody named. `NaN` in, `NaN` out keeps it refusable. Why
  // `correction` answers the same input the other way is argued where it is
  // implemented.
  readonly clamp: (duration: number | null | undefined, time: number) => number;
  // Where a *reported* position has to be moved to for the window to hold, or
  // undefined when it needs no move. `clamp` answers for a position Playdeck
  // was asked to go to; this answers for one that simply arrived — an SDK-side
  // seek, a repeat `ready`, a viewer dragging the platform's own scrub bar —
  // and it is what makes `startTime` a floor rather than a position applied
  // once at adopt (#381).
  //
  // A behaviour change for shipped consumers, decided deliberately: a viewer
  // who seeks below the start is pulled back, because `startTime` is the window
  // playback is confined to and `seekTo`/`seekBy` are already clamped into it.
  //
  // The two agree by construction rather than by coincidence: every answer here
  // is the `clamp` of the same time, so a command the clamp already pulled into
  // the window reports a position this leaves alone instead of correcting it a
  // second time. Above the window it answers only where `atEnd` does — with no
  // `endTime`, the natural end of the media stays the platform's own event and
  // is nothing for the window to seek back from.
  //
  // Every answer is a fixed point, so one out-of-window position costs at most
  // one corrective seek however many reports of it arrive. Why that holds — and
  // which single input it does not hold for — is argued where this is
  // implemented, beside the arithmetic it is a property of.
  //
  // It takes the same `state` `atWrap` does, and for the same reason it is not
  // a caller's business: the two answer overlapping positions, and the wrap
  // guard owns the overlap. A playhead behind the start of a looping player is
  // a wrap — the loop rule restarts it and starts playback again — so this
  // answers undefined there and leaves it to `atWrap`, whether the port asked
  // `atWrap` first or not. Reading the loop from a parameter rather than from
  // the call site is what makes that true on the seek paths as well as the
  // time-report ones. `positioned` is likewise the guard's: the reports a load
  // emits before the initial seek are a player still loading, and correcting
  // them would fight the port's own positioning seek.
  readonly correction: (
    duration: number | null | undefined,
    time: number,
    state: { readonly loop: boolean; readonly positioned: boolean }
  ) => number | undefined;
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

  const atWrap = (
    duration: number | null | undefined,
    time: number,
    state: { readonly loop: boolean; readonly positioned: boolean }
  ): boolean => {
    if (!state.loop || !state.positioned) return false;
    const effectiveStart = start(duration);
    return effectiveStart > 0 && time < effectiveStart;
  };

  return {
    startTime,
    endTime,
    end,
    start,
    atEnd,
    atWrap,
    restartsAtStart: (loop) => loop && startTime > 0,
    clamp: (duration, time) => {
      const effectiveEnd = end(duration);
      return Math.max(
        start(duration),
        effectiveEnd === undefined ? time : Math.min(time, effectiveEnd)
      );
    },
    correction: (duration, time, state) => {
      // Nothing to hold a player to before the port has positioned it: the
      // reports a load emits before the initial seek are a player still
      // loading, and correcting them would fight that seek. All three ports
      // gated their own call on this before it moved in here, where a new call
      // site cannot forget it.
      if (!state.positioned) return undefined;
      // The wrap guard owns a playhead behind the start of a looping player,
      // and owns it on every path rather than on the paths that happen to ask
      // it first. `atWrap` restarts and resumes such a position; this would
      // only slide it onto the floor, and a playhead sitting *on* the start is
      // one `atWrap` no longer recognises — so correcting here would consume
      // the wrap and silently retire the restart. Deferring is what keeps a
      // looping embed behaving exactly as it did before this predicate existed.
      if (atWrap(duration, time, state)) return undefined;
      // The one reported position with no answer. `NaN` is unordered, so every
      // comparison below is false for it: `atEnd` reads it as inside the
      // window, `Math.max` propagates it, and `target === time` is false even
      // when the target *is* the time. The answer would be a seek to `NaN`,
      // whose report is another `NaN` — the feedback loop, arriving through the
      // one input the arithmetic cannot place. Undefined instead: the port
      // publishes the report and moves nothing, which is what it did before
      // #381. The infinities are ordered and need no exception here; each of
      // them already answers a finite target, or nothing.
      if (Number.isNaN(time)) return undefined;
      // `atEnd` is only ever true with an effective end, so the fallback does
      // not run; it is what keeps the target a plain number. Below the window
      // the target is the start, above it the end, and a time already inside
      // the window is its own target — which is how a position needing nothing
      // answers undefined, and why every answer is a fixed point: each one is
      // itself a position inside the window, so the report the corrective seek
      // produces asks for no correction of its own.
      const target = atEnd(duration, time)
        ? (end(duration) ?? time)
        : Math.max(start(duration), time);
      return target === time ? undefined : target;
    }
  };
};
