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
  TextCue,
  TimeRange
} from './types.js';

export { detectSource } from './source-detection.js';

export type {
  AutoplayConfigurationOptions,
  AutoplayMode,
  Availability,
  CaptionRendering,
  CommandFailureReason,
  CommandResult,
  HlsEngine,
  HlsSource,
  MediaDimensions,
  PlaybackState,
  PlayerCapabilities,
  PlayerError,
  PlayerErrorCategory,
  PlayerEvent,
  PlayerEventDetailMap,
  PlayerEventFor,
  PlayerEventOrigin,
  PlayerEventType,
  PlayerLiveState,
  PlayerProvider,
  PlayerQuality,
  PlayerSource,
  PlayerState,
  PreProviderActivation,
  ProviderAdapter,
  ProviderEvent,
  ProviderEventFor,
  ProviderStateListener,
  ProviderStatePatch,
  ResolvedPlayerSource,
  SourceDetectionFailure,
  SourceDetectionFailureReason,
  SourceDetectionResult,
  SourceDetectionSuccess,
  TextCue,
  TextTrack,
  TextTrackKind,
  TextTrackReadiness,
  TimeRange,
  VideoFileSource,
  VimeoSource,
  YouTubeSource
} from './types.js';

// `TextTrack.label` is a human label, so it must never be empty: providers
// hand their raw label through here and get a language-derived one back when
// there is nothing usable. A `<track srclang="en">` with no `label` would
// otherwise render a menu item with an empty accessible name.
//
// The language is rendered in itself ("français", not "French") wherever it
// has its own display data, which matches how caption menus name languages
// elsewhere. `fallback: 'none'` is what keeps that honest: without it, a code
// with no display name of its own gets one invented in the runtime's locale
// ("und" becomes "root", "mul" becomes "Multiple languages" or
// "multilingue"), so we take the raw code instead.
export const textTrackLabel = (
  label: string | null | undefined,
  language: string | null | undefined
): string => {
  const trimmedLabel = label?.trim();
  if (trimmedLabel) return trimmedLabel;
  const code = language?.trim();
  if (!code) return 'Unknown';
  try {
    return (
      new Intl.DisplayNames([code], {
        type: 'language',
        fallback: 'none'
      }).of(code) ?? code
    );
  } catch {
    // A malformed language tag throws; the raw code still beats an empty name.
    return code;
  }
};

const freezeAvailability = (availability: Availability): Availability =>
  Object.freeze({ ...availability });

const freezeCapabilities = (
  capabilities: PlayerCapabilities
): PlayerCapabilities =>
  Object.freeze({
    seek: freezeAvailability(capabilities.seek),
    setVolume: freezeAvailability(capabilities.setVolume),
    setPlaybackRate: freezeAvailability(capabilities.setPlaybackRate),
    selectQuality: freezeAvailability(capabilities.selectQuality),
    selectTextTrack: freezeAvailability(capabilities.selectTextTrack),
    fullscreen: freezeAvailability(capabilities.fullscreen),
    pictureInPicture: freezeAvailability(capabilities.pictureInPicture),
    airPlay: freezeAvailability(capabilities.airPlay),
    customControls: freezeAvailability(capabilities.customControls)
  });

const freezeError = (error: PlayerError): PlayerError =>
  Object.freeze({ ...error });

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
    provider: null,
    hlsEngine: null,
    quality: null,
    qualities: Object.freeze([]),
    selectedQualityId: null,
    capabilities: initialCapabilities(),
    error: null,
    textTracks: Object.freeze([]),
    selectedTextTrackId: null,
    captionRendering: 'unavailable',
    commandsReady: false
  });

const orderedRanges = (
  ranges: ReadonlyArray<TimeRange>
): ReadonlyArray<TimeRange> =>
  Object.freeze(
    ranges
      .map(({ end, start }) => Object.freeze({ end, start }))
      .sort((left, right) => left.start - right.start)
  );

const toProviderError = (cause: unknown): PlayerError =>
  freezeError({
    category: 'provider',
    fatal: false,
    recoverable: true,
    message:
      cause instanceof Error ? cause.message : 'The provider command failed.',
    cause
  });

const autoplayConfigurationError = (): PlayerError =>
  freezeError({
    category: 'configuration',
    fatal: false,
    recoverable: true,
    message: 'Muted autoplay conflicts with a controlled unmuted state.'
  });

const destroyProviderSafely = (provider: ProviderAdapter): void => {
  try {
    void Promise.resolve(provider.destroy()).catch(() => undefined);
  } catch {
    // Provider cleanup must not escape the controller boundary.
  }
};

const unsubscribeSafely = (unsubscribe: (() => void) | undefined): void => {
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
const notifySafely = <Value>(
  listener: (value: Value) => void,
  value: Value
): void => {
  try {
    listener(value);
  } catch (cause) {
    queueMicrotask(() => {
      throw cause;
    });
  }
};

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
  // The generation whose `load()` has run. No play command may be issued before
  // it: `load()` aborts a play already in flight, per the HTML media spec. This
  // is reachable because a provider may report ready from inside `attach()` —
  // `provider-native` does exactly that when the media already has metadata —
  // while `load()` is only queued once `attach()` returns (#87).
  #loadedGeneration: number | undefined;
  #pendingPlaybackOrigin:
    | {
        readonly generation: number;
        readonly origin: PlayerEventOrigin;
        readonly playback: PlaybackState;
      }
    | undefined;

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
    if (this.#pendingPlaybackOrigin?.origin === 'autoplay') {
      this.#pendingPlaybackOrigin = undefined;
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
    this.#pendingPlaybackOrigin = undefined;
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
            ? this.#consumePendingPlaybackOrigin(generation, patch.playback)
            : undefined;
        const originatingEvent = event
          ? {
              ...event,
              origin:
                ((event.type === 'play' && patch.playback === 'playing') ||
                  (event.type === 'pause' && patch.playback === 'paused')) &&
                confirmedPlaybackOrigin
                  ? confirmedPlaybackOrigin
                  : event.origin,
              provider: provider.provider
            }
          : undefined;
        this.#applyPatch(patch, false);
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
    this.#pendingPlaybackOrigin = undefined;
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
    this.#command('seekTo', time);
  seekBy = (offset: number): Promise<CommandResult> =>
    this.#command('seekBy', offset);
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
      autoplay: this.#hasAutoplayConfigurationError
        ? 'failed'
        : patch.playback === 'playing' && this.#state.autoplay === 'attempting'
          ? 'started'
          : acceptAutoplay
            ? (patch.autoplay ?? this.#state.autoplay)
            : this.#state.autoplay,
      error: explicitProviderError
        ? freezeError(patch.error)
        : this.#hasAutoplayConfigurationError
          ? nextLifecycle === 'error' &&
            this.#state.error?.category !== 'configuration'
            ? this.#state.error
            : autoplayConfigurationError()
          : patch.lifecycle === 'ready' && patch.error === undefined
            ? null
            : patch.error === undefined
              ? this.#state.error
              : patch.error === null
                ? null
                : freezeError(patch.error)
    };
    this.#setState(nextState);
  };

  #withAutoplayConfiguration = (state: PlayerState): PlayerState =>
    this.#hasAutoplayConfigurationError
      ? {
          ...state,
          autoplay: 'failed',
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
    if (mode === 'muted') {
      const muteResult = await this.#providerCommand(provider, 'mute');
      if (!this.#isCurrentAutoplayAttempt(provider, generation, revision, mode))
        return;
      if (!muteResult.ok) {
        this.#applyAutoplayFailure(
          muteResult,
          provider,
          generation,
          revision,
          mode
        );
        return;
      }
    }

    const playResult = await this.#playWithOrigin(
      provider,
      generation,
      'autoplay'
    );
    if (!this.#isCurrentAutoplayAttempt(provider, generation, revision, mode))
      return;
    if (!playResult.ok) {
      this.#applyAutoplayFailure(
        playResult,
        provider,
        generation,
        revision,
        mode
      );
    }
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

  #playWithOrigin = async (
    provider: ProviderAdapter,
    generation: number,
    origin: PlayerEventOrigin
  ): Promise<CommandResult> => {
    const request = { generation, origin, playback: 'playing' as const };
    this.#pendingPlaybackOrigin = request;
    const result = await this.#providerCommand(provider, 'play');
    if (
      !result.ok &&
      provider === this.#provider &&
      generation === this.#generation &&
      this.#pendingPlaybackOrigin === request
    ) {
      this.#pendingPlaybackOrigin = undefined;
    }
    return result;
  };

  #pauseWithOrigin = async (
    provider: ProviderAdapter,
    generation: number,
    origin: PlayerEventOrigin
  ): Promise<CommandResult> => {
    const request = { generation, origin, playback: 'paused' as const };
    this.#pendingPlaybackOrigin = request;
    const result = await this.#providerCommand(provider, 'pause');
    if (
      !result.ok &&
      provider === this.#provider &&
      generation === this.#generation &&
      this.#pendingPlaybackOrigin === request
    ) {
      this.#pendingPlaybackOrigin = undefined;
    }
    return result;
  };

  #consumePendingPlaybackOrigin = (
    generation: number,
    playback: PlaybackState
  ): PlayerEventOrigin | undefined => {
    const pending = this.#pendingPlaybackOrigin;
    if (
      !pending ||
      pending.generation !== generation ||
      pending.playback !== playback
    )
      return undefined;
    this.#pendingPlaybackOrigin = undefined;
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

// Media Session ownership arbitration.
//
// The Media Session API exposes exactly ONE `navigator.mediaSession` per
// document. When a page hosts several Reely roots they must share that single
// surface, so a coordinator arbitrates it: the most-recently-*playing* root
// owns the metadata and action handlers. A root releases ownership when another
// root starts playing, on teardown, or on unmount — and it NEVER clears
// handlers it does not currently own.
//
// This does NOT prevent simultaneous playback: two roots can play at once, and
// only the lock-screen/hardware-key surface follows the most recent one.
// Enforcing a single active player (exclusive playback groups) is a separate,
// deferred concern.

export type MediaSessionArtwork = {
  readonly src: string;
  readonly sizes?: string;
  readonly type?: string;
};

// Explicit metadata supplied by the consumer. Reely never scrapes this from the
// media source; a caller passes exactly what the lock screen should show.
export type MediaMetadataInput = {
  readonly title?: string;
  readonly artist?: string;
  readonly album?: string;
  readonly artwork?: ReadonlyArray<MediaSessionArtwork>;
};

export type MediaSessionPositionState = {
  readonly duration?: number;
  readonly position?: number;
  readonly playbackRate?: number;
};

type MediaSessionActionDetails = {
  readonly seekTime?: number;
  readonly seekOffset?: number;
};

type MediaSessionActionHandler =
  ((details: MediaSessionActionDetails) => void) | null;

// The subset of `navigator.mediaSession` the coordinator touches. Modeled as a
// structural type so it can be driven by a real MediaSession or a fake in tests.
//
// `action` is the exact set the coordinator registers, not `string`: the DOM's
// `setActionHandler` only accepts its own `MediaSessionAction` union, so a
// `string` parameter made this type unsatisfiable by the very object it models
// — every caller needed `as unknown as MediaSessionLike`. Narrowing it makes a
// real `navigator.mediaSession` assignable, and a fake still only has to
// implement these five. Asserted by test/media-session.test.ts.
export type MediaSessionLike = {
  metadata: unknown;
  playbackState?: string;
  setActionHandler: (
    action: 'play' | 'pause' | 'seekto' | 'seekforward' | 'seekbackward',
    handler: MediaSessionActionHandler
  ) => void;
  setPositionState?: (state?: MediaSessionPositionState) => void;
};

export type MediaSessionActions = {
  readonly play: () => void;
  readonly pause: () => void;
  readonly seekTo: (time: number) => void;
  readonly seekBy: (offset: number) => void;
};

export type MediaSessionRootConfig = {
  readonly actions: MediaSessionActions;
  readonly metadata?: MediaMetadataInput | null;
};

export type MediaSessionRoot = {
  // Claim ownership and mark the shared surface as playing.
  readonly notifyPlaying: () => void;
  // Mark the shared surface as paused, keeping ownership.
  readonly notifyPaused: () => void;
  // Replace this root's metadata; writes through only while it owns the surface.
  readonly setMetadata: (metadata: MediaMetadataInput | null) => void;
  // Report scrubber position; writes through only while it owns the surface.
  readonly setPositionState: (state: MediaSessionPositionState | null) => void;
  // Release ownership (teardown / unmount / source change). Clears the shared
  // surface only if this root currently owns it.
  readonly release: () => void;
};

export type MediaSessionCoordinator = {
  readonly register: (config: MediaSessionRootConfig) => MediaSessionRoot;
  // Current owner, exposed for inspection and tests.
  readonly owner: () => MediaSessionRoot | null;
};

export type MediaSessionBinding = {
  readonly setMetadata: (metadata: MediaMetadataInput | null) => void;
  readonly release: () => void;
};

const DEFAULT_SEEK_OFFSET = 10;

const MEDIA_SESSION_ACTIONS = [
  'play',
  'pause',
  'seekto',
  'seekforward',
  'seekbackward'
] as const;

const globalMediaMetadata = ():
  (new (init: MediaMetadataInput) => unknown) | undefined => {
  const scope = globalThis as {
    MediaMetadata?: new (init: MediaMetadataInput) => unknown;
  };
  return typeof scope.MediaMetadata === 'function'
    ? scope.MediaMetadata
    : undefined;
};

const toMediaMetadata = (metadata: MediaMetadataInput): unknown => {
  const Ctor = globalMediaMetadata();
  const init = {
    ...metadata,
    artwork: metadata.artwork ? metadata.artwork.map((art) => ({ ...art })) : []
  };
  if (!Ctor) return init;
  try {
    return new Ctor(init);
  } catch {
    return init;
  }
};

// Internal on purpose: a second coordinator over the same MediaSession would
// hand out roots that do not know about each other's ownership, which is the
// exact thing the one-per-document rule exists to prevent.
// `getMediaSessionCoordinator` is how a caller gets one.
const createMediaSessionCoordinator = (
  session: MediaSessionLike
): MediaSessionCoordinator => {
  let owner: MediaSessionRoot | null = null;

  const applyMetadata = (metadata: MediaMetadataInput | null): void => {
    session.metadata = metadata ? toMediaMetadata(metadata) : null;
  };

  const clearSurface = (): void => {
    for (const action of MEDIA_SESSION_ACTIONS) {
      session.setActionHandler(action, null);
    }
    session.metadata = null;
    session.playbackState = 'none';
    if (typeof session.setPositionState === 'function') {
      session.setPositionState(undefined);
    }
  };

  const wireHandlers = (actions: MediaSessionActions): void => {
    session.setActionHandler('play', () => actions.play());
    session.setActionHandler('pause', () => actions.pause());
    session.setActionHandler('seekto', (details) => {
      if (typeof details.seekTime === 'number')
        actions.seekTo(details.seekTime);
    });
    session.setActionHandler('seekforward', (details) =>
      actions.seekBy(details.seekOffset ?? DEFAULT_SEEK_OFFSET)
    );
    session.setActionHandler('seekbackward', (details) =>
      actions.seekBy(-(details.seekOffset ?? DEFAULT_SEEK_OFFSET))
    );
  };

  const register = (config: MediaSessionRootConfig): MediaSessionRoot => {
    let metadata = config.metadata ?? null;
    let released = false;
    const owns = (): boolean => owner === root && !released;

    const root: MediaSessionRoot = {
      notifyPlaying: () => {
        if (released) return;
        owner = root;
        wireHandlers(config.actions);
        applyMetadata(metadata);
        session.playbackState = 'playing';
      },
      notifyPaused: () => {
        if (!owns()) return;
        session.playbackState = 'paused';
      },
      setMetadata: (next) => {
        metadata = next;
        if (owns()) applyMetadata(next);
      },
      setPositionState: (state) => {
        if (!owns() || typeof session.setPositionState !== 'function') return;
        session.setPositionState(state ?? undefined);
      },
      release: () => {
        if (released) return;
        released = true;
        // Only clear the shared surface if this root is the current owner;
        // releasing a root that already lost ownership must not disturb the
        // new owner's handlers.
        if (owner === root) {
          clearSurface();
          owner = null;
        }
      }
    };
    return root;
  };

  return {
    register,
    owner: () => owner
  };
};

// One coordinator per document, keyed by the MediaSession object identity. This
// is what enforces the "single navigator.mediaSession per document" rule when
// several roots resolve the coordinator independently.
const coordinators = new WeakMap<MediaSessionLike, MediaSessionCoordinator>();

export const getMediaSessionCoordinator = (
  session: MediaSessionLike
): MediaSessionCoordinator => {
  const existing = coordinators.get(session);
  if (existing) return existing;
  const created = createMediaSessionCoordinator(session);
  coordinators.set(session, created);
  return created;
};

// Binds a controller's confirmed playback to a coordinator root: the root
// claims ownership when the controller starts playing, keeps ownership while
// paused, and routes lock-screen actions back to the controller. React calls
// `release()` from its effect cleanup, so a source change or unmount tears the
// binding down (and clears the surface only when this root still owns it).
export const bindMediaSession = (
  controller: PlayerController,
  coordinator: MediaSessionCoordinator,
  options: { readonly metadata?: MediaMetadataInput | null } = {}
): MediaSessionBinding => {
  const root = coordinator.register({
    metadata: options.metadata ?? null,
    actions: {
      play: () => void controller.play(),
      pause: () => void controller.pause(),
      seekTo: (time) => void controller.seekTo(time),
      seekBy: (offset) => void controller.seekBy(offset)
    }
  });

  let lastPlayback: PlaybackState | undefined;
  let positionCleared = false;

  const unsubscribe = controller.subscribe((state) => {
    if (state.playback !== lastPlayback) {
      lastPlayback = state.playback;
      if (state.playback === 'playing') root.notifyPlaying();
      else root.notifyPaused();
    }
    if (state.duration !== null && Number.isFinite(state.duration)) {
      // Clamped, not passed through: the Media Session spec makes a position
      // outside [0, duration] a TypeError, and WebKit settles `currentTime` a
      // fraction PAST `duration` once a clip ends (measured 1.000131 against a
      // duration of 1). Reporting the raw pair threw on ordinary end of
      // playback (#95).
      root.setPositionState({
        duration: state.duration,
        position: Math.min(Math.max(state.currentTime, 0), state.duration),
        playbackRate: state.playbackRate
      });
      positionCleared = false;
    } else if (!positionCleared) {
      // Live/unknown duration: clear the stale finite position once (not every
      // tick) so the lock screen doesn't keep the last VOD position pinned.
      root.setPositionState(null);
      positionCleared = true;
    }
  });

  return {
    setMetadata: (metadata) => root.setMetadata(metadata),
    release: () => {
      unsubscribe();
      root.release();
    }
  };
};
