import type {
  Availability,
  PlayerCapabilities,
  PlayerError,
  PlayerErrorSeverity,
  PlayerState,
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
// surfaces refused at once publish the first of these that stands. That array's
// own order, NOT the order the reports arrived in — the reports come from React
// effects whose order depends on where a consumer placed `PosterImage` and on
// whether the pass is a mount or an update, and a notice that changed wording
// for that reason would be unreadable to a monitoring system.
//
// All five are `'protective'`, without exception and whatever the surface
// decorates: what each of them reports is the shared allowlist blocking an
// untrusted URL, which is a security control firing and not a presentation
// option being ignored. So none of them can be pushed out of the slot by a
// provider reporting a cosmetic rejection (#368).
const REFUSED_URL_NOTICES: Record<RefusedUrlSurface, PlayerError> = {
  'poster src': freezeError({
    category: 'configuration',
    fatal: false,
    recoverable: false,
    severity: 'protective',
    message:
      'The poster src URL was rejected, so no poster image was requested.'
  }),
  'poster srcSet': freezeError({
    category: 'configuration',
    fatal: false,
    recoverable: false,
    severity: 'protective',
    message:
      'A poster srcSet candidate URL was rejected, so that candidate was dropped.'
  }),
  nativePoster: freezeError({
    category: 'configuration',
    fatal: false,
    recoverable: false,
    severity: 'protective',
    message:
      'The nativePoster URL was rejected, so no poster attribute was set.'
  }),
  'textTracks src': freezeError({
    category: 'configuration',
    fatal: false,
    recoverable: false,
    severity: 'protective',
    message:
      'A textTracks src URL was rejected, so that text track was dropped.'
  }),
  'mediaSession artwork': freezeError({
    category: 'configuration',
    fatal: false,
    recoverable: false,
    severity: 'protective',
    message:
      'A mediaSession artwork src URL was rejected, so that artwork entry was dropped.'
  })
};

// A list of its own, in no way derived from `RefusedUrlSurface` — the union's
// own declaration order decides nothing, and a reader who assumes it does will
// be wrong the first time either is reordered. So the two are coupled here
// instead: `RankOf` admits only a list that is the whole union, each surface
// exactly once, which makes a surface added to `RefusedUrlSurface` fail to
// compile until it is ranked, the way `Record` above makes it fail until it has
// a message. A surface missing from the rank would publish no notice at all,
// which is the silence #330 exists to end.
type RankOf<Surfaces, Each = Surfaces> = [Surfaces] extends [never]
  ? readonly []
  : Each extends Each
    ? readonly [Each, ...RankOf<Exclude<Surfaces, Each>>]
    : never;

const REFUSED_URL_SURFACE_RANK = [
  'poster src',
  'poster srcSet',
  'nativePoster',
  'textTracks src',
  'mediaSession artwork'
] as const satisfies RankOf<RefusedUrlSurface>;

// The notice the standing refusal registrations publish, or `undefined` when
// none stands. An empty tally returns `undefined` rather than a notice because
// a notice says a refusal stands right now, not that one once happened: keyed
// to the latter, a consumer who cleaned the poisoned field would keep the error
// for the controller's life. Only membership is read — how many reporters
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

// Whether an error is a Notice, per CONTEXT.md: a non-fatal `configuration`
// error reporting a value that was rejected, while the fall-back it degraded to
// stands unchanged. Nothing stopped working, which is what separates it from a
// failure — it must not drive the lifecycle, and a consumer must not render it
// as one (#235, #319).
//
// The lifecycle clause is the one that is easy to drop and must not be. A
// `configuration` error is NOT always a notice: `useActivation` publishes one
// with `activation: 'error'` for `loading="interaction"` with autoplay and for
// viewport activation without a `Player.Viewport`, and both mean the player will
// never load, so both have to keep the overlay.
//
// Lives here, and is exported, because the rule now has three readers and two
// packages: `noticeIn` classifies a `ProviderStatePatch` on its way in,
// `#applyPatch` classifies the error already standing in the slot, and
// `ErrorDisplay` classifies the published `PlayerState.error` on its way out.
// Those are one rule seen from three sides, and the third copy is what
// `loading-error.tsx` said would be the one too many (#368).
//
// Takes the lifecycle beside the error rather than reading it off a state,
// because two of the three callers hold a patch whose `lifecycle` key may be
// absent — an absent one says nothing about the error and leaves the clause
// unmet, exactly as a non-error lifecycle does.
export const isNotice = (
  error: PlayerError,
  lifecycle: PlayerState['lifecycle'] | undefined
): boolean =>
  error.category === 'configuration' && !error.fatal && lifecycle !== 'error';

// Ranked highest first, like `REFUSED_URL_SURFACE_RANK` above and coupled to its
// union by the same `RankOf`, so a level added to `PlayerErrorSeverity` fails to
// compile until it has been placed against the others. Highest first because a
// notice's rank IS its index in this array: a lower index is a higher severity,
// which is what makes the comparison in `mostImportantNotice` a `<`, and it puts
// the level an operator most needs to hear at the top of the list. Reordering
// these two entries reverses which notice the slot keeps, and nothing else has
// to change for it to (#368).
const NOTICE_SEVERITY_RANK = [
  'protective',
  'presentational'
] as const satisfies RankOf<PlayerErrorSeverity>;

// The rank a notice carries, where a severity this array does not name is the
// lowest level. One rule covering two cases rather than two special cases: an
// absent severity, which `PlayerError.severity` documents, and an unrecognised
// one, which arrives the same way — a provider outside this repo emits notices
// through the same patch and nothing type-checks its JS — so both are settled by
// the single question of whether the value is one of the levels at all.
//
// `indexOf` on its own would not settle the second. It answers `-1`, and `-1`
// ranks ABOVE `'protective'`, so a notice declaring a level this repo never
// defined would take the slot from a refusal that blocked an untrusted URL —
// the masking #368 exists to remove, back through the one input nobody in this
// repo writes (#368).
const severityRank = (notice: PlayerError): number => {
  const rank = NOTICE_SEVERITY_RANK.findIndex(
    (level) => level === notice.severity
  );
  return rank === -1 ? NOTICE_SEVERITY_RANK.length - 1 : rank;
};

// Which of the notices offered here the single error slot should carry: the
// highest-severity one, and where several tie, the FIRST one offered. Both
// halves are load-bearing.
//
// Severity first, because the slot holds one notice and the losers are never
// published anywhere — a refusal that protects a viewer's privacy or blocks an
// untrusted URL has to outrank one reporting that a presentational option was
// ignored, whichever of them the adapter's checks happened to reach first
// (#332, #368).
//
// The tie to the first offered, because the callers offer the standing notice
// ahead of the newly reported one: an equal notice must not displace what is
// already published, or a single attach reporting two rejections would flap the
// slot and a monitoring system would read two different messages for one
// configuration (#235).
export const mostImportantNotice = (
  ...notices: ReadonlyArray<PlayerError | undefined>
): PlayerError | undefined =>
  notices.reduce<PlayerError | undefined>(
    (held, candidate) =>
      candidate !== undefined &&
      (held === undefined || severityRank(candidate) < severityRank(held))
        ? candidate
        : held,
    undefined
  );

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
