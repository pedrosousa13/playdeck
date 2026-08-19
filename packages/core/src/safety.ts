import type {
  Availability,
  PlayerCapabilities,
  PlayerError,
  ProviderAdapter,
  RefusedUrlSurface,
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

// One notice per refused surface, written here rather than at the five call
// sites so no caller can compose one of its own. Each names the prop and says
// what was done instead, the shape of the one notice #318 wrote both halves for
// ("The host option was rejected, so the default host was used."); the two
// Wistia notices of that change name the option and the expectation it failed
// and stop there, saying nothing about the fall-back they degraded to. None of
// these can carry the refused value: the only input is the key (#330).
//
// Non-fatal and `recoverable: false`, exactly like the provider-side notices:
// nothing stopped working, and the remedy is a change the consumer makes, so a
// retry would refuse the same value again (#198).
//
// Built once and shared rather than per call. A `PlayerError` is frozen and
// these five carry nothing controller-specific, so one value per surface is
// enough — and it lets `reportRefusedUrl` decide by identity whether the
// published notice actually changed, instead of comparing message text.
//
// The array below is the tie-break: the state has one error slot, so several
// surfaces refused at once publish the first of these that stands. Declaration
// order, NOT the order the reports arrived in — the reports come from React
// effects whose order depends on where a consumer placed `PosterImage` and on
// whether the pass is a mount or an update, and a notice that changed wording
// for that reason would be unreadable to a monitoring system. `Record` typing
// forces every surface to have a notice; that every surface also has a rank is
// pinned by `names the refused surface in the notice and never the refused
// value`, which walks all five and would see an empty message for a missing one.
const REFUSED_URL_NOTICES: Record<RefusedUrlSurface, PlayerError> = {
  'poster src': freezeError({
    category: 'configuration',
    fatal: false,
    recoverable: false,
    message:
      'The poster src URL was rejected, so no poster image was requested.'
  }),
  'poster srcSet': freezeError({
    category: 'configuration',
    fatal: false,
    recoverable: false,
    message:
      'A poster srcSet candidate URL was rejected, so that candidate was dropped.'
  }),
  nativePoster: freezeError({
    category: 'configuration',
    fatal: false,
    recoverable: false,
    message:
      'The nativePoster URL was rejected, so no poster attribute was set.'
  }),
  'textTracks src': freezeError({
    category: 'configuration',
    fatal: false,
    recoverable: false,
    message:
      'A textTracks src URL was rejected, so that text track was dropped.'
  }),
  'mediaSession artwork': freezeError({
    category: 'configuration',
    fatal: false,
    recoverable: false,
    message:
      'A mediaSession artwork src URL was rejected, so that artwork entry was dropped.'
  })
};

const REFUSED_URL_SURFACE_RANK = [
  'poster src',
  'poster srcSet',
  'nativePoster',
  'textTracks src',
  'mediaSession artwork'
] as const satisfies readonly RefusedUrlSurface[];

// The notice the standing refusal registrations publish, or `undefined` when
// none stands. Returning `undefined` rather than a notice for an empty tally is
// the whole point of #330's second pass: the notice says a refusal stands right
// now, not that one once happened. Only membership is read — how many reporters
// stand behind a surface is `PlayerController`'s bookkeeping, not this
// function's business (#330).
export const standingRefusedUrlNotice = (
  refused: ReadonlyMap<RefusedUrlSurface, unknown>
): PlayerError | undefined => {
  const surface = REFUSED_URL_SURFACE_RANK.find((candidate) =>
    refused.has(candidate)
  );
  return surface === undefined ? undefined : REFUSED_URL_NOTICES[surface];
};

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
