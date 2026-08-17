import type {
  Availability,
  PlayerCapabilities,
  PlayerError,
  ProviderAdapter,
  TimeRange
} from './types.js';

export const freezeAvailability = (availability: Availability): Availability =>
  Object.freeze({ ...availability });

export const freezeCapabilities = (
  capabilities: PlayerCapabilities
): PlayerCapabilities =>
  Object.freeze({
    seek: freezeAvailability(capabilities.seek),
    setVolume: freezeAvailability(capabilities.setVolume),
    setPlaybackRate: freezeAvailability(capabilities.setPlaybackRate),
    selectQuality: freezeAvailability(capabilities.selectQuality),
    selectTextTrack: freezeAvailability(capabilities.selectTextTrack),
    chapters: freezeAvailability(capabilities.chapters),
    fullscreen: freezeAvailability(capabilities.fullscreen),
    pictureInPicture: freezeAvailability(capabilities.pictureInPicture),
    airPlay: freezeAvailability(capabilities.airPlay),
    customControls: freezeAvailability(capabilities.customControls)
  });

export const freezeError = (error: PlayerError): PlayerError =>
  Object.freeze({ ...error });

export const orderedRanges = (
  ranges: ReadonlyArray<TimeRange>
): ReadonlyArray<TimeRange> =>
  Object.freeze(
    ranges
      .map(({ end, start }) => Object.freeze({ end, start }))
      .sort((left, right) => left.start - right.start)
  );

export const toProviderError = (cause: unknown): PlayerError =>
  freezeError({
    category: 'provider',
    fatal: false,
    recoverable: true,
    message:
      cause instanceof Error ? cause.message : 'The provider command failed.',
    cause
  });

export const autoplayConfigurationError = (): PlayerError =>
  freezeError({
    category: 'configuration',
    fatal: false,
    recoverable: false,
    message: 'Muted autoplay conflicts with a controlled unmuted state.'
  });

export const destroyProviderSafely = (provider: ProviderAdapter): void => {
  try {
    void Promise.resolve(provider.destroy()).catch(() => undefined);
  } catch {
    // Provider cleanup must not escape the controller boundary.
  }
};

export const unsubscribeSafely = (
  unsubscribe: (() => void) | undefined
): void => {
  try {
    unsubscribe?.();
  } catch {
    // Provider cleanup must not escape the controller boundary.
  }
};

// One subscriber must not be able to abandon an emit. `Set.forEach` stops at
// the first throw, so every listener registered AFTER the thrower silently
// missed that notification and resynced only on the next unrelated one — a
// control that subscribed late rendered exactly one transition stale (#95).
//
// Isolated but not silenced: the error is rethrown on a fresh task, so it
// still reaches the page's uncaught-error handling the way a listener throwing
// at top level would. Swallowing it outright is what would have hidden the
// media-session defect that found this bug in the first place.
// Variadic rather than single-value: a provider's state listener takes
// `(patch, event?)`, and wrapping every one of those fan-outs in a thunk would
// allocate a closure per listener per emit to say the same thing.
export const notifySafely = <Args extends readonly unknown[]>(
  listener: (...args: Args) => void,
  ...args: Args
): void => {
  try {
    listener(...args);
  } catch (cause) {
    queueMicrotask(() => {
      throw cause;
    });
  }
};
