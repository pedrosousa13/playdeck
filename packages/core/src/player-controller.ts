import type {
  AutoplayConfigurationOptions,
  AutoplayMode,
  Availability,
  CommandResult,
  MediaDimensions,
  PlaybackState,
  PlayerCapabilities,
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
  TextCue
} from './types.js';

import {
  autoplayConfigurationError,
  destroyProviderSafely,
  freezeAvailability,
  freezeCapabilities,
  freezeError,
  notifySafely,
  orderedRanges,
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
// reach `explicitProviderError` and drive lifecycle or activation (#235).
const noticeIn = (patch: ProviderStatePatch): PlayerError | undefined =>
  patch.error &&
  patch.error.category === 'configuration' &&
  !patch.error.fatal &&
  patch.lifecycle !== 'error'
    ? patch.error
    : undefined;

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
  #captionRenderer: 'custom' | 'native' = 'custom';
  #hasAutoplayConfigurationError = false;
  #autoplayConfigurationRevision = 0;
  #autoplayAttemptGeneration: number | undefined;
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
  // The provider's first configuration rejection, held as controller state the
  // way `#hasAutoplayConfigurationError` holds the autoplay conflict: the state
  // has one error slot, so a notice left in the patch would be cleared by the
  // next patch that omits an `error` key, and would overwrite an error that
  // actually stopped playback. First one wins — two rejections in the same
  // attach would otherwise flap the slot — and it is dropped with the provider
  // that reported it (#235).
  #configurationNotice: PlayerError | undefined;

  configureAutoplay = (
    mode: AutoplayMode,
    options: AutoplayConfigurationOptions = {}
  ): void => {
    if (
      mode === this.#autoplayMode &&
      options.controlledMuted === this.#autoplayControlledMuted
    )
      return;
    const hadConfigurationError = this.#hasAutoplayConfigurationError;
    this.#autoplayMode = mode;
    this.#autoplayControlledMuted = options.controlledMuted;
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
    // provider — on a swap and on a detach alike (#235).
    this.#configurationNotice = undefined;
    if (!provider) {
      this.#setState(
        this.#withAutoplayConfiguration(createInitialPlayerState())
      );
      return;
    }

    this.#setState(
      this.#withAutoplayConfiguration({
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
        const notice = noticeIn(patch);
        if (notice) this.#configurationNotice ??= freezeError(notice);
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
    if (!provider) return Promise.resolve({ ok: false, reason: 'not-ready' });
    return this.#playWithOrigin(provider, this.#generation, origin);
  };
  pause = (): Promise<CommandResult> => this.pauseWithOrigin('api');
  pauseWithOrigin = (origin: PlayerEventOrigin): Promise<CommandResult> => {
    this.#pendingOrigins.delete('playback');
    const provider = this.#provider;
    if (!provider) return Promise.resolve({ ok: false, reason: 'not-ready' });
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
    if (!provider) return { ok: false, reason: 'not-ready' };
    return this.#providerCommand(provider, name, value);
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
    const nextAutoplay = this.#hasAutoplayConfigurationError
      ? ('failed' as const)
      : patch.playback === 'playing' && this.#state.autoplay === 'attempting'
        ? ('started' as const)
        : acceptAutoplay
          ? (patch.autoplay ?? this.#state.autoplay)
          : this.#state.autoplay;
    // What the patch alone says the slot should hold. A held notice fills in
    // only where this is `null`: it is the least important thing the slot can
    // carry, so it may take the slot but never take it from something else
    // (#235).
    const errorBeforeNotice =
      patch.lifecycle === 'ready' && patch.error === undefined
        ? null
        : patch.error === undefined
          ? this.#state.error
          : patch.error === null
            ? null
            : freezeError(patch.error);
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
      error: explicitProviderError
        ? freezeError(patch.error)
        : this.#hasAutoplayConfigurationError
          ? nextLifecycle === 'error' &&
            this.#state.error?.category !== 'configuration'
            ? this.#state.error
            : autoplayConfigurationError()
          : // A notice waits behind whatever the slot already holds, not only
            // behind a fatal one: the `provider` error a refused autoplay
            // attempt publishes keeps the slot too, and the notice becomes
            // visible when it clears (#235).
            (errorBeforeNotice ?? this.#configurationNotice ?? null)
    };
    this.#setState(nextState);
  };

  #withAutoplayConfiguration = (state: PlayerState): PlayerState =>
    this.#hasAutoplayConfigurationError
      ? {
          ...state,
          autoplay: 'failed',
          autoplayRecovered: false,
          error: autoplayConfigurationError()
        }
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

  #playWithOrigin = (
    provider: ProviderAdapter,
    generation: number,
    origin: PlayerEventOrigin
  ): Promise<CommandResult> =>
    this.#commandWithOrigin(
      provider,
      { kind: 'playback', generation, origin, playback: 'playing' },
      'play'
    );

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
    if (!provider) return Promise.resolve({ ok: false, reason: 'not-ready' });
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
