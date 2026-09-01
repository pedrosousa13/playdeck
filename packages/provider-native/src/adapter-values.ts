import type {
  Availability,
  CommandResult,
  PlayerError,
  PlayerEventDetailMap,
  PlayerEventType,
  ProviderEvent,
  ProviderEventFor,
  ProviderStatePatch,
  TimeRange
} from '@playdeck/core';

// Publishes a provider-state patch to every subscriber, optionally paired
// with the provider event that caused it. Every seam takes this as its sink.
export type EmitProviderState = (
  patch: ProviderStatePatch,
  event?: ProviderEvent
) => void;

export const providerEvent = <Type extends PlayerEventType>(
  type: Type,
  originalEvent: Event,
  detail: PlayerEventDetailMap[Type]
): ProviderEventFor<Type> => ({
  type,
  detail,
  origin: 'provider',
  originalEvent
});

export const available: Availability = { status: 'available' };
export const unsupported: Availability = {
  status: 'unavailable',
  reason: 'browser'
};
export const policyDisallowed: Availability = {
  status: 'unavailable',
  reason: 'policy'
};
export const notReady: Availability = {
  status: 'unknown',
  reason: 'not-ready'
};

// HTMLMediaElement.HAVE_METADATA, inlined because some DOM test environments
// omit the static readyState constants.
export const HAVE_METADATA = 1;

export const toRanges = (
  ranges: globalThis.TimeRanges
): ReadonlyArray<TimeRange> =>
  Array.from({ length: ranges.length }, (_, index) => ({
    start: ranges.start(index),
    end: ranges.end(index)
  })).sort((left, right) => left.start - right.start);

export const mediaError = (media: HTMLVideoElement): PlayerError => {
  const code = media.error?.code;
  const category =
    code === 2
      ? 'network'
      : code === 3
        ? 'decode'
        : code === 4
          ? 'source'
          : 'provider';
  return {
    category,
    fatal: true,
    recoverable: category === 'network',
    message:
      media.error?.message || 'The media element could not load the source.'
  };
};

export const errorString = (cause: unknown, property: 'message' | 'name') => {
  if (
    (typeof cause !== 'object' || cause === null) &&
    typeof cause !== 'function'
  ) {
    return undefined;
  }
  try {
    const value = Reflect.get(cause, property);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
};

export const policyBlocked = (
  message: string
): Exclude<CommandResult, { ok: true }> => ({
  ok: false,
  reason: 'blocked',
  error: {
    category: 'policy',
    fatal: false,
    recoverable: true,
    message
  }
});

export const commandError = (
  cause: unknown
): Exclude<CommandResult, { ok: true }> => {
  const blocked = errorString(cause, 'name') === 'NotAllowedError';
  return {
    ok: false,
    reason: blocked ? 'blocked' : 'provider-error',
    error: {
      category: blocked ? 'policy' : 'provider',
      fatal: false,
      recoverable: true,
      message: errorString(cause, 'message') || 'The native command failed.',
      cause
    }
  };
};

export const runCommand = async (
  command: () => void | Promise<unknown>
): Promise<CommandResult> => {
  try {
    await command();
    return { ok: true };
  } catch (cause) {
    return commandError(cause);
  }
};

// The configured `[startTime, endTime]` window intersected with the media's own
// length. An open end means the media has no finite length to bound against --
// a live source, or an element that has not published a duration yet.
type DeclaredWindow = {
  readonly start: number;
  readonly end: number | undefined;
};

const declaredWindow = (
  media: HTMLVideoElement,
  startTime: number,
  endTime: number | undefined
): DeclaredWindow => {
  const duration = Number.isFinite(media.duration) ? media.duration : undefined;
  const end =
    endTime === undefined
      ? duration
      : duration === undefined
        ? endTime
        : Math.min(endTime, duration);
  return {
    start: end === undefined ? startTime : Math.min(startTime, end),
    end
  };
};

const boundedInto = ({ end, start }: DeclaredWindow, time: number): number =>
  Math.max(start, end === undefined ? time : Math.min(time, end));

// The declared half of `withinMediaBounds`: the configured window and the
// media's own length, with `seekable` left out of it. Separated for #465,
// which found that the two halves answer different questions -- how long the
// media is, and whether the element will move the playhead there -- and that
// only the first is a bound. Always answers a position: there is no shape of
// duration or configured window that has nowhere legal in it.
export const withinDeclaredBounds = (
  media: HTMLVideoElement,
  time: number,
  startTime: number,
  endTime: number | undefined
): number => boundedInto(declaredWindow(media, startTime, endTime), time);

// Whether the element's own seekable ranges say a move to `time` will not
// happen. A window of zero span (`[[0, 0]]`) covers nothing above zero, and
// #465 measured that this is the element declining to seek rather than a window
// still filling in: a chromium element reporting it took `currentTime = 5` and
// stayed at 0 with the clip fully buffered behind it.
//
// An element with no ranges at all has said nothing, so this answers `false`
// there. HTML's seek algorithm abandons that seek, but abandoning it is
// harmless and observable, and the alternative is to refuse a move on the
// strength of an attribute that some engines populate late.
export const declinesSeekTo = (
  media: HTMLVideoElement,
  time: number
): boolean => {
  if (media.seekable.length === 0) return false;
  for (let index = 0; index < media.seekable.length; index += 1)
    if (
      time >= media.seekable.start(index) &&
      time <= media.seekable.end(index)
    )
      return false;
  return true;
};

export const withinMediaBounds = (
  media: HTMLVideoElement,
  time: number,
  startTime: number,
  endTime: number | undefined
): number | undefined => {
  const declared = declaredWindow(media, startTime, endTime);
  const bounded = boundedInto(declared, time);
  if (media.seekable.length === 0) return bounded;
  const intersections = Array.from(
    { length: media.seekable.length },
    (_, index) => ({
      start: Math.max(media.seekable.start(index), declared.start),
      end: Math.min(
        media.seekable.end(index),
        declared.end ?? Number.POSITIVE_INFINITY
      )
    })
  ).filter(({ end, start }) => start <= end);
  if (intersections.length === 0) return undefined;
  for (const { end, start } of intersections) {
    if (bounded >= start && bounded <= end) return bounded;
  }
  return intersections
    .flatMap(({ end, start }) => [start, end])
    .reduce((closest, point) =>
      Math.abs(point - bounded) < Math.abs(closest - bounded) ? point : closest
    );
};
