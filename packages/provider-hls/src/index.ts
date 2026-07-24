import type {
  Availability,
  CommandResult,
  HlsEngine,
  HlsSource,
  PlayerCapabilities,
  PlayerError,
  PlayerLiveState,
  ProviderAdapter,
  ProviderEvent,
  ProviderStateListener,
  ProviderStatePatch,
  TimeRange
} from '@reely/core';
import {
  createNativeProvider,
  type NativePlaybackOptions
} from '@reely/provider-native';

export type HlsEnvironment = {
  readonly nativeHls: boolean;
  readonly mse: boolean;
};

export type HlsEngineSelection =
  | { readonly engine: HlsEngine }
  | { readonly engine: null; readonly error: PlayerError };

export type HlsLevelLike = {
  readonly height?: number;
  readonly width?: number;
  readonly bitrate?: number;
};

export type HlsInstanceLike = {
  readonly levels: ReadonlyArray<HlsLevelLike>;
  currentLevel: number;
  // The target live edge (behind the raw seekable end by the configured live
  // sync latency); null on VOD or before the first live level update.
  readonly liveSyncPosition?: number | null;
  on: (event: string, listener: (event: string, data: unknown) => void) => void;
  startLoad: () => void;
  recoverMediaError: () => void;
  swapAudioCodec: () => void;
  attachMedia: (media: HTMLMediaElement) => void;
  loadSource: (url: string) => void;
  destroy: () => void;
};

export type HlsConstructorLike = {
  new (): HlsInstanceLike;
  isSupported: () => boolean;
  readonly Events: {
    readonly ERROR: string;
    readonly LEVEL_SWITCHED: string;
    readonly LEVEL_UPDATED: string;
    readonly MANIFEST_PARSED: string;
  };
  readonly ErrorTypes: {
    readonly NETWORK_ERROR: string;
    readonly MEDIA_ERROR: string;
  };
};

export type HlsModuleLoader = () => Promise<{
  readonly default: HlsConstructorLike;
}>;

export type HlsProviderOptions = NativePlaybackOptions & {
  readonly loadHls?: HlsModuleLoader;
};

export type LiveDerivationInput = {
  // Authoritative liveness when defined (hls.js level details). Left undefined
  // on the native engine, where liveness is inferred from duration instead.
  readonly isLiveHint?: boolean;
  // Raw media element duration: Infinity or NaN for an ordinary live stream.
  readonly duration: number;
  readonly seekable: ReadonlyArray<TimeRange>;
  readonly currentTime: number;
  // hls.js liveSyncPosition when known; the target live edge behind the raw
  // seekable end. Falls back to the seekable end when undefined.
  readonly liveEdge?: number;
  readonly atEdgeThreshold: number;
};

// Derives normalized live status from stream data alone. Liveness comes from
// the hls.js live flag when present, otherwise from an infinite duration —
// never from the source URL. Edge state is measured against a moving window,
// clamped so a current time at or beyond the edge never reads as behind and no
// arithmetic escapes as NaN or a negative distance.
export const deriveLiveState = (
  input: LiveDerivationInput
): PlayerLiveState => {
  const isLive =
    input.isLiveHint ?? input.duration === Number.POSITIVE_INFINITY;
  if (!isLive) return null;
  const seekableEnd = input.seekable.reduce(
    (end, range) => Math.max(end, range.end),
    Number.NEGATIVE_INFINITY
  );
  const edge = Number.isFinite(input.liveEdge)
    ? (input.liveEdge as number)
    : seekableEnd;
  if (!Number.isFinite(edge) || !Number.isFinite(input.currentTime)) {
    return Object.freeze({ isLive: true, atLiveEdge: true });
  }
  const distance = Math.max(0, edge - input.currentTime);
  return Object.freeze({
    isLive: true,
    atLiveEdge: distance <= input.atEdgeThreshold
  });
};

const NATIVE_HLS_MIME = 'application/vnd.apple.mpegurl';
const MSE_TEST_CODEC = 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"';
const MAX_FATAL_NETWORK_RECOVERIES = 2;
const MAX_FATAL_MEDIA_RECOVERIES = 2;
// Ordinary-live tolerances. At-edge is a coarse "close to the live edge"
// window, not the tight target of DVR/LL-HLS tuning (out of MVP scope). A
// seekable span below the minimum is treated as pure live edge with no
// meaningful window to scrub.
const LIVE_EDGE_THRESHOLD_SECONDS = 10;
const LIVE_MIN_SEEK_WINDOW_SECONDS = 2;

const readMediaRanges = (
  ranges: globalThis.TimeRanges
): ReadonlyArray<TimeRange> =>
  Array.from({ length: ranges.length }, (_, index) => ({
    start: ranges.start(index),
    end: ranges.end(index)
  }));

const liveStateEqual = (a: PlayerLiveState, b: PlayerLiveState): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.isLive === b.isLive &&
    a.atLiveEdge === b.atLiveEdge);

type MediaSourceLike = { isTypeSupported?: (type: string) => boolean };

const supportsMse = (candidate: unknown): boolean => {
  const mediaSource = candidate as MediaSourceLike | undefined | null;
  try {
    return (
      typeof mediaSource?.isTypeSupported === 'function' &&
      mediaSource.isTypeSupported(MSE_TEST_CODEC)
    );
  } catch {
    return false;
  }
};

export const detectHlsEnvironment = (
  media: HTMLVideoElement
): HlsEnvironment => {
  const globals = globalThis as {
    MediaSource?: unknown;
    ManagedMediaSource?: unknown;
  };
  return {
    nativeHls: media.canPlayType(NATIVE_HLS_MIME) !== '',
    mse:
      supportsMse(globals.ManagedMediaSource) ||
      supportsMse(globals.MediaSource)
  };
};

const unsupportedSelection = (message: string): HlsEngineSelection => ({
  engine: null,
  error: {
    category: 'unsupported',
    fatal: true,
    recoverable: false,
    message
  }
});

export const selectHlsEngine = (
  requested: NonNullable<HlsSource['engine']>,
  environment: HlsEnvironment
): HlsEngineSelection => {
  if (requested === 'native') {
    return environment.nativeHls
      ? { engine: 'native' }
      : unsupportedSelection(
          'The forced "native" HLS engine is unavailable: this browser cannot play HLS natively.'
        );
  }
  if (requested === 'hls.js') {
    return environment.mse
      ? { engine: 'hls.js' }
      : unsupportedSelection(
          'The forced "hls.js" HLS engine is unavailable: this browser does not support Media Source Extensions.'
        );
  }
  if (environment.nativeHls) return { engine: 'native' };
  if (environment.mse) return { engine: 'hls.js' };
  return unsupportedSelection(
    'HLS is unsupported in this browser: it has neither native HLS playback nor Media Source Extensions.'
  );
};

// hls.js publishes stricter generic event signatures than the minimal
// structural surface this adapter consumes, so the dynamic module boundary
// narrows through a cast instead of importing hls.js types eagerly.
const defaultLoadHls: HlsModuleLoader = () =>
  import('hls.js') as unknown as Promise<{
    readonly default: HlsConstructorLike;
  }>;

export const createHlsProvider = (
  media: HTMLVideoElement,
  source: HlsSource,
  options: HlsProviderOptions = {}
): ProviderAdapter => {
  const { loadHls = defaultLoadHls, ...nativeOptions } = options;
  const selection = selectHlsEngine(
    source.engine ?? 'auto',
    detectHlsEnvironment(media)
  );
  const engine = selection.engine;
  const native = createNativeProvider(media, nativeOptions);
  const listeners = new Set<ProviderStateListener>();
  let attached = false;
  let destroyed = false;
  let hls: HlsInstanceLike | undefined;
  let hlsConstructor: HlsConstructorLike | undefined;
  let generation = 0;
  let networkRecoveries = 0;
  let mediaRecoveries = 0;
  let selectQualityAvailability: Availability = {
    status: 'unknown',
    reason: 'provider-check'
  };
  let lastCapabilities: PlayerCapabilities | undefined;
  let hlsLiveHint: boolean | undefined;
  let liveState: PlayerLiveState = null;
  let liveSeekMeaningful = true;

  const emit = (patch: ProviderStatePatch, event?: ProviderEvent): void => {
    if (destroyed) return;
    listeners.forEach((listener) => listener(patch, event));
  };

  const decorateCapabilities = (
    capabilities: PlayerCapabilities
  ): PlayerCapabilities => {
    const withQuality: PlayerCapabilities = {
      ...capabilities,
      selectQuality:
        engine === 'native'
          ? { status: 'unavailable', reason: 'provider' }
          : selectQualityAvailability
    };
    return liveSeekMeaningful
      ? withQuality
      : { ...withQuality, seek: { status: 'unavailable', reason: 'source' } };
  };

  const computeLiveState = (): PlayerLiveState =>
    deriveLiveState({
      isLiveHint: engine === 'hls.js' ? hlsLiveHint : undefined,
      duration: media.duration,
      seekable: readMediaRanges(media.seekable),
      currentTime: media.currentTime,
      liveEdge:
        engine === 'hls.js' ? (hls?.liveSyncPosition ?? undefined) : undefined,
      atEdgeThreshold: LIVE_EDGE_THRESHOLD_SECONDS
    });

  const seekWindowMeaningful = (live: PlayerLiveState): boolean => {
    if (!live?.isLive) return true;
    const ranges = readMediaRanges(media.seekable);
    if (ranges.length === 0) return false;
    const start = Math.min(...ranges.map((range) => range.start));
    const end = Math.max(...ranges.map((range) => range.end));
    const span = end - start;
    return Number.isFinite(span) && span >= LIVE_MIN_SEEK_WINDOW_SECONDS;
  };

  // Recomputes live status and merges any change into an outgoing patch:
  // liveness plus a `null` duration (never a false fixed duration while live)
  // and a re-decorated capabilities set when the seekable window crosses the
  // threshold that makes scrubbing meaningful. Shared by the native patch
  // pipeline and the hls.js level-update listener.
  const syncLive = (patch: ProviderStatePatch): ProviderStatePatch => {
    const nextLive = computeLiveState();
    const meaningful = seekWindowMeaningful(nextLive);
    const liveChanged = !liveStateEqual(nextLive, liveState);
    const meaningfulChanged = meaningful !== liveSeekMeaningful;
    liveState = nextLive;
    liveSeekMeaningful = meaningful;
    const liveField: ProviderStatePatch = liveChanged ? { live: nextLive } : {};
    const durationField: ProviderStatePatch = liveChanged
      ? {
          duration: nextLive?.isLive
            ? null
            : Number.isFinite(media.duration)
              ? media.duration
              : (patch.duration ?? null)
        }
      : nextLive?.isLive && patch.duration !== undefined
        ? { duration: null }
        : {};
    const capabilitiesField: ProviderStatePatch = patch.capabilities
      ? { capabilities: decorateCapabilities(patch.capabilities) }
      : meaningfulChanged && lastCapabilities
        ? { capabilities: decorateCapabilities(lastCapabilities) }
        : {};
    return { ...patch, ...liveField, ...durationField, ...capabilitiesField };
  };

  const emitLiveUpdate = (): void => {
    const before = liveState;
    const beforeMeaningful = liveSeekMeaningful;
    const patch = syncLive({});
    if (
      liveStateEqual(before, liveState) &&
      beforeMeaningful === liveSeekMeaningful
    ) {
      return;
    }
    emit(patch);
  };

  const unsubscribeNative = native.subscribe((patch, event) => {
    if (destroyed) return;
    if (engine === 'hls.js' && patch.lifecycle === 'error') {
      // hls.js owns error recovery and surfacing on the MSE path; raw media
      // element errors would preempt its bounded recovery table.
      return;
    }
    if (patch.capabilities) lastCapabilities = patch.capabilities;
    emit(syncLive(patch), event);
  });

  const teardownHls = (): void => {
    const instance = hls;
    hls = undefined;
    if (!instance) return;
    try {
      instance.destroy();
    } catch {
      // Teardown must not escape the provider boundary.
    }
  };

  const surfaceFatal = (error: PlayerError): void => {
    teardownHls();
    selectQualityAvailability = { status: 'unavailable', reason: 'provider' };
    emit(
      {
        lifecycle: 'error',
        activation: 'error',
        playback: 'paused',
        buffering: false,
        seeking: false,
        quality: null,
        ...(lastCapabilities
          ? { capabilities: decorateCapabilities(lastCapabilities) }
          : {}),
        error
      },
      { type: 'error', detail: error, origin: 'provider' }
    );
  };

  const handleHlsError = (
    instance: HlsInstanceLike,
    Hls: HlsConstructorLike,
    data: unknown
  ): void => {
    if (destroyed || hls !== instance) return;
    const errorData = data as {
      type?: string;
      details?: string;
      fatal?: boolean;
    };
    if (!errorData.fatal) return;
    if (errorData.type === Hls.ErrorTypes.NETWORK_ERROR) {
      if (networkRecoveries < MAX_FATAL_NETWORK_RECOVERIES) {
        networkRecoveries += 1;
        instance.startLoad();
        return;
      }
      surfaceFatal({
        category: 'network',
        fatal: true,
        recoverable: true,
        message: 'HLS playback failed after bounded network error recovery.',
        cause: data
      });
      return;
    }
    if (errorData.type === Hls.ErrorTypes.MEDIA_ERROR) {
      if (mediaRecoveries < MAX_FATAL_MEDIA_RECOVERIES) {
        mediaRecoveries += 1;
        // Per the hls.js recovery contract, a repeated fatal media error
        // needs an audio codec swap before the next recovery attempt.
        if (mediaRecoveries > 1) instance.swapAudioCodec();
        instance.recoverMediaError();
        return;
      }
      surfaceFatal({
        category: 'decode',
        fatal: true,
        recoverable: true,
        message: 'HLS playback failed after bounded media error recovery.',
        cause: data
      });
      return;
    }
    surfaceFatal({
      category: 'provider',
      fatal: true,
      recoverable: true,
      message: errorData.details
        ? `hls.js reported an unrecoverable fatal error: ${errorData.details}`
        : 'hls.js reported an unrecoverable fatal error.',
      cause: data
    });
  };

  const startHlsJs = async (): Promise<CommandResult> => {
    const startGeneration = ++generation;
    let Hls = hlsConstructor;
    if (!Hls) {
      try {
        Hls = (await loadHls()).default;
      } catch (cause) {
        if (destroyed || generation !== startGeneration) {
          return { ok: false, reason: 'not-ready' };
        }
        const error: PlayerError = {
          category: 'provider',
          fatal: true,
          recoverable: true,
          message: 'Unable to load the hls.js engine module.',
          cause
        };
        surfaceFatal(error);
        return { ok: false, reason: 'provider-error', error };
      }
    }
    if (destroyed || generation !== startGeneration) {
      return { ok: false, reason: 'not-ready' };
    }
    hlsConstructor = Hls;
    if (!Hls.isSupported()) {
      const error: PlayerError = {
        category: 'unsupported',
        fatal: true,
        recoverable: false,
        message: 'hls.js does not support this browser environment.'
      };
      surfaceFatal(error);
      return { ok: false, reason: 'unsupported', error };
    }
    const HlsRuntime = Hls;
    const instance = new HlsRuntime();
    hls = instance;
    instance.on(HlsRuntime.Events.ERROR, (_event, data) =>
      handleHlsError(instance, HlsRuntime, data)
    );
    instance.on(HlsRuntime.Events.LEVEL_SWITCHED, (_event, data) => {
      if (destroyed || hls !== instance) return;
      const level = instance.levels[(data as { level: number }).level];
      emit({
        quality: level
          ? {
              height: level.height ?? null,
              width: level.width ?? null,
              bitrate: level.bitrate ?? null
            }
          : null
      });
    });
    instance.on(HlsRuntime.Events.MANIFEST_PARSED, () => {
      if (destroyed || hls !== instance) return;
      selectQualityAvailability = { status: 'available' };
      if (lastCapabilities) {
        emit({ capabilities: decorateCapabilities(lastCapabilities) });
      }
    });
    instance.on(HlsRuntime.Events.LEVEL_UPDATED, (_event, data) => {
      if (destroyed || hls !== instance) return;
      const live = (data as { details?: { live?: boolean } }).details?.live;
      if (typeof live === 'boolean') hlsLiveHint = live;
      emitLiveUpdate();
    });
    instance.attachMedia(media);
    instance.loadSource(source.src);
    return { ok: true };
  };

  const emitSelectionFailure = (): void => {
    if (selection.engine !== null) return;
    emit(
      {
        lifecycle: 'error',
        activation: 'error',
        hlsEngine: null,
        error: selection.error
      },
      { type: 'error', detail: selection.error, origin: 'provider' }
    );
  };

  return {
    provider: 'hls',
    attach: () => {
      if (destroyed || attached) return;
      attached = true;
      if (!engine) {
        emitSelectionFailure();
        return;
      }
      emit({ hlsEngine: engine });
      native.attach();
    },
    load: async () => {
      if (destroyed || !engine) return;
      if (engine === 'native') {
        media.src = source.src;
        await native.load();
        return;
      }
      await startHlsJs();
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      generation += 1;
      teardownHls();
      unsubscribeNative();
      native.destroy();
      if (engine === 'native') {
        // The native engine owns media.src (React sets none on the HLS
        // <video>); detach it so the element stops buffering the manifest.
        media.removeAttribute('src');
        media.load();
      }
      listeners.clear();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    play: native.play,
    pause: native.pause,
    seekTo: native.seekTo,
    seekBy: native.seekBy,
    mute: native.mute,
    unmute: native.unmute,
    setVolume: native.setVolume,
    setPlaybackRate: native.setPlaybackRate,
    requestFullscreen: native.requestFullscreen,
    exitFullscreen: native.exitFullscreen,
    requestPictureInPicture: native.requestPictureInPicture,
    exitPictureInPicture: native.exitPictureInPicture,
    showAirPlayPicker: native.showAirPlayPicker,
    // Embedded WebVTT on the native HLS engine surfaces through the same
    // `HTMLMediaElement.textTracks` API the native provider already
    // handles — `native.attach()`/`load()`/`destroy()` above already drive
    // its caption subsystem, so exposing its own selection/cue/renderer
    // commands here reuses it directly rather than standing up a second,
    // competing text-track owner over the same media element. The hls.js
    // engine has no equivalent yet (tracked separately).
    ...(engine === 'native'
      ? {
          selectTextTrack: native.selectTextTrack,
          subscribeCues: native.subscribeCues,
          setCaptionRenderer: native.setCaptionRenderer
        }
      : {}),
    retry: async (): Promise<CommandResult> => {
      if (destroyed) return { ok: false, reason: 'not-ready' };
      if (!engine) {
        return { ok: false, reason: 'unsupported', error: selection.error };
      }
      if (engine === 'native') return native.retry();
      networkRecoveries = 0;
      mediaRecoveries = 0;
      selectQualityAvailability = {
        status: 'unknown',
        reason: 'provider-check'
      };
      hlsLiveHint = undefined;
      liveState = null;
      liveSeekMeaningful = true;
      teardownHls();
      return startHlsJs();
    },
    ...(engine === 'hls.js'
      ? {
          selectQuality: async (
            height: number | null
          ): Promise<CommandResult> => {
            const instance = hls;
            if (destroyed || !instance) {
              return { ok: false, reason: 'not-ready' };
            }
            if (height === null) {
              instance.currentLevel = -1;
              return { ok: true };
            }
            const index = instance.levels.findIndex(
              (level) => level.height === height
            );
            if (index === -1) return { ok: false, reason: 'unsupported' };
            instance.currentLevel = index;
            return { ok: true };
          }
        }
      : {})
  };
};
