export type PlaybackState = 'paused' | 'playing' | 'ended';

export type CommandFailureReason =
  'blocked' | 'unsupported' | 'not-ready' | 'provider-error';

export type PlayerErrorCategory =
  | 'configuration'
  | 'source'
  | 'network'
  | 'decode'
  | 'provider'
  | 'policy'
  | 'unsupported';

export type PlayerError = {
  readonly category: PlayerErrorCategory;
  readonly fatal: boolean;
  readonly recoverable: boolean;
  readonly message: string;
  readonly cause?: unknown;
};

export type TextTrackKind = 'subtitles' | 'captions';
export type TextTrackReadiness = 'idle' | 'loading' | 'loaded' | 'error';
export type CaptionRendering = 'custom' | 'native' | 'provider' | 'unavailable';

export type TextTrack = {
  readonly id: string;
  readonly label: string;
  readonly language: string | null;
  readonly kind: TextTrackKind;
  readonly readiness: TextTrackReadiness;
};

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

export type TextCue = {
  readonly id: string | null;
  readonly startTime: number;
  readonly endTime: number;
  readonly text: string;
};

export type CommandResult =
  | { ok: true }
  | { ok: false; reason: CommandFailureReason; error?: PlayerError };

export type AutoplayMode = false | 'muted' | 'audible';

export type AutoplayConfigurationOptions = {
  readonly controlledMuted?: boolean;
};

export type Availability =
  | { readonly status: 'available' }
  | {
      readonly status: 'unknown';
      readonly reason: 'not-ready' | 'provider-check';
    }
  | {
      readonly status: 'unavailable';
      readonly reason:
        'browser' | 'provider' | 'provider-plan' | 'source' | 'policy';
    };

export type TimeRange = { readonly start: number; readonly end: number };

// Normalized live status. `null` means the stream is not live or its liveness
// is not yet known. Derived from provider/seekable data (infinite/unknown
// duration, hls.js level info, a moving seekable window) — never from the
// source URL or filename.
export type PlayerLiveState = {
  readonly isLive: boolean;
  readonly atLiveEdge: boolean;
} | null;

export type PlayerProvider = 'native' | 'hls' | 'youtube' | 'vimeo';

export type HlsEngine = 'native' | 'hls.js';

export type PlayerQuality = {
  readonly height: number | null;
  readonly width: number | null;
  readonly bitrate: number | null;
};

export type PlayerCapabilities = {
  readonly seek: Availability;
  readonly setVolume: Availability;
  readonly setPlaybackRate: Availability;
  readonly selectQuality: Availability;
  readonly selectTextTrack: Availability;
  readonly fullscreen: Availability;
  readonly pictureInPicture: Availability;
  readonly airPlay: Availability;
  readonly customControls: Availability;
};

export type PlayerState = {
  readonly lifecycle: 'idle' | 'loading' | 'ready' | 'error';
  readonly activation:
    'dormant' | 'eligible' | 'loading-provider' | 'ready' | 'error';
  readonly playback: PlaybackState;
  readonly buffering: boolean;
  readonly seeking: boolean;
  readonly currentTime: number;
  readonly duration: number | null;
  readonly buffered: ReadonlyArray<TimeRange>;
  readonly seekable: ReadonlyArray<TimeRange>;
  readonly live: PlayerLiveState;
  readonly muted: boolean;
  readonly volume: number;
  readonly playbackRate: number;
  readonly fullscreen: boolean;
  readonly pictureInPicture: boolean;
  readonly autoplay: 'idle' | 'attempting' | 'started' | 'blocked' | 'failed';
  readonly provider: PlayerProvider | null;
  readonly hlsEngine: HlsEngine | null;
  readonly quality: PlayerQuality | null;
  readonly capabilities: PlayerCapabilities;
  readonly error: PlayerError | null;
  readonly textTracks: readonly TextTrack[];
  readonly selectedTextTrackId: string | null;
  readonly captionRendering: CaptionRendering;
};

export type PreProviderActivation =
  | {
      readonly activation: 'dormant' | 'eligible' | 'loading-provider';
    }
  | {
      readonly activation: 'error';
      readonly error: PlayerError;
    };

export type PlayerEventOrigin =
  'user' | 'api' | 'autoplay' | 'provider' | 'system';

export type PlayerEventDetailMap = {
  play: undefined;
  pause: undefined;
  ended: undefined;
  loading: undefined;
  ready: undefined;
  error: PlayerError;
  seeking: { readonly currentTime: number };
  seeked: { readonly currentTime: number };
  volumechange: { readonly muted: boolean; readonly volume: number };
  ratechange: { readonly playbackRate: number };
  fullscreenchange: { readonly fullscreen: boolean };
  pictureinpicturechange: { readonly pictureInPicture: boolean };
};

export type PlayerEventType = keyof PlayerEventDetailMap;

export type PlayerEventFor<Type extends PlayerEventType> = {
  readonly type: Type;
  readonly detail: PlayerEventDetailMap[Type];
  readonly origin: PlayerEventOrigin;
  readonly provider: PlayerProvider | null;
  readonly timestamp: number;
  readonly originalEvent?: unknown;
};

export type PlayerEvent = {
  [Type in PlayerEventType]: PlayerEventFor<Type>;
}[PlayerEventType];

export type ProviderStatePatch = Partial<PlayerState>;

export type ProviderEventFor<Type extends PlayerEventType> = Omit<
  PlayerEventFor<Type>,
  'provider' | 'timestamp'
> & {
  readonly provider?: PlayerProvider;
  readonly timestamp?: number;
};

export type ProviderEvent = {
  [Type in PlayerEventType]: ProviderEventFor<Type>;
}[PlayerEventType];

export type ProviderStateListener = (
  patch: ProviderStatePatch,
  event?: ProviderEvent
) => void;

export type VideoFileSource = {
  type: 'video';
  sources: ReadonlyArray<{ src: string; mimeType: string }>;
};

export type HlsSource = {
  type: 'hls';
  src: string;
  engine?: 'auto' | 'native' | 'hls.js';
};

export type YouTubeSource = { type: 'youtube'; videoId: string };

export type VimeoSource = { type: 'vimeo'; videoId: string; hash?: string };

export type PlayerSource =
  string | VideoFileSource | HlsSource | YouTubeSource | VimeoSource;

export type ResolvedPlayerSource = Exclude<PlayerSource, string>;

export type SourceDetectionFailureReason =
  'malformed-string' | 'unsupported-string' | 'invalid-source';

export type SourceDetectionSuccess = {
  status: 'success';
  input: PlayerSource;
  source: ResolvedPlayerSource;
};

export type SourceDetectionFailure = {
  status: 'failure';
  input: unknown;
  reason: SourceDetectionFailureReason;
  guidance: string;
};

export type SourceDetectionResult =
  SourceDetectionSuccess | SourceDetectionFailure;

export type ProviderAdapter = {
  provider: PlayerProvider;
  attach: () => void | Promise<void>;
  load: () => void | Promise<void>;
  destroy: () => void | Promise<void>;
  subscribe: (listener: ProviderStateListener) => () => void;
  play?: () => Promise<CommandResult>;
  pause?: () => Promise<CommandResult>;
  seekTo?: (time: number) => Promise<CommandResult>;
  seekBy?: (offset: number) => Promise<CommandResult>;
  selectQuality?: (height: number | null) => Promise<CommandResult>;
  mute?: () => Promise<CommandResult>;
  unmute?: () => Promise<CommandResult>;
  setVolume?: (volume: number) => Promise<CommandResult>;
  setPlaybackRate?: (rate: number) => Promise<CommandResult>;
  selectTextTrack?: (track: string | null) => Promise<CommandResult>;
  requestFullscreen?: () => Promise<CommandResult>;
  exitFullscreen?: () => Promise<CommandResult>;
  requestPictureInPicture?: () => Promise<CommandResult>;
  exitPictureInPicture?: () => Promise<CommandResult>;
  showAirPlayPicker?: () => Promise<CommandResult>;
  retry?: () => Promise<CommandResult>;
  subscribeCues?: (listener: (cues: readonly TextCue[]) => void) => () => void;
  setCaptionRenderer?: (mode: 'custom' | 'native') => void;
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
    capabilities: initialCapabilities(),
    error: null,
    textTracks: Object.freeze([]),
    selectedTextTrackId: null,
    captionRendering: 'unavailable'
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

const explicitObjectGuidance =
  'Pass an explicit source object with a supported type and the required fields.';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isYouTubeVideoId = (value: unknown): value is string =>
  isNonEmptyString(value) && /^[A-Za-z0-9_-]+$/.test(value);

const isVimeoVideoId = (value: unknown): value is string =>
  isNonEmptyString(value) && /^\d+$/.test(value);

const isVimeoHash = (value: unknown): value is string =>
  isNonEmptyString(value) && /^[A-Za-z0-9]+$/.test(value);

const failure = (
  input: unknown,
  reason: SourceDetectionFailureReason
): SourceDetectionFailure => ({
  status: 'failure',
  input,
  reason,
  guidance: explicitObjectGuidance
});

const sourceFromFileExtension = (
  input: string
): VideoFileSource | HlsSource | undefined => {
  const path = input.split(/[?#]/, 1)[0] ?? '';
  if (/\.mp4$/i.test(path)) {
    return { type: 'video', sources: [{ src: input, mimeType: 'video/mp4' }] };
  }
  if (/\.webm$/i.test(path)) {
    return { type: 'video', sources: [{ src: input, mimeType: 'video/webm' }] };
  }
  if (/\.m3u8$/i.test(path)) return { type: 'hls', src: input };
  return undefined;
};

const isYouTubeHost = (hostname: string): boolean =>
  hostname === 'youtube.com' ||
  hostname === 'www.youtube.com' ||
  hostname === 'm.youtube.com' ||
  hostname === 'music.youtube.com' ||
  hostname === 'youtu.be' ||
  hostname === 'www.youtu.be';

const isVimeoHost = (hostname: string): boolean =>
  hostname === 'vimeo.com' ||
  hostname === 'www.vimeo.com' ||
  hostname === 'player.vimeo.com';

const sourceFromYouTubeUrl = (url: URL): YouTubeSource | undefined => {
  if (!isYouTubeHost(url.hostname)) return undefined;

  const isShortUrl =
    url.hostname === 'youtu.be' || url.hostname === 'www.youtu.be';
  const watchVideoIds = url.searchParams.getAll('v');
  const shortUrlMatch = /^\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
  const embeddedVideoMatch = /^\/(?:embed|shorts)\/([A-Za-z0-9_-]+)$/.exec(
    url.pathname
  );
  const videoId = isShortUrl
    ? shortUrlMatch?.[1]
    : url.pathname === '/watch'
      ? watchVideoIds.length === 1
        ? watchVideoIds[0]
        : undefined
      : embeddedVideoMatch?.[1];

  return isYouTubeVideoId(videoId) ? { type: 'youtube', videoId } : undefined;
};

const sourceFromVimeoUrl = (url: URL): VimeoSource | undefined => {
  if (!isVimeoHost(url.hostname)) return undefined;

  const isPlayerUrl = url.hostname === 'player.vimeo.com';
  const playerMatch = /^\/video\/(\d+)(?:\/([A-Za-z0-9]+))?$/.exec(
    url.pathname
  );
  const canonicalMatch = /^\/(\d+)$/.exec(url.pathname);
  const videoId = isPlayerUrl ? playerMatch?.[1] : canonicalMatch?.[1];
  const pathHash = isPlayerUrl ? playerMatch?.[2] : undefined;
  const queryHashes = url.searchParams.getAll('h');
  const queryHash = queryHashes.length === 1 ? queryHashes[0] : undefined;

  if (!isVimeoVideoId(videoId)) return undefined;
  if (
    queryHashes.length > 1 ||
    (queryHashes.length === 1 && !isVimeoHash(queryHash))
  ) {
    return undefined;
  }
  if (pathHash !== undefined && !isVimeoHash(pathHash)) return undefined;

  const hash = queryHash ?? pathHash;
  return { type: 'vimeo', videoId, ...(hash ? { hash } : {}) };
};

const sourceFromExplicitObject = (
  input: Record<string, unknown>
): ResolvedPlayerSource | undefined => {
  if (input.type === 'video') {
    if (!Array.isArray(input.sources) || input.sources.length === 0)
      return undefined;
    if (
      !input.sources.every(
        (source) =>
          isRecord(source) &&
          isNonEmptyString(source.src) &&
          isNonEmptyString(source.mimeType)
      )
    ) {
      return undefined;
    }
    return input as VideoFileSource;
  }

  if (input.type === 'hls') {
    if (!isNonEmptyString(input.src)) return undefined;
    if (
      input.engine !== undefined &&
      input.engine !== 'auto' &&
      input.engine !== 'native' &&
      input.engine !== 'hls.js'
    ) {
      return undefined;
    }
    return input as HlsSource;
  }

  if (input.type === 'youtube') {
    return isYouTubeVideoId(input.videoId)
      ? (input as YouTubeSource)
      : undefined;
  }

  if (input.type === 'vimeo') {
    if (!isVimeoVideoId(input.videoId)) return undefined;
    if (input.hash !== undefined && !isVimeoHash(input.hash)) return undefined;
    return input as VimeoSource;
  }

  return undefined;
};

export const detectSource = (input: unknown): SourceDetectionResult => {
  if (typeof input === 'string') {
    if (!isNonEmptyString(input) || input !== input.trim()) {
      return failure(input, 'malformed-string');
    }

    if (/%(?![\da-f]{2})/i.test(input)) {
      return failure(input, 'malformed-string');
    }

    const scheme = input.match(/^([a-z][a-z\d+.-]*):/i)?.[1]?.toLowerCase();
    if (scheme && scheme !== 'http' && scheme !== 'https') {
      return failure(input, 'unsupported-string');
    }

    const isNetworkPath = input.startsWith('//');
    if (isNetworkPath && !/^\/\/[^/]/.test(input)) {
      return failure(input, 'malformed-string');
    }

    const urlInput = isNetworkPath
      ? `https:${input}`
      : scheme
        ? input
        : undefined;
    if (scheme && !/^https?:\/\//i.test(input)) {
      return failure(input, 'malformed-string');
    }

    let url: URL | undefined;
    if (urlInput) {
      try {
        url = new URL(urlInput);
      } catch {
        return failure(input, 'malformed-string');
      }
    }

    if (url) {
      if (isYouTubeHost(url.hostname)) {
        const source = sourceFromYouTubeUrl(url);
        return source
          ? { status: 'success', input, source }
          : failure(input, 'malformed-string');
      }
      if (isVimeoHost(url.hostname)) {
        const source = sourceFromVimeoUrl(url);
        return source
          ? { status: 'success', input, source }
          : failure(input, 'malformed-string');
      }
    }

    const fileSource = sourceFromFileExtension(input);
    if (fileSource) return { status: 'success', input, source: fileSource };

    return failure(input, 'unsupported-string');
  }

  if (isRecord(input)) {
    const source = sourceFromExplicitObject(input);
    if (source) return { status: 'success', input: source, source };
  }

  return failure(input, 'invalid-source');
};

export class PlayerController {
  #provider: ProviderAdapter | undefined;
  #unsubscribe: (() => void) | undefined;
  #cueUnsubscribe: (() => void) | undefined;
  #activeCues: readonly TextCue[] = Object.freeze([]);
  #cueListeners = new Set<(cues: readonly TextCue[]) => void>();
  #listeners = new Set<(state: PlayerState) => void>();
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
  #pendingPlaybackOrigin:
    | {
        readonly generation: number;
        readonly origin: PlayerEventOrigin;
        readonly playback: PlaybackState;
      }
    | undefined;
  #readyWaiters = new Set<(result: CommandResult) => void>();

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
    const generation = ++this.#generation;
    const unsubscribe = this.#unsubscribe;
    const cueUnsubscribe = this.#cueUnsubscribe;
    const previousProvider = this.#provider;
    this.#unsubscribe = undefined;
    this.#cueUnsubscribe = undefined;
    this.#provider = undefined;
    unsubscribeSafely(unsubscribe);
    unsubscribeSafely(cueUnsubscribe);
    this.#setActiveCues([]);
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
    // Commands reach the adapter from here on, which is what `whenReady`
    // promises — not the later `ready` activation, which also waits on media
    // metadata.
    this.#settleReadyWaiters({ ok: true });
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
      .catch((cause: unknown) =>
        this.#handleLifecycleFailure(cause, generation)
      );
  };

  getState = (): PlayerState => this.#state;

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
  selectQuality = (height: number | null): Promise<CommandResult> =>
    this.#command('selectQuality', height);
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
    if (snapshot.activation === 'error') {
      this.#settleReadyWaiters({
        ok: false,
        reason: 'provider-error',
        ...(snapshot.error ? { error: snapshot.error } : {})
      });
    }
    this.#listeners.forEach((listener) => listener(snapshot));
  };

  #settleReadyWaiters = (result: CommandResult): void => {
    if (this.#readyWaiters.size === 0) return;
    const waiters = [...this.#readyWaiters];
    this.#readyWaiters.clear();
    waiters.forEach((resolve) => resolve(result));
  };

  /**
   * Resolves at the first moment a command will be accepted — that is, once a
   * provider is attached. Commands issued before then are refused with
   * `not-ready` and nothing queues them, so this is the signal to await before
   * applying startup preferences (a playback rate, a volume, a text track).
   *
   * Resolves `{ok: false, reason: 'provider-error'}` if the player reaches its
   * error activation first, so an awaiting caller is never left hanging on a
   * player that will never become ready. A waiter created after an error
   * tracks the next attempt rather than replaying the old failure.
   */
  whenReady = (): Promise<CommandResult> => {
    if (this.#provider) return Promise.resolve({ ok: true });
    if (this.#state.activation === 'error') {
      return Promise.resolve({
        ok: false,
        reason: 'provider-error',
        ...(this.#state.error ? { error: this.#state.error } : {})
      });
    }
    return new Promise<CommandResult>((resolve) => {
      this.#readyWaiters.add(resolve);
    });
  };

  #setActiveCues = (cues: readonly TextCue[]): void => {
    this.#activeCues = Object.freeze(cues.map((c) => Object.freeze({ ...c })));
    this.#cueListeners.forEach((l) => l(this.#activeCues));
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
      this.#autoplayAttemptGeneration === generation
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
      ?.forEach((listener) => listener(completeEvent));
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
export type MediaSessionLike = {
  metadata: unknown;
  playbackState?: string;
  setActionHandler: (
    action: string,
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

type MetadataFactory = (metadata: MediaMetadataInput) => unknown;

const globalMediaMetadata = ():
  (new (init: MediaMetadataInput) => unknown) | undefined => {
  const scope = globalThis as {
    MediaMetadata?: new (init: MediaMetadataInput) => unknown;
  };
  return typeof scope.MediaMetadata === 'function'
    ? scope.MediaMetadata
    : undefined;
};

const defaultMetadataFactory: MetadataFactory = (metadata) => {
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

export const createMediaSessionCoordinator = (
  session: MediaSessionLike,
  options: { readonly metadataFactory?: MetadataFactory } = {}
): MediaSessionCoordinator => {
  const metadataFactory = options.metadataFactory ?? defaultMetadataFactory;
  let owner: MediaSessionRoot | null = null;

  const applyMetadata = (metadata: MediaMetadataInput | null): void => {
    session.metadata = metadata ? metadataFactory(metadata) : null;
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
      root.setPositionState({
        duration: state.duration,
        position: state.currentTime,
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
