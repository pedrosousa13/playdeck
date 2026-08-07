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

export type TimeBoundary = {
  readonly startTime: number;
  readonly endTime: number | undefined;
};

const finiteOrUndefined = (
  value: number | null | undefined
): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

// A start is honoured only when it is finite and positive; an end only when it
// is finite and above the *sanitised* start. Anything else is dropped rather
// than reported, matching native: a nonsense window plays the whole video.
export const resolveTimeBoundary = (options: {
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
  return { startTime, endTime };
};

// Where the window actually ends, once the duration is known. With no
// `endTime` this is the duration itself, so a clamp still keeps a seek inside
// the media; with one, the duration caps it.
export const boundaryEnd = (
  boundary: TimeBoundary,
  duration: number | null | undefined
): number | undefined => {
  const finiteDuration = finiteOrUndefined(duration);
  if (boundary.endTime === undefined) return finiteDuration;
  return finiteDuration === undefined
    ? boundary.endTime
    : Math.min(boundary.endTime, finiteDuration);
};

// Where playback starts, and where a loop restart returns to. A start past the
// effective end collapses onto it rather than seeking out of the media.
export const boundaryStart = (
  boundary: TimeBoundary,
  duration: number | null | undefined
): number => {
  const end = boundaryEnd(boundary, duration);
  return end === undefined
    ? boundary.startTime
    : Math.min(boundary.startTime, end);
};

// False whenever no `endTime` was configured: reaching the natural end of the
// media stays the platform's own event to report, not something the adapter
// synthesises.
export const atBoundaryEnd = (
  boundary: TimeBoundary,
  duration: number | null | undefined,
  time: number
): boolean => {
  if (boundary.endTime === undefined) return false;
  const end = boundaryEnd(boundary, duration);
  return end !== undefined && time >= end;
};

// The loop wrap guard. Every embed keeps its own platform loop switched on
// (`loop=1`, `end-video-behavior="loop"`, the single-entry playlist), and every
// one of them wraps to zero rather than to the start boundary — a restart no
// time report can be told apart from a seek. So a playhead behind the start of
// a looping, already-positioned player is read as that wrap and corrected.
//
// `positioned` is what keeps the reports a load emits before the initial seek
// from each looking like a wrap. The comparison is against the *duration-
// clamped* start: a raw start past the duration would make the position the
// restart itself seeks to look like yet another wrap, and the player would
// restart on every report for as long as it played.
export const atBoundaryWrap = (
  boundary: TimeBoundary,
  duration: number | null | undefined,
  time: number,
  state: { readonly loop: boolean; readonly positioned: boolean }
): boolean => {
  if (!state.loop || !state.positioned) return false;
  const start = boundaryStart(boundary, duration);
  return start > 0 && time < start;
};

// Clamps a requested time into the window. Providers use it for `seekTo` and
// `seekBy`; passing `undefined` as the duration leaves the seek unbounded
// above when no `endTime` is set.
export const withinBoundary = (
  boundary: TimeBoundary,
  duration: number | null | undefined,
  time: number
): number => {
  const end = boundaryEnd(boundary, duration);
  return Math.max(
    boundaryStart(boundary, duration),
    end === undefined ? time : Math.min(time, end)
  );
};
