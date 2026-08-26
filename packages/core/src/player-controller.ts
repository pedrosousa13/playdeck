import type {
  AutoplayConfigurationOptions,
  AutoplayMode,
  Availability,
  CommandResult,
  MediaDimensions,
  PlaybackState,
  PlayerCapabilities,
  PlayerCommand,
  PlayerError,
  PlayerEvent,
  PlayerEventFor,
  PlayerEventOrigin,
  PlayerEventType,
  PlayerState,
  PreProviderActivation,
  ProviderAdapter,
  ProviderEvent,
  ProviderStatePatch,
  RefusedCommand,
  RefusedPlay,
  RefusedUrlSurface,
  TextCue
} from './types.js';

import {
  autoplayConfigurationError,
  destroyProviderSafely,
  freezeAvailability,
  freezeCapabilities,
  freezeError,
  isNotice,
  mostImportantNotice,
  notifySafely,
  orderedRanges,
  standingRefusedUrlNotice,
  toProviderError,
  unsubscribeSafely
} from './safety.js';

// What a requested origin waits for before the event confirming it can be
// labelled with it. One record per kind, because a seek issued while a play
// command is still settling must neither evict the play's origin nor take it
// on — and one lifecycle for both kinds: held at the request, dropped when the
// command fails, dropped when the generation moves on, and consumed by the
// report that confirms it (#186).
type PendingOrigin = {
  readonly generation: number;
  readonly origin: PlayerEventOrigin;
} & (
  | {
      readonly kind: 'playback';
      // The playback state the confirming patch has to carry: a pause request
      // is not confirmed by playback starting. Paired with the kind by the
      // union rather than left optional, so neither can be written without the
      // other.
      readonly playback: PlaybackState;
    }
  // A seek has no such discriminator — whichever half of the seek the provider
  // chose to report confirms it, and Wistia reports only the settled half. What
  // stands in for it is the seek report itself: a patch that merely carries a
  // `seeking` key, as an error or a ready patch does, confirms nothing.
  | { readonly kind: 'seek' }
);

type PendingOriginKind = PendingOrigin['kind'];

// A patch is the provider confirming the playback command that asked for it.
const confirmsPlayback = (
  event: ProviderEvent,
  patch: ProviderStatePatch
): boolean =>
  (event.type === 'play' && patch.playback === 'playing') ||
  (event.type === 'pause' && patch.playback === 'paused');

const isSeekEvent = (event: ProviderEvent): boolean =>
  event.type === 'seeking' || event.type === 'seeked';

// A provider reporting that it rejected a consumer-supplied option and carried
// on with a safe default. Non-fatal and outside the error lifecycle, which is
// what separates it from a failure: nothing stopped working, so it must not
// reach `explicitProviderError` and drive lifecycle or activation (#235). The
// rule itself is `isNotice` in `safety.ts`, which `#applyPatch` and
// `ErrorDisplay` ask the same question of; this is the patch-shaped reading of
// it (#368).
const noticeIn = (patch: ProviderStatePatch): PlayerError | undefined =>
  patch.error && isNotice(patch.error, patch.lifecycle)
    ? patch.error
    : undefined;

// Read at the decision point rather than subscribed to, and read off
// `globalThis` rather than off a DOM lib core does not compile against: an
// environment with no `matchMedia` — server rendering, a worker, an older
// engine — simply does not match, and autoplay proceeds as it did before #311.
// A media query that never matches does not apply, so nothing here raises the
// browser-support floor.
//
// No `MediaQueryList` subscription, deliberately. This would be the codebase's
// first, and the case does not need one: a viewer who turns reduced motion *on*
// mid-session is honoured by every player that has not yet decided, and one who
// turns it *off* does not get video retroactively starting at them, which is
// the better of the two behaviours anyway (#311).
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

// Only an exact `true` suppresses, and a `matchMedia` that throws or answers
// with something other than a `MediaQueryList` is treated as not matching —
// the same outcome as an absent one, which is the documented behaviour for
// every environment that cannot answer the query.
//
// Not defensiveness for its own sake: `#synchronizeAutoplay` runs with no `try`
// around it, so a throw out of here escaped the autoplay decision entirely and
// surfaced as a player-level `provider` error — `lifecycle: 'error'` and no
// playback, a broken player rather than an unsuppressed one. A host page that
// patches `matchMedia` (a polyfill, a test harness, a browser extension) is
// ordinary, and a reduced-motion check must never be the thing that takes a
// player down (#311).
const prefersReducedMotion = (): boolean => {
  const scope = globalThis as {
    matchMedia?: (query: string) => { matches?: unknown } | undefined;
  };
  if (typeof scope.matchMedia !== 'function') return false;
  try {
    return scope.matchMedia(REDUCED_MOTION_QUERY)?.matches === true;
  } catch {
    return false;
  }
};

const notReady: Availability = freezeAvailability({
  status: 'unknown',
  reason: 'not-ready'
});

const initialCapabilities = (): PlayerCapabilities =>
  freezeCapabilities({
    seek: notReady,
    setVolume: notReady,
    setPlaybackRate: notReady,
    selectQuality: notReady,
    selectTextTrack: notReady,
    chapters: notReady,
    fullscreen: notReady,
    pictureInPicture: notReady,
    airPlay: notReady,
    customControls: notReady
  });

export const createInitialPlayerState = (): PlayerState =>
  Object.freeze({
    lifecycle: 'idle',
    activation: 'dormant',
    playback: 'paused',
    buffering: false,
    seeking: false,
    seekOrigin: null,
    currentTime: 0,
    duration: null,
    buffered: Object.freeze([]),
    seekable: Object.freeze([]),
    live: null,
    muted: false,
    volume: 1,
    playbackRate: 1,
    fullscreen: false,
    pictureInPicture: false,
    autoplay: 'idle',
    autoplayRecovered: false,
    refusedPlay: null,
    refusedCommand: null,
    provider: null,
    hlsEngine: null,
    quality: null,
    qualities: Object.freeze([]),
    selectedQualityId: null,
    capabilities: initialCapabilities(),
    error: null,
    textTracks: Object.freeze([]),
    chapters: Object.freeze([]),
    selectedTextTrackId: null,
    captionRendering: 'unavailable',
    commandsReady: false
  });

export class PlayerController {
  #provider: ProviderAdapter | undefined;
  #unsubscribe: (() => void) | undefined;
  #cueUnsubscribe: (() => void) | undefined;
  #dimensionUnsubscribe: (() => void) | undefined;
  #activeCues: readonly TextCue[] = Object.freeze([]);
  #cueListeners = new Set<(cues: readonly TextCue[]) => void>();
  #dimensions: MediaDimensions | undefined;
  #dimensionListeners = new Set<
    (dimensions: MediaDimensions | undefined) => void
  >();
  #listeners = new Set<(state: PlayerState) => void>();
  #readyWaiters = new Set<(ready: boolean) => void>();
  #eventListeners = new Map<
    PlayerEventType,
    Set<(event: PlayerEvent) => void>
  >();
  #state = createInitialPlayerState();
  #generation = 0;
  #autoplayMode: AutoplayMode = false;
  #autoplayControlledMuted: boolean | undefined;
  #autoplayIgnoreReducedMotion = false;
  #captionRenderer: 'custom' | 'native' = 'custom';
  #hasAutoplayConfigurationError = false;
  #autoplayConfigurationRevision = 0;
  #autoplayAttemptGeneration: number | undefined;
  // The play command last issued, whatever asked for it — the API, a user
  // gesture, or autoplay's own attempt — and `undefined` once playback has been
  // confirmed since. Recorded at the issue rather than at the settlement, so an
  // attempt still in flight counts as one: see `hasUnconfirmedPlayAttempt`
  // (#244). It carries the generation it was issued for, and it is its own
  // identity: a fresh object per command, compared by reference the way
  // `#pendingOrigins` compares a request, so a command settling can tell that a
  // later play replaced it or that a patch confirmed playback while it was
  // still in flight. A generation cannot answer either question — two play
  // commands against one provider share one — and both are the difference
  // between a refusal that is still the last word and one that is not (#361).
  #playAttempt: { readonly generation: number } | undefined;
  // The refusal `PlayerState.refusedPlay` publishes, held here rather than read
  // back off the published state, for the reason `autoplayRecovered` is derived
  // rather than taken: `ProviderStatePatch` is a `Partial<PlayerState>`, so the
  // key is in every patch's reach, and a provider has no way to know a command
  // it was never told about was refused. Filling the field from this record
  // means an adapter cannot manufacture a refusal that never happened, or erase
  // one that did (#361).
  //
  // Not scoped to the generation the way `#playAttempt` is: that one is read
  // through a method that can test it at the read, and this is copied into
  // every snapshot, so it has to be cleared rather than merely ignored.
  // `setProvider` is where that happens.
  #refusedPlay: RefusedPlay | undefined;
  // The refusal `PlayerState.refusedCommand` publishes, held here rather than
  // read back off the published state for the reason `#refusedPlay` above is:
  // `ProviderStatePatch` is a `Partial<PlayerState>`, so an adapter could
  // otherwise manufacture the refusal of a command it was never told about, or
  // erase one that happened.
  //
  // Not scoped to the generation, and it does not need to be. It is written
  // only where no provider is attached, and cleared where one attaches,
  // detaches or is swapped — `setProvider`, in the same place `#refusedPlay` is
  // cleared.
  #refusedCommand: RefusedCommand | undefined;
  // Set once the muted retry of `'audible-then-muted'` is issued, and read at
  // the moment the attempt turns into `'started'`. The state flag cannot be
  // written from here directly: playback is confirmed by a provider patch, not
  // by the play command resolving (#306).
  #autoplayRecoveryPending = false;
  // The generation whose `load()` has run. No play command may be issued before
  // it: `load()` aborts a play already in flight, per the HTML media spec. This
  // is reachable because a provider may report ready from inside `attach()` —
  // `provider-native` does exactly that when the media already has metadata —
  // while `load()` is only queued once `attach()` returns (#87).
  #loadedGeneration: number | undefined;
  #pendingOrigins = new Map<PendingOriginKind, PendingOrigin>();
  // The provider's most important configuration rejection, held as controller
  // state the way `#hasAutoplayConfigurationError` holds the autoplay conflict:
  // the state has one error slot, so a notice left in the patch would be cleared
  // by the next patch that omits an `error` key, and would overwrite an error
  // that actually stopped playback. It is dropped with the provider that
  // reported it (#235).
  //
  // Which of an attach's rejections that is, is decided by severity and not by
  // arrival — see the fill site in `setProvider`. A tie keeps the one already
  // held, so two rejections in the same attach still cannot flap the slot
  // (#368).
  #configurationNotice: PlayerError | undefined;
  // How many reporters currently stand behind each refused surface — the live
  // answer, not a log of what was once refused. Keyed by surface because the
  // notice is chosen by surface, counted because a surface is a PROP NAME and
  // several independent component instances can hold that same prop at once.
  // A boolean per surface cannot express that: two `PosterImage`s under one
  // `Player.Root` are two reporters, and the permitted one's report would
  // withdraw the poisoned one's notice, so half the render orders would refuse
  // in total silence — the exact A09 failure #330 exists to fix (#345).
  //
  // Scoped to the controller rather than to a provider, unlike
  // `#configurationNotice`. That is not a difference in how long a rejection is
  // interesting, it is a difference in what the rejection is about:
  // `#configurationNotice` describes one provider's own configuration and is
  // dropped with that provider, while a refused `poster src` describes a
  // consumer prop the provider knows nothing about. In the ordinary React
  // ordering the poster renders and reports BEFORE the provider module has
  // finished loading, so a provider-scoped record would be wiped by the very
  // next attach, before anything could observe it.
  //
  // A surface with no standing reporter is deleted rather than left at zero, so
  // the map's size is bounded by the number of surfaces actually refused right
  // now and does not grow as component instances churn.
  #refusedUrlReports = new Map<RefusedUrlSurface, number>();
  // The notice `#refusedUrlReports` currently publishes, cached rather than
  // rebuilt at each read: the state carries it by reference, and a fresh object
  // per `#applyPatch` would make every unrelated patch look like a change of
  // error to a subscriber comparing identity. Resolved in `#applyPatch` and in
  // `#withHeldConfiguration`, never left in a patch (#330).
  #refusedUrlNotice: PlayerError | undefined;

  // The detection half of the refusal at the five consumer-supplied URL props
  // #320 routed through `isPermittedSourceUrl` and left silent. The refusal
  // itself is unchanged: the value is still dropped exactly as an absent prop
  // would be, and this reports it without throwing, without touching the
  // lifecycle and without changing what renders (#320, #330).
  //
  // A REGISTRATION, not a setter: the caller says "I am refusing this surface"
  // and holds the returned disposer for as long as that stays true. The notice
  // stands while any registration for any surface stands, so a refusal is
  // withdrawn only by the reporter that made it — never by a sibling that
  // happens to hold a permitted value for the same prop. A per-prop boolean
  // could not express that, and the withdrawal it would get wrong is not a rare
  // one: two `PosterImage`s under one root is an ordinary responsive-poster
  // tree.
  //
  // Withdrawable at all, rather than fire-once, because a notice that could
  // never be cleared is a permanent false positive: a consumer who replaced a
  // poisoned CMS value with a good one would keep the error forever, and an
  // operator who cannot clear a security notice learns to ignore all of them.
  //
  // The disposer shape is what makes the React call sites correct by
  // construction — each is `return controller.reportRefusedUrl(surface)` from an
  // effect, so the registration is per instance, is torn down on unmount and on
  // the value turning permitted, and leaks nothing. See `useRefusedUrlReport`
  // (`packages/react/src/player-context.ts`).
  //
  // Takes the surface, never the value — see `RefusedUrlSurface`.
  reportRefusedUrl = (surface: RefusedUrlSurface): (() => void) => {
    this.#refusedUrlReports.set(
      surface,
      (this.#refusedUrlReports.get(surface) ?? 0) + 1
    );
    this.#resolveRefusedUrlNotice();
    // Idempotent, because the disposer leaves the library: `reportRefusedUrl`
    // is public on `PlayerController`, so anything holding the controller can
    // register and then run the disposer twice. A second run must not decrement
    // a count another live reporter owns, which would withdraw a refusal that
    // still stands. Neither call site here gets there — React never repeats an
    // effect cleanup, and `bindMediaSession` nulls its own handle inside
    // `release()` — so the guard is defensive for those two, and it is what
    // makes the disposer safe to hand any further out.
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const standing = (this.#refusedUrlReports.get(surface) ?? 0) - 1;
      if (standing > 0) this.#refusedUrlReports.set(surface, standing);
      else this.#refusedUrlReports.delete(surface);
      this.#resolveRefusedUrlNotice();
    };
  };

  #resolveRefusedUrlNotice = (): void => {
    const next = standingRefusedUrlNotice(this.#refusedUrlReports);
    // The one gate, and it covers every inert registration: a second reporter
    // joining a surface that already stands, and a surface joining or leaving
    // BELOW the one already published. Neither changes what the single error
    // slot can say, and the call sites are React effects and a media-session
    // binding that run for reasons having nothing to do with the value — so an
    // inert registration has to stay free of a rebuilt snapshot and a fan-out to
    // every subscriber. Compared by identity, which holds because
    // `standingRefusedUrlNotice` returns one shared value per surface rather
    // than a fresh object.
    if (next === this.#refusedUrlNotice) return;
    const published = this.#refusedUrlNotice;
    this.#refusedUrlNotice = next;
    // `#applyPatch` reads an absent `error` key as "keep whatever the slot
    // holds", and what it holds may be the notice being withdrawn — so a
    // withdrawal has to be stated, or the stale notice is carried forward as
    // though a patch had set it. Clearing to `null` loses nothing: `#applyPatch`
    // refills the slot from `#configurationNotice` and the new
    // `#refusedUrlNotice` in the same pass. Where the slot holds something else,
    // that something outranks this notice and an empty patch leaves it alone.
    this.#applyPatch(this.#state.error === published ? { error: null } : {});
  };

  configureAutoplay = (
    mode: AutoplayMode,
    options: AutoplayConfigurationOptions = {}
  ): void => {
    // Normalized to a boolean before it is compared, unlike `controlledMuted`:
    // an absent opt-out and an explicit `false` mean the same thing, so treating
    // them as different values here would re-run the configuration for nothing
    // (#311).
    const ignoreReducedMotion = options.ignoreReducedMotion ?? false;
    if (
      mode === this.#autoplayMode &&
      options.controlledMuted === this.#autoplayControlledMuted &&
      ignoreReducedMotion === this.#autoplayIgnoreReducedMotion
    )
      return;
    const hadConfigurationError = this.#hasAutoplayConfigurationError;
    this.#autoplayMode = mode;
    this.#autoplayControlledMuted = options.controlledMuted;
    this.#autoplayIgnoreReducedMotion = ignoreReducedMotion;
    this.#hasAutoplayConfigurationError =
      mode === 'muted' && options.controlledMuted === false;
    this.#autoplayConfigurationRevision += 1;
    if (this.#pendingOrigins.get('playback')?.origin === 'autoplay') {
      this.#pendingOrigins.delete('playback');
    }
    this.#applyPatch({
      autoplay: this.#hasAutoplayConfigurationError ? 'failed' : 'idle',
      error: this.#hasAutoplayConfigurationError
        ? this.#state.lifecycle === 'error' &&
          this.#state.error?.category !== 'configuration'
          ? this.#state.error
          : autoplayConfigurationError()
        : hadConfigurationError &&
            this.#state.error?.category === 'configuration'
          ? null
          : this.#state.error
    });
    this.#synchronizeAutoplay();
  };

  setActivation = (next: PreProviderActivation): void => {
    if (this.#provider) return;
    const lifecycle =
      next.activation === 'loading-provider'
        ? 'loading'
        : next.activation === 'error'
          ? 'error'
          : 'idle';
    this.#applyPatch({
      activation: next.activation,
      lifecycle,
      error: next.activation === 'error' ? next.error : null
    });
  };

  setProvider = (provider: ProviderAdapter | undefined): void => {
    const alreadyDetached =
      this.#state.lifecycle === 'idle' &&
      this.#state.activation === 'dormant' &&
      this.#state.provider === null &&
      this.#state.error === null;
    if (
      provider === this.#provider &&
      (provider !== undefined || alreadyDetached)
    )
      return;
    this.#pendingOrigins.clear();
    // A refusal describes the media attached now, so a new provider — or none —
    // ends it. Deliberately unlike `#refusedUrlNotice`, which `setProvider`
    // keeps: that one describes a consumer prop no provider ever saw, while
    // this one describes a command a provider turned down, and the provider
    // being replaced is what stops it from being true (#361). The state below
    // is rebuilt from `createInitialPlayerState()`, so clearing the record here
    // is what keeps the two in step: without it the next patch would republish
    // a refusal by media that is no longer attached.
    this.#refusedPlay = undefined;
    // The pre-attach refusal is withdrawn here, for the same reason as above:
    // the state below is rebuilt from `createInitialPlayerState()`, so the
    // record has to keep step with it. That makes this line the whole of its
    // clearing rule. An attach ends the refusal because a provider arrived; a
    // swap and a detach end it because the state it was published into is being
    // rebuilt regardless. So a detach clears it without a provider ever having
    // attached — keeping it instead would leave the record standing while the
    // published field went back to null, and the next patch would resurrect it
    // into freshly reset state.
    this.#refusedCommand = undefined;
    // Only an attempt that actually existed can be abandoned. Waiters
    // registered before the first attach are waiting *for* this provider, not
    // for the one being replaced, so they must survive it.
    if (this.#provider) this.#settleReadyWaiters(false);
    const generation = ++this.#generation;
    const unsubscribe = this.#unsubscribe;
    const cueUnsubscribe = this.#cueUnsubscribe;
    const dimensionUnsubscribe = this.#dimensionUnsubscribe;
    const previousProvider = this.#provider;
    this.#unsubscribe = undefined;
    this.#cueUnsubscribe = undefined;
    this.#dimensionUnsubscribe = undefined;
    this.#provider = undefined;
    unsubscribeSafely(unsubscribe);
    unsubscribeSafely(cueUnsubscribe);
    unsubscribeSafely(dimensionUnsubscribe);
    this.#setActiveCues([]);
    // Cleared before the next provider gets a chance to measure: a ratio must
    // never outlive the source it described.
    this.#setDimensions(undefined);
    if (previousProvider) {
      destroyProviderSafely(previousProvider);
    }
    if (generation !== this.#generation) return;
    this.#provider = provider;
    // A notice describes one provider's configuration, so it goes with that
    // provider — on a swap and on a detach alike (#235). `#refusedUrlNotice` is
    // deliberately NOT cleared here: it describes a consumer prop no provider
    // ever saw, and clearing it would drop the report on the very attach that
    // normally follows it (#330).
    this.#configurationNotice = undefined;
    if (!provider) {
      this.#setState(this.#withHeldConfiguration(createInitialPlayerState()));
      return;
    }

    this.#setState(
      this.#withHeldConfiguration({
        ...createInitialPlayerState(),
        lifecycle: 'loading',
        activation: 'loading-provider',
        provider: provider.provider
      })
    );
    if (generation !== this.#generation || provider !== this.#provider) return;
    let nextUnsubscribe: (() => void) | undefined;
    try {
      nextUnsubscribe = provider.subscribe((patch, event) => {
        if (generation !== this.#generation) return;
        const confirmedPlaybackOrigin =
          patch.playback !== undefined
            ? this.#consumePendingOrigin('playback', generation, patch.playback)
            : undefined;
        // Gated on the event, not on the patch carrying a `seeking` key: the
        // error and reset patches of several adapters carry `seeking: false`
        // without reporting a seek, and consuming there eats an origin the
        // real report still needs.
        const confirmedSeekOrigin =
          event !== undefined && isSeekEvent(event)
            ? this.#consumePendingOrigin('seek', generation)
            : undefined;
        // Read before the patch lands: the settled half of a seek arrives as
        // `seeking: false`, which clears the field the started half wrote.
        const seekOriginInFlight = this.#state.seekOrigin;
        const originatingEvent = event
          ? {
              ...event,
              origin: confirmsPlayback(event, patch)
                ? (confirmedPlaybackOrigin ?? event.origin)
                : isSeekEvent(event)
                  ? (confirmedSeekOrigin ?? seekOriginInFlight ?? event.origin)
                  : event.origin,
              provider: provider.provider
            }
          : undefined;
        // Recorded here rather than inside `#applyPatch`, which the autoplay
        // configuration and the activation setter also reach: a notice is
        // something a provider reports, and this is the one path a provider
        // speaks on. It leaves the patch with it, so the resolution in
        // `#applyPatch` decides whether it is published, the same way the
        // autoplay conflict is recorded by `configureAutoplay` and resolved
        // there (#235).
        //
        // Compare-and-replace, not the `??=` this was until #368: an adapter
        // that reports two rejections in one attach had the first of them keep
        // the slot for good, so a cosmetic option rejected early silenced a
        // security- or privacy-relevant refusal reported after it, and nothing
        // carried the loser. The incumbent is offered first, so only a strictly
        // higher severity takes the slot and a tie leaves it where it is —
        // which is the anti-flapping property `??=` was really providing, kept
        // without the ordering debt it charged every adapter for.
        //
        // Frozen before it is offered rather than after it has won: the value
        // being ranked is the value that will be held, so nothing a provider
        // can still rewrite is compared, held or published.
        const notice = noticeIn(patch);
        if (notice)
          this.#configurationNotice = mostImportantNotice(
            this.#configurationNotice,
            freezeError(notice)
          );
        // The confirmed origin joins the patch rather than being derived from
        // the pending record inside `#applyPatch`: the patch is consumed once,
        // and both the event above and the state below have to read the same
        // answer. Setting the key unconditionally also drops any value an
        // adapter put there — provenance is the controller's to decide.
        this.#applyPatch(
          {
            ...patch,
            seekOrigin: confirmedSeekOrigin,
            error: notice ? undefined : patch.error
          },
          false
        );
        if (originatingEvent) this.#emitEvent(originatingEvent);
        if (generation !== this.#generation || provider !== this.#provider)
          return;
        this.#synchronizeAutoplay();
      });
    } catch (cause) {
      if (generation !== this.#generation || provider !== this.#provider) {
        return;
      }
      this.#provider = undefined;
      destroyProviderSafely(provider);
      // The third path a provider leaves by, and the notice goes with it here
      // too: a provider may report one from inside `subscribe()` and then throw
      // (#235).
      this.#configurationNotice = undefined;
      // Cleared with the generation it belonged to, not left for the
      // generation check in `#consumePendingOrigin` to reject downstream: a
      // request outstanding against a generation that has moved on has nothing
      // left to confirm it.
      this.#pendingOrigins.clear();
      this.#handleLifecycleFailure(cause, ++this.#generation);
      return;
    }
    if (generation !== this.#generation || provider !== this.#provider) {
      unsubscribeSafely(nextUnsubscribe);
      return;
    }
    this.#unsubscribe = nextUnsubscribe;
    if (provider.subscribeCues) {
      this.#cueUnsubscribe = provider.subscribeCues((cues) => {
        if (generation !== this.#generation || provider !== this.#provider)
          return;
        this.#setActiveCues(cues);
      });
    }
    if (provider.subscribeDimensions) {
      this.#dimensionUnsubscribe = provider.subscribeDimensions(
        (dimensions) => {
          if (generation !== this.#generation || provider !== this.#provider)
            return;
          this.#setDimensions(dimensions);
        }
      );
    }
    try {
      provider.setCaptionRenderer?.(this.#captionRenderer);
    } catch {
      // Re-applying the remembered mode must not crash provider wiring.
    }
    let attachResult: void | Promise<void>;
    try {
      attachResult = provider.attach();
    } catch (cause) {
      this.#handleLifecycleFailure(cause, generation);
      return;
    }
    void Promise.resolve(attachResult)
      .then(() => {
        if (generation !== this.#generation) return;
        return provider.load();
      })
      .then(() => {
        if (generation !== this.#generation) return;
        this.#loadedGeneration = generation;
        // A provider that reported ready during `attach()` had its autoplay
        // attempt declined for being pre-load; this is that attempt's turn.
        this.#synchronizeAutoplay();
      })
      .catch((cause: unknown) =>
        this.#handleLifecycleFailure(cause, generation)
      );
  };

  getState = (): PlayerState => this.#state;

  // Whether a play command was issued against the media attached now and
  // playback never reached `'playing'` — refused, faulted, or still in flight.
  //
  // Not a `PlayerState` field, deliberately, and still not one after #361 put
  // the *refusal* on state as `refusedPlay`. The two are not the same fact.
  // This one is true while a play command is still in flight, which is a
  // property of the command and of nothing else; the one reader that needs it
  // is `Root`'s first-frame poster writer, which must know that *something
  // asked to play* before it uncovers a frame a refusal left paused, and must
  // defer while the answer is still coming (#244). Publishing that would put an
  // attempt counter in every snapshot to change what exactly one internal
  // reader does.
  //
  // A refusal is where the #244 reasoning stopped holding, and #361 is what
  // showed it. "Reported to the caller and to nobody else" is a fair account of
  // a command while the caller is the only party with a stake in it — but a
  // `PlayButton` press has no caller in that sense: the library issues the
  // command on a viewer's behalf and discards the result, so the consumer who
  // has to present the outcome never sees one. A settled refusal is therefore a
  // fact about the player that outlives its command, and it belongs on state;
  // an attempt still in flight is not, and does not.
  //
  // Scoped to the generation, so attaching a provider clears it: the frame that
  // decodes for freshly attached media is not the one an earlier refusal left
  // paused, and it must keep hiding the poster on its own.
  //
  // The record is dropped in `#applyPatch` by any patch that leaves playback at
  // `'playing'` — not only by the one that first reports it — so a viewer who
  // pauses confirmed playback does not re-arm this; without that, it would
  // answer "not playing since some play was issued" rather than what it is
  // named for. The `playback` term covers the window before such a patch lands:
  // a `play()` issued against media already playing draws none of its own, so
  // its record stands until an unrelated one arrives, and the term is what
  // answers false meanwhile. Should playback drop to `'paused'` inside that
  // window instead, the record does answer true, and that cannot cost anything:
  // playback confirmed in this generation means the poster is already hidden,
  // and the writer this answers only ever hides.
  hasUnconfirmedPlayAttempt = (): boolean =>
    this.#playAttempt?.generation === this.#generation &&
    this.#state.playback !== 'playing';

  // Resolves `true` once the provider declares that a command issued now will
  // land and stick, and `false` once an attempt that existed is abandoned —
  // detach, swap, or a fatal error. Never rejects, and never hangs on an
  // outcome: both shapes tried in PR #72 could hang forever.
  whenReady = (): Promise<boolean> => {
    if (this.#state.commandsReady) return Promise.resolve(true);
    // Deliberately no "no provider yet, so false" shortcut: the React layer
    // attaches in an effect, so a call that lands first is a race, not an
    // answer, and a spurious `false` makes the caller skip the very command it
    // was waiting to issue.
    return new Promise<boolean>((resolve) => this.#readyWaiters.add(resolve));
  };

  #settleReadyWaiters = (ready: boolean): void => {
    if (this.#readyWaiters.size === 0) return;
    const waiters = this.#readyWaiters;
    this.#readyWaiters = new Set();
    waiters.forEach((resolve) => resolve(ready));
  };

  subscribe = (listener: (state: PlayerState) => void): (() => void) => {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  };

  subscribeCues = (
    listener: (cues: readonly TextCue[]) => void
  ): (() => void) => {
    this.#cueListeners.add(listener);
    listener(this.#activeCues);
    return () => this.#cueListeners.delete(listener);
  };

  getActiveCues = (): readonly TextCue[] => this.#activeCues;

  subscribeDimensions = (
    listener: (dimensions: MediaDimensions | undefined) => void
  ): (() => void) => {
    this.#dimensionListeners.add(listener);
    listener(this.#dimensions);
    return () => this.#dimensionListeners.delete(listener);
  };

  setCaptionRenderer = (mode: 'custom' | 'native'): void => {
    this.#captionRenderer = mode;
    this.#provider?.setCaptionRenderer?.(mode);
  };

  on = <Type extends PlayerEventType>(
    type: Type,
    listener: (event: PlayerEventFor<Type>) => void
  ): (() => void) => {
    const listeners = this.#eventListeners.get(type) ?? new Set();
    const keyedListener = (event: PlayerEvent): void =>
      listener(event as PlayerEventFor<Type>);
    listeners.add(keyedListener);
    this.#eventListeners.set(type, listeners);
    return () => {
      listeners.delete(keyedListener);
      // Only drop the map entry if it still holds this (now-empty) set; a
      // re-registration under the same type installs a fresh set that a
      // duplicated unsubscribe must not delete.
      if (
        this.#eventListeners.get(type) === listeners &&
        listeners.size === 0
      ) {
        this.#eventListeners.delete(type);
      }
    };
  };

  play = (): Promise<CommandResult> => this.playWithOrigin('api');
  playWithOrigin = (origin: PlayerEventOrigin): Promise<CommandResult> => {
    const provider = this.#provider;
    if (!provider) {
      // The refusal `#playWithOrigin` publishes for every play that reaches a
      // provider, made here because this return never reaches that method. It
      // is a refused play by every part of the definition — a play command was
      // issued and turned down — and the only reason it went unpublished is
      // where the guard sits.
      //
      // The three conditions that guard the publication there hold on this
      // branch without being tested, which is why they are not repeated. This
      // is synchronous, so no later play can have replaced it and the
      // generation cannot have moved; and `playback` cannot be `'playing'`
      // when there is no provider attached to be playing anything (#361).
      this.#refusedPlay = Object.freeze({ origin, reason: 'not-ready' });
      return Promise.resolve(this.#refuseCommand('play', origin));
    }
    return this.#playWithOrigin(provider, this.#generation, origin);
  };
  pause = (): Promise<CommandResult> => this.pauseWithOrigin('api');
  pauseWithOrigin = (origin: PlayerEventOrigin): Promise<CommandResult> => {
    this.#pendingOrigins.delete('playback');
    const provider = this.#provider;
    if (!provider) return Promise.resolve(this.#refuseCommand('pause', origin));
    return this.#pauseWithOrigin(provider, this.#generation, origin);
  };
  togglePlayback = (): Promise<CommandResult> =>
    this.togglePlaybackWithOrigin('api');
  togglePlaybackWithOrigin = (
    origin: PlayerEventOrigin
  ): Promise<CommandResult> =>
    this.#state.playback === 'playing'
      ? this.pauseWithOrigin(origin)
      : this.playWithOrigin(origin);
  seekTo = (time: number): Promise<CommandResult> =>
    this.seekToWithOrigin(time, 'api');
  seekToWithOrigin = (
    time: number,
    origin: PlayerEventOrigin
  ): Promise<CommandResult> => this.#seekWithOrigin('seekTo', time, origin);
  seekBy = (offset: number): Promise<CommandResult> =>
    this.seekByWithOrigin(offset, 'api');
  seekByWithOrigin = (
    offset: number,
    origin: PlayerEventOrigin
  ): Promise<CommandResult> => this.#seekWithOrigin('seekBy', offset, origin);
  selectQuality = (id: string | null): Promise<CommandResult> =>
    this.#command('selectQuality', id);
  mute = (): Promise<CommandResult> => this.#command('mute');
  unmute = (): Promise<CommandResult> => this.#command('unmute');
  toggleMuted = (): Promise<CommandResult> =>
    this.#state.muted ? this.unmute() : this.mute();
  setVolume = (volume: number): Promise<CommandResult> =>
    this.#command('setVolume', volume);
  setPlaybackRate = (rate: number): Promise<CommandResult> =>
    this.#command('setPlaybackRate', rate);
  selectTextTrack = (track: string | null): Promise<CommandResult> =>
    this.#command('selectTextTrack', track);
  requestFullscreen = (): Promise<CommandResult> =>
    this.#command('requestFullscreen');
  exitFullscreen = (): Promise<CommandResult> =>
    this.#command('exitFullscreen');
  requestPictureInPicture = (): Promise<CommandResult> =>
    this.#command('requestPictureInPicture');
  exitPictureInPicture = (): Promise<CommandResult> =>
    this.#command('exitPictureInPicture');
  showAirPlayPicker = (): Promise<CommandResult> =>
    this.#command('showAirPlayPicker');
  retry = (): Promise<CommandResult> => {
    const provider = this.#provider;
    if (!provider?.retry) return this.#command('retry');
    const generation = this.#generation;
    const previousState = this.#state;
    this.#applyPatch({
      lifecycle: 'loading',
      activation: 'loading-provider',
      // The provider is rebuilding or reloading its playback target, so its
      // previous declaration is void until it makes a new one (#69).
      commandsReady: false,
      error: null
    });
    if (this.#provider !== provider || this.#generation !== generation) {
      return Promise.resolve({ ok: false, reason: 'not-ready' });
    }
    return this.#providerCommand(provider, 'retry').then((result) => {
      if (
        this.#provider !== provider ||
        this.#generation !== generation ||
        this.#state.lifecycle !== 'loading'
      ) {
        return result;
      }
      if (!result.ok && result.error) {
        this.#applyPatch({
          lifecycle: 'error',
          activation: 'error',
          error: result.error
        });
      } else if (!result.ok) {
        this.#applyPatch({
          lifecycle: previousState.lifecycle,
          activation: previousState.activation,
          commandsReady: previousState.commandsReady,
          error: previousState.error
        });
      }
      return result;
    });
  };

  #command = async (
    name: keyof Pick<
      ProviderAdapter,
      | 'play'
      | 'pause'
      | 'seekTo'
      | 'seekBy'
      | 'selectQuality'
      | 'mute'
      | 'unmute'
      | 'setVolume'
      | 'setPlaybackRate'
      | 'selectTextTrack'
      | 'requestFullscreen'
      | 'exitFullscreen'
      | 'requestPictureInPicture'
      | 'exitPictureInPicture'
      | 'showAirPlayPicker'
      | 'retry'
    >,
    value?: number | string | null
  ): Promise<CommandResult> => {
    const provider = this.#provider;
    if (!provider) {
      // The one command refused here without being published — see
      // `PlayerCommand`, which leaves it out of the vocabulary so that both of
      // its refusal sites stay silent rather than one of them.
      if (name === 'retry') return { ok: false, reason: 'not-ready' };
      return this.#refuseCommand(
        // Both public seeks carry an origin and take `#seekWithOrigin`'s own
        // path, so neither name reaches this branch from them. Mapped anyway,
        // so a command that is one command to a consumer cannot arrive under
        // two names depending on which path refused it.
        name === 'seekTo' || name === 'seekBy' ? 'seek' : name,
        null
      );
    }
    return this.#providerCommand(provider, name, value);
  };

  // Records a command refused for want of a provider, and publishes it through
  // an empty patch — which rebuilds the snapshot from the controller's own
  // records and fans it out. Nothing about the player itself moved, so there is
  // no provider patch to carry this, and `refusedCommand` is filled from the
  // record rather than from a key, so there is no key to state. Pre-attach that
  // rebuild is deliberately not a no-op: it re-ranks the error slot, and a
  // standing refused-URL notice is the ordinary case there rather than an edge
  // one, because the poster reports before the provider loads (#330).
  //
  // `origin` is taken rather than derived: only the three commands with
  // `*WithOrigin` entry points have one to pass, and the rest pass `null`.
  #refuseCommand = (
    command: PlayerCommand,
    origin: PlayerEventOrigin | null
  ): CommandResult => {
    this.#refusedCommand = Object.freeze({
      command,
      origin,
      reason: 'not-ready'
    });
    this.#applyPatch({});
    return { ok: false, reason: 'not-ready' };
  };

  #providerCommand = async (
    provider: ProviderAdapter,
    name: keyof Pick<
      ProviderAdapter,
      | 'play'
      | 'pause'
      | 'seekTo'
      | 'seekBy'
      | 'selectQuality'
      | 'mute'
      | 'unmute'
      | 'setVolume'
      | 'setPlaybackRate'
      | 'selectTextTrack'
      | 'requestFullscreen'
      | 'exitFullscreen'
      | 'requestPictureInPicture'
      | 'exitPictureInPicture'
      | 'showAirPlayPicker'
      | 'retry'
    >,
    value?: number | string | null
  ): Promise<CommandResult> => {
    const command = provider[name] as
      ((value?: number | string | null) => Promise<CommandResult>) | undefined;
    if (!command) return { ok: false, reason: 'unsupported' };
    try {
      return await command.call(provider, value);
    } catch (cause) {
      return {
        ok: false,
        reason: 'provider-error',
        error: toProviderError(cause)
      };
    }
  };

  #setState = (state: PlayerState): void => {
    const snapshot = Object.freeze(state);
    this.#state = snapshot;
    if (snapshot.commandsReady) {
      this.#settleReadyWaiters(true);
    } else if (snapshot.error?.fatal === true) {
      // Only fatal: `toProviderError` stamps `recoverable: true` on every
      // lifecycle exception, so settling on recoverable would settle on
      // nearly everything, and `retry()` may still reach ready (#69).
      this.#settleReadyWaiters(false);
    }
    this.#listeners.forEach((listener) => notifySafely(listener, snapshot));
  };

  #setActiveCues = (cues: readonly TextCue[]): void => {
    this.#activeCues = Object.freeze(cues.map((c) => Object.freeze({ ...c })));
    this.#cueListeners.forEach((l) => notifySafely(l, this.#activeCues));
  };

  #setDimensions = (dimensions: MediaDimensions | undefined): void => {
    this.#dimensions = dimensions && Object.freeze({ ...dimensions });
    this.#dimensionListeners.forEach((l) => notifySafely(l, this.#dimensions));
  };

  #applyPatch = (patch: ProviderStatePatch, acceptAutoplay = true): void => {
    const explicitProviderError =
      patch.error !== undefined &&
      patch.error !== null &&
      (patch.lifecycle === 'error' || patch.error.fatal);
    const nextLifecycle = patch.lifecycle ?? this.#state.lifecycle;
    const nextPlayback = patch.playback ?? this.#state.playback;
    // A play command stops being unconfirmed here and nowhere else: the promise
    // it returns resolving is not playback, a provider patch reporting
    // `'playing'` is. Dropping the record at that transition keeps
    // `hasUnconfirmedPlayAttempt` answering for the attempt it names rather than
    // for every later pause in the same generation (#244).
    //
    // A refusal it may have left goes at the same moment and for the same
    // reason, which is what keeps `refusedPlay` a condition rather than a log:
    // it says the last play command was refused and nothing has played since,
    // so playback reaching `'playing'` is precisely the thing that stops it
    // being true — whether the play that started it was the retry the consumer
    // offered, autoplay's muted recovery, or the viewer working the provider's
    // own controls. Nothing else clears it here: a pause, a seek, a stall or an
    // error leaves a refused play just as refused as it was (#361).
    //
    // Dropping the attempt record is the other half of that, and it is what
    // holds the condition under a settlement that arrives late: a command still
    // in flight through this transition no longer holds the record, so the
    // guard in `#playWithOrigin` refuses to re-arm a refusal playback has
    // already outrun. A later pause does not give the record back.
    if (nextPlayback === 'playing') {
      this.#playAttempt = undefined;
      this.#refusedPlay = undefined;
    }
    const nextAutoplay = this.#hasAutoplayConfigurationError
      ? ('failed' as const)
      : patch.playback === 'playing' && this.#state.autoplay === 'attempting'
        ? ('started' as const)
        : acceptAutoplay
          ? (patch.autoplay ?? this.#state.autoplay)
          : this.#state.autoplay;
    // What the patch alone says the slot should hold, before the held notices
    // are considered (#235).
    const errorBeforeNotice =
      patch.lifecycle === 'ready' && patch.error === undefined
        ? null
        : patch.error === undefined
          ? this.#state.error
          : patch.error === null
            ? null
            : freezeError(patch.error);
    // The one question that decides how the value above is resolved, because
    // `errorBeforeNotice` covers two unlike things. A failure — fatal, the
    // `provider` fault a refused autoplay attempt publishes, anything under
    // `lifecycle: 'error'` — keeps the slot by standing in it, and a notice
    // still waits behind it exactly as it did before #368: nothing about a
    // rejected option outranks something that stopped working.
    //
    // A notice that stands is a different matter. It is a candidate among the
    // held notices rather than the winner by position, or the arrival order the
    // fill site stopped honouring would come straight back in through the
    // published slot: the presentational notice published first would be the
    // incumbent, and the protective one that displaced it in
    // `#configurationNotice` would never reach a consumer. It is offered first,
    // so a tie still leaves it standing (#368).
    const standingFailure =
      errorBeforeNotice !== null && !isNotice(errorBeforeNotice, nextLifecycle)
        ? errorBeforeNotice
        : null;
    const standingNotice =
      standingFailure === null ? (errorBeforeNotice ?? undefined) : undefined;
    const nextState: PlayerState = {
      ...this.#state,
      ...patch,
      buffered:
        patch.buffered === undefined
          ? this.#state.buffered
          : orderedRanges(patch.buffered),
      seekable:
        patch.seekable === undefined
          ? this.#state.seekable
          : orderedRanges(patch.seekable),
      capabilities:
        patch.capabilities === undefined
          ? this.#state.capabilities
          : freezeCapabilities(patch.capabilities),
      textTracks:
        patch.textTracks === undefined
          ? this.#state.textTracks
          : Object.freeze(
              patch.textTracks.map((track) => Object.freeze({ ...track }))
            ),
      chapters:
        patch.chapters === undefined
          ? this.#state.chapters
          : Object.freeze(
              patch.chapters.map((chapter) => Object.freeze({ ...chapter }))
            ),
      quality:
        patch.quality === undefined
          ? this.#state.quality
          : patch.quality === null
            ? null
            : Object.freeze({ ...patch.quality }),
      qualities:
        patch.qualities === undefined
          ? this.#state.qualities
          : Object.freeze(
              patch.qualities.map((quality) => Object.freeze({ ...quality }))
            ),
      // Held to the same invariant the type states: set exactly while a seek is
      // in flight, `null` the rest of the time. A seek already under way keeps
      // the origin it started with, so a patch that re-reports `seeking` does
      // not relabel it; a seek nobody requested is the provider's own (#186).
      seekOrigin:
        (patch.seeking ?? this.#state.seeking)
          ? (patch.seekOrigin ?? this.#state.seekOrigin ?? 'provider')
          : null,
      autoplay: nextAutoplay,
      // Derived here and never taken from the patch: a provider has no way to
      // know an attempt was refused before this one. The recovery is recorded
      // at the one transition that means playback started, so an in-flight
      // retry -- still `'attempting'` -- reads false (#306).
      autoplayRecovered:
        nextAutoplay !== 'started'
          ? false
          : this.#state.autoplay === 'started'
            ? this.#state.autoplayRecovered
            : this.#autoplayRecoveryPending,
      // Filled from the controller's own record for the same reason
      // `autoplayRecovered` is derived here, and never taken from the patch:
      // see `#refusedPlay`. Written on every pass rather than only where it
      // changed, so the one clearing rule above governs the published field as
      // well as the record.
      refusedPlay: this.#refusedPlay ?? null,
      // Filled from the record for the reason above, and written on every pass
      // for the same reason: the one clearing rule in `setProvider` governs the
      // published field as well as the record it is copied from.
      refusedCommand: this.#refusedCommand ?? null,
      error: explicitProviderError
        ? freezeError(patch.error)
        : this.#hasAutoplayConfigurationError
          ? nextLifecycle === 'error' &&
            this.#state.error?.category !== 'configuration'
            ? this.#state.error
            : autoplayConfigurationError()
          : // A notice waits behind whatever failure the slot already holds,
            // not only behind a fatal one: the `provider` error a refused
            // autoplay attempt publishes keeps the slot too, and the notice
            // becomes visible when it clears (#235).
            //
            // The notices themselves are ranked rather than ordered, so which
            // one a consumer sees is a function of what was refused and of
            // nothing else (#368). Where they tie, the order they are offered
            // in decides, and it is the order this always expressed: what
            // already stands, then the provider's own notice, then a refused
            // consumer URL — the provider reported something about the source
            // that is about to play, and that one is about a prop beside it
            // (#330).
            (standingFailure ??
            mostImportantNotice(
              standingNotice,
              this.#configurationNotice,
              this.#refusedUrlNotice
            ) ??
            null)
    };
    this.#setState(nextState);
  };

  // The two configurations that outlive a provider — the autoplay conflict and
  // a refused consumer URL — re-applied over a state rebuilt from scratch. Not
  // `#configurationNotice`, which is held in a field too but belongs to one
  // provider and is cleared immediately above the call site. `setProvider`
  // resets to `createInitialPlayerState()` without going through `#applyPatch`,
  // so these two would otherwise be dropped on every attach — which for a
  // refused consumer URL is the common case, not an edge one, because the
  // poster reports before the provider loads (#330). The two are ranked as
  // `#applyPatch` ranks them.
  #withHeldConfiguration = (state: PlayerState): PlayerState =>
    this.#hasAutoplayConfigurationError
      ? {
          ...state,
          autoplay: 'failed',
          autoplayRecovered: false,
          error: autoplayConfigurationError()
        }
      : this.#refusedUrlNotice
        ? { ...state, error: this.#refusedUrlNotice }
        : state;

  #synchronizeAutoplay = (): void => {
    const provider = this.#provider;
    const generation = this.#generation;
    if (
      !provider ||
      this.#autoplayMode === false ||
      this.#hasAutoplayConfigurationError ||
      this.#state.lifecycle !== 'ready' ||
      this.#state.activation !== 'ready' ||
      this.#autoplayAttemptGeneration === generation ||
      // Declined rather than dropped: the load chain re-runs this once `load()`
      // has resolved for this generation (#87).
      this.#loadedGeneration !== generation
    ) {
      return;
    }

    const mode = this.#autoplayMode;
    const revision = this.#autoplayConfigurationRevision;
    this.#autoplayAttemptGeneration = generation;
    // The attempt is declined here, at the one place an attempt is made, and
    // nowhere near `configureAutoplay` — because what keeps the poster over the
    // frame through a suppression is not this field at all, and is not a check
    // for `'suppressed'` anywhere. Two things upstream in React do it, and both
    // are silent about the states they cover: `Root`'s `loadeddata` gate reads
    // the `autoplay` *prop*, so that prop must keep arriving un-cleared; and
    // that gate early-returns on every autoplay state that is not `'started'`
    // rather than naming the ones it covers, so `'suppressed'` keeps the poster
    // up by falling through it, exactly as `'idle'` and `'blocked'` do.
    //
    // Implement suppression by having a consumer or `Root` pass
    // `autoplay={false}`, or teach that early return to enumerate states, and
    // the gate opens on a paused first frame with no cover over it and no
    // gesture that put it there — #242, arriving by a different route. What
    // guards the pair is the react test `keeps the poster visible when a frame
    // decodes under %s suppressed autoplay` (#311).
    //
    // Below every other guard rather than above them, deliberately: a player
    // that would not have autoplayed anyway must keep reporting why it did not,
    // so `'suppressed'` never stands in for a mode that was never set, for the
    // configuration error, or for an activation that never got there.
    if (!this.#autoplayIgnoreReducedMotion && prefersReducedMotion()) {
      this.#applyPatch({ autoplay: 'suppressed' });
      return;
    }
    this.#autoplayRecoveryPending = false;
    this.#applyPatch({ autoplay: 'attempting' });
    if (!this.#isCurrentAutoplayAttempt(provider, generation, revision, mode))
      return;
    void this.#attemptAutoplay(provider, generation, revision, mode);
  };

  #attemptAutoplay = async (
    provider: ProviderAdapter,
    generation: number,
    revision: number,
    mode: Exclude<AutoplayMode, false>
  ): Promise<void> => {
    if (
      mode === 'muted' &&
      !(await this.#muteForAutoplay(provider, generation, revision, mode))
    )
      return;

    const playResult = await this.#playWithOrigin(
      provider,
      generation,
      'autoplay'
    );
    if (!this.#isCurrentAutoplayAttempt(provider, generation, revision, mode))
      return;
    if (playResult.ok) return;
    if (
      mode === 'audible-then-muted' &&
      playResult.reason === 'blocked' &&
      // The collision between `'audible-then-muted'` and a controlled
      // `muted={false}` resolves by suppressing the recovery, not by rejecting
      // the configuration: an audible attempt under a controlled unmuted state
      // is legitimate, and muting to recover would override a value the
      // consumer owns, which this library never does. The attempt therefore
      // ends `'blocked'`, exactly as `'audible'` would (#306). `'muted'` keeps
      // its up-front configuration error, which is a different case: there the
      // consumer asked for two contradictory things at once.
      this.#autoplayControlledMuted !== false
    ) {
      await this.#recoverMutedAutoplay(
        provider,
        generation,
        revision,
        mode,
        playResult
      );
      return;
    }
    this.#applyAutoplayFailure(
      playResult,
      provider,
      generation,
      revision,
      mode
    );
  };

  // Exactly one retry, and only from a policy refusal: retrying a decode error
  // or a provider fault muted would change nothing about why it failed (#306).
  //
  // Which providers this reaches was established per adapter, not assumed:
  // - Native maps a `NotAllowedError` to `reason: 'blocked'`
  //   (`provider-native/src/adapter-values.ts:104-119`), and HLS delegates
  //   `play` to it verbatim (`provider-hls/src/playback.ts:44`). Both recover.
  // - Vimeo maps the same error name (`provider-vimeo/src/adapter-values.ts:65`)
  //   off a promise the SDK rejects, so it recovers wherever the SDK names the
  //   rejection that way.
  // - YouTube throws nothing. It reports `'blocked'` when the player has not
  //   reached playing or buffering inside its confirmation window
  //   (`provider-youtube/src/playback.ts:159-206`), so the recovery does run,
  //   only after that window rather than at the refusal.
  // - Wistia does NOT recover. It carries the same error-name mapping, but
  //   `player.play()` is synchronous and returns nothing, so
  //   `runWistiaCommand` resolves `{ ok: true }` whatever the browser did
  //   (`provider-wistia/src/adapter-values.ts:111-122`). No refusal reaches
  //   here to retry from. Making Wistia report one is a separate change.
  #recoverMutedAutoplay = async (
    provider: ProviderAdapter,
    generation: number,
    revision: number,
    mode: Exclude<AutoplayMode, false>,
    // The refusal the audible attempt already reported. It is what the attempt
    // settles on if the retry cannot be issued at all: nothing about the policy
    // refusal became less true because the provider cannot mute (#306).
    blockedResult: Extract<CommandResult, { ok: false }>
  ): Promise<void> => {
    if (
      !(await this.#muteForAutoplay(
        provider,
        generation,
        revision,
        mode,
        blockedResult
      ))
    )
      return;
    this.#autoplayRecoveryPending = true;
    const retryResult = await this.#playWithOrigin(
      provider,
      generation,
      'autoplay'
    );
    if (!this.#isCurrentAutoplayAttempt(provider, generation, revision, mode)) {
      this.#autoplayRecoveryPending = false;
      return;
    }
    if (!retryResult.ok) {
      this.#autoplayRecoveryPending = false;
      this.#applyAutoplayFailure(
        retryResult,
        provider,
        generation,
        revision,
        mode
      );
    }
  };

  // Mutes ahead of a play command. Returns false when the caller must stop --
  // the attempt was superseded, or the mute failed and the attempt has already
  // been settled. The two callers settle a mute failure differently, so the
  // result to settle on is passed in: `#attemptAutoplay` has nothing to report
  // but the mute failure itself, while the recovery keeps the audible refusal
  // it already observed (#306).
  #muteForAutoplay = async (
    provider: ProviderAdapter,
    generation: number,
    revision: number,
    mode: Exclude<AutoplayMode, false>,
    settleWith?: Extract<CommandResult, { ok: false }>
  ): Promise<boolean> => {
    const muteResult = await this.#providerCommand(provider, 'mute');
    if (!this.#isCurrentAutoplayAttempt(provider, generation, revision, mode))
      return false;
    if (muteResult.ok) return true;
    this.#applyAutoplayFailure(
      settleWith ?? muteResult,
      provider,
      generation,
      revision,
      mode
    );
    return false;
  };

  #applyAutoplayFailure = (
    result: Extract<CommandResult, { ok: false }>,
    provider: ProviderAdapter,
    generation: number,
    revision: number,
    mode: Exclude<AutoplayMode, false>
  ): void => {
    if (
      !this.#isCurrentAutoplayAttempt(provider, generation, revision, mode) ||
      this.#state.autoplay !== 'attempting'
    )
      return;
    this.#applyPatch({
      autoplay: result.reason === 'blocked' ? 'blocked' : 'failed',
      error: result.error ?? null
    });
  };

  #isCurrentAutoplayAttempt = (
    provider: ProviderAdapter,
    generation: number,
    revision: number,
    mode: Exclude<AutoplayMode, false>
  ): boolean =>
    provider === this.#provider &&
    generation === this.#generation &&
    revision === this.#autoplayConfigurationRevision &&
    mode === this.#autoplayMode &&
    !this.#hasAutoplayConfigurationError;

  // The one funnel every play command passes through — `playWithOrigin` for the
  // API and for user gestures, `#attemptAutoplay` and `#recoverMutedAutoplay`
  // for autoplay's own — so recording the attempt here records all of them, and
  // records it before the command is even issued. The refusal a command settles
  // on is recorded here for the same reason, on the way back out (#361).
  #playWithOrigin = async (
    provider: ProviderAdapter,
    generation: number,
    origin: PlayerEventOrigin
  ): Promise<CommandResult> => {
    const attempt = { generation };
    this.#playAttempt = attempt;
    const result = await this.#commandWithOrigin(
      provider,
      { kind: 'playback', generation, origin, playback: 'playing' },
      'play'
    );
    // The refusal is recorded on the way back out through the same funnel, so
    // one site covers the API, a user gesture and autoplay's own attempt alike
    // — and the caller's `CommandResult` is handed on exactly as it arrived.
    // This publishes the refusal to consumers who did not issue the command;
    // it does not take it away from the one who did (#361).
    //
    // Three things have to hold, and each one is a way the published condition
    // — the last play command was refused and nothing has played since — can be
    // false by the time a command settles. Commands settle out of order, so
    // none of them can be assumed:
    //
    // - This is still the attempt the record names. A later play replaces the
    //   record, so an earlier one settling afterwards is not the last command;
    //   a patch confirming playback clears it, so a command playback outran is
    //   not one nothing has played since. Reference identity answers both at
    //   once, which is why the record is an object and not the generation it
    //   carries: two plays against one provider share a generation.
    // - The generation has not moved on. `setProvider` bumps it on every
    //   attach, swap and detach, so a refusal that outlived its media describes
    //   nothing a consumer could act on.
    // - Playback is not confirmed `'playing'` right now. A `play()` refused
    //   against media already playing — the viewer started it from the
    //   provider's own controls — draws no patch of its own, so the attempt
    //   record still stands, and nothing above catches it. Publishing there
    //   would state that a play was refused and nothing is playing while
    //   something demonstrably is, and the clearing rule would take it back on
    //   whatever unrelated patch arrived next, which puts the lifetime of a
    //   consumer's presentation in the hands of a `timeupdate`. The refusal is
    //   dropped instead. It is not lost to the party with a stake in it: the
    //   caller gets the same `CommandResult` either way, and this field exists
    //   for the consumer who is NOT the caller, to whom "your play was refused"
    //   over playing media is not a true thing to say (#361). The alternative —
    //   publish it because a command really was refused — was rejected on those
    //   two grounds, contradiction and lifetime, not on principle.
    if (
      !result.ok &&
      this.#playAttempt === attempt &&
      generation === this.#generation &&
      this.#state.playback !== 'playing'
    ) {
      this.#refusedPlay = Object.freeze({ origin, reason: result.reason });
      // Published through an empty patch, which rebuilds the snapshot from the
      // controller's own records and fans it out: nothing about the player
      // itself moved — playback is exactly where the refusal found it — so
      // there is no provider patch to carry this, and `refusedPlay` is filled
      // from `#refusedPlay` rather than from a key, so there is no key to
      // state. `#resolveRefusedUrlNotice` reaches for the same empty patch, but
      // only where the notice it is withdrawing does not hold the error slot;
      // where it does, that withdrawal has a key to state and states it.
      this.#applyPatch({});
    }
    return result;
  };

  #pauseWithOrigin = (
    provider: ProviderAdapter,
    generation: number,
    origin: PlayerEventOrigin
  ): Promise<CommandResult> =>
    this.#commandWithOrigin(
      provider,
      { kind: 'playback', generation, origin, playback: 'paused' },
      'pause'
    );

  #seekWithOrigin = (
    name: 'seekTo' | 'seekBy',
    value: number,
    origin: PlayerEventOrigin
  ): Promise<CommandResult> => {
    this.#pendingOrigins.delete('seek');
    const provider = this.#provider;
    // One command to a consumer, whichever entry point they reached it by: a
    // viewer scrubbed, and the difference between an absolute and a relative
    // target is not part of the refusal.
    if (!provider) return Promise.resolve(this.#refuseCommand('seek', origin));
    return this.#commandWithOrigin(
      provider,
      { kind: 'seek', generation: this.#generation, origin },
      name,
      value
    );
  };

  // Issues a command that the provider will confirm later, holding the origin
  // it was asked with until that confirmation arrives. A command that fails has
  // nothing coming to confirm it, so it drops its own request — and only its
  // own: a newer request for the same kind has already superseded it, and the
  // provider it was issued against may no longer be the one attached.
  #commandWithOrigin = async (
    provider: ProviderAdapter,
    request: PendingOrigin,
    name: keyof Pick<ProviderAdapter, 'play' | 'pause' | 'seekTo' | 'seekBy'>,
    value?: number
  ): Promise<CommandResult> => {
    this.#pendingOrigins.set(request.kind, request);
    const result = await this.#providerCommand(provider, name, value);
    if (
      !result.ok &&
      provider === this.#provider &&
      request.generation === this.#generation &&
      this.#pendingOrigins.get(request.kind) === request
    ) {
      this.#pendingOrigins.delete(request.kind);
    }
    return result;
  };

  #consumePendingOrigin = (
    kind: PendingOriginKind,
    generation: number,
    playback?: PlaybackState
  ): PlayerEventOrigin | undefined => {
    const pending = this.#pendingOrigins.get(kind);
    if (
      !pending ||
      pending.generation !== generation ||
      (pending.kind === 'playback' && pending.playback !== playback)
    )
      return undefined;
    this.#pendingOrigins.delete(kind);
    return pending.origin;
  };

  #emitEvent = (event: ProviderEvent): void => {
    const completeEvent = {
      ...event,
      provider: event.provider ?? this.#state.provider,
      timestamp: event.timestamp ?? Date.now()
    } as PlayerEvent;
    this.#eventListeners
      .get(completeEvent.type)
      ?.forEach((listener) => notifySafely(listener, completeEvent));
  };

  #handleLifecycleFailure = (cause: unknown, generation: number): void => {
    if (generation !== this.#generation) return;
    this.#applyPatch({
      lifecycle: 'error',
      activation: 'error',
      error: toProviderError(cause)
    });
  };
}
