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
} from '@reely/core';

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

export const withinMediaBounds = (
  media: HTMLVideoElement,
  time: number,
  startTime: number,
  endTime: number | undefined
): number | undefined => {
  const duration = Number.isFinite(media.duration) ? media.duration : undefined;
  const effectiveEnd =
    endTime === undefined
      ? duration
      : duration === undefined
        ? endTime
        : Math.min(endTime, duration);
  const effectiveStart =
    effectiveEnd === undefined ? startTime : Math.min(startTime, effectiveEnd);
  const bounded = Math.max(
    effectiveStart,
    effectiveEnd === undefined ? time : Math.min(time, effectiveEnd)
  );
  if (media.seekable.length === 0) return bounded;
  const intersections = Array.from(
    { length: media.seekable.length },
    (_, index) => ({
      start: Math.max(media.seekable.start(index), effectiveStart),
      end: Math.min(
        media.seekable.end(index),
        effectiveEnd ?? Number.POSITIVE_INFINITY
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
