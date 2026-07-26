import type {
  Availability,
  CaptionRendering,
  CommandResult,
  HlsEngine,
  HlsSource,
  PlayerCapabilities,
  PlayerError,
  PlayerLiveState,
  PlayerQuality,
  ProviderAdapter,
  ProviderEvent,
  ProviderStateListener,
  ProviderStatePatch,
  TextCue,
  TextTrack,
  TextTrackKind,
  TimeRange
} from '@reely/core';
import { textTrackLabel } from '@reely/core';
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

// Structural slice of hls.js's `MediaPlaylist` for a subtitle/closed-caption
// track, as delivered on `SUBTITLE_TRACKS_UPDATED`/`instance.subtitleTracks`.
// `id` is always present on real hls.js tracks; optional here only so a
// stripped-down fake can omit it and exercise the index fallback.
export type HlsSubtitleTrackLike = {
  readonly id?: number;
  readonly name: string;
  readonly lang?: string;
  readonly default: boolean;
  readonly type?: string;
};

// hls.js's `CuesParsedData.cues` is typed `any` upstream: it carries either
// WebVTT cues or CEA-608/708 caption cues, both produced by the same
// internal `Cues.newCue` helper and both exposing this shape. This is the
// minimal structural slice this adapter reads off each entry.
export type HlsParsedCueLike = {
  readonly id?: string | null;
  readonly startTime: number;
  readonly endTime: number;
  readonly text?: string;
};

export type HlsConfigLike = {
  readonly renderTextTracksNatively?: boolean;
};

export type HlsInstanceLike = {
  readonly levels: ReadonlyArray<HlsLevelLike>;
  currentLevel: number;
  // The target live edge (behind the raw seekable end by the configured live
  // sync latency); null on VOD or before the first live level update.
  readonly liveSyncPosition?: number | null;
  readonly subtitleTracks: ReadonlyArray<HlsSubtitleTrackLike>;
  subtitleTrack: number;
  on: (event: string, listener: (event: string, data: unknown) => void) => void;
  startLoad: () => void;
  recoverMediaError: () => void;
  swapAudioCodec: () => void;
  attachMedia: (media: HTMLMediaElement) => void;
  loadSource: (url: string) => void;
  destroy: () => void;
};

export type HlsConstructorLike = {
  new (config?: HlsConfigLike): HlsInstanceLike;
  isSupported: () => boolean;
  readonly Events: {
    readonly ERROR: string;
    readonly LEVEL_SWITCHED: string;
    readonly LEVEL_UPDATED: string;
    // Plural: the level *array* changed, which is what `removeLevel` does when
    // hls.js prunes a rung. Not to be confused with the singular event above.
    readonly LEVELS_UPDATED: string;
    readonly MANIFEST_PARSED: string;
    readonly SUBTITLE_TRACKS_UPDATED: string;
    readonly SUBTITLE_TRACK_SWITCH: string;
    readonly CUES_PARSED: string;
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

// On the hls.js engine the native adapter stays attached for media-element
// state, but hls.js is the sole caption owner: `Player.Media` cannot know the
// engine at render time, so it renders sidecar `<track>` children for `hls`
// sources too and the native caption subsystem discovers them. Forwarding
// those discoveries would give the state two competing owners, so they are
// dropped here. (`selectTextTrack` needs no stripping — `decorateCapabilities`
// already replaces it with the hls.js availability on this engine.)
const withoutCaptionState = (patch: ProviderStatePatch): ProviderStatePatch => {
  const rest = { ...patch };
  delete rest.textTracks;
  delete rest.selectedTextTrackId;
  delete rest.captionRendering;
  return rest;
};

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
  let selectTextTrackAvailability: Availability = {
    status: 'unknown',
    reason: 'provider-check'
  };
  let lastCapabilities: PlayerCapabilities | undefined;
  let hlsLiveHint: boolean | undefined;
  let liveState: PlayerLiveState = null;
  let liveSeekMeaningful = true;
  // hls.js quality state: the derived ladder and the held selection (`null` is
  // auto). Unlike captions there is no "explicitly chosen" flag — see
  // `refreshHlsQualities` for why quality needs no default-track rule.
  let hlsQualityList: PlayerQuality[] = [];
  let hlsSelectedQualityId: string | null = null;
  // hls.js text-track state — mirrors packages/provider-native/src/text-tracks.ts's
  // shape (held selection + "has the user explicitly chosen" flag so a later
  // SUBTITLE_TRACKS_UPDATED can tell "keep the held id" apart from "apply the
  // default-track rule"), but keyed to hls.js's own subtitleTracks/subtitleTrack
  // surface instead of `<track>` elements.
  let hlsTextTracks: TextTrack[] = [];
  let hlsSelectedTextTrackId: string | null = null;
  let hlsHasExplicitTextTrackSelection = false;
  // Cues parsed for the held selection (see `startHlsJs`'s `CUES_PARSED`
  // listener for why no further per-track filtering is needed), windowed
  // down to the currently active ones on every `timeupdate`.
  let hlsParsedCues: TextCue[] = [];
  const hlsCueListeners = new Set<(cues: readonly TextCue[]) => void>();

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
          : selectQualityAvailability,
      selectTextTrack:
        engine === 'hls.js'
          ? selectTextTrackAvailability
          : capabilities.selectTextTrack
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
    emit(
      syncLive(engine === 'hls.js' ? withoutCaptionState(patch) : patch),
      event
    );
  });

  const teardownHls = (): void => {
    const instance = hls;
    hls = undefined;
    media.removeEventListener('timeupdate', recomputeActiveHlsCues);
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
    hlsQualityList = [];
    hlsSelectedQualityId = null;
    emit(
      {
        lifecycle: 'error',
        activation: 'error',
        playback: 'paused',
        buffering: false,
        seeking: false,
        quality: null,
        qualities: [],
        selectedQualityId: null,
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

  // Content-derived, never index-derived: hls.js removes levels from `levels`
  // after repeated errors, so an index-keyed id would silently repoint a held
  // selection at a different rung. `HlsLevelLike`'s fields are all optional
  // (audio-only renditions carry no dimensions), so a missing one renders as
  // `-` rather than the string "undefined".
  const hlsLevelToken = (value: number | undefined): string =>
    value === undefined ? '-' : String(value);

  const hlsQualityBaseId = (level: HlsLevelLike): string =>
    `hls:${hlsLevelToken(level.height)}x${hlsLevelToken(level.width)}` +
    `@${hlsLevelToken(level.bitrate)}`;

  // Rungs identical on every field this contract exposes are separated by a
  // `:<idx>` suffix. That suffix — and only that suffix — can move when the
  // collision set changes, which is harmless precisely because such rungs are
  // indistinguishable to a consumer.
  const hlsQualities = (
    levels: ReadonlyArray<HlsLevelLike>
  ): PlayerQuality[] => {
    const rungs = levels.map((level) => ({
      level,
      baseId: hlsQualityBaseId(level)
    }));
    const collisions = new Map<string, number>();
    rungs.forEach(({ baseId }) =>
      collisions.set(baseId, (collisions.get(baseId) ?? 0) + 1)
    );
    const assigned = new Map<string, number>();
    return rungs.map(({ baseId, level }) => {
      let id = baseId;
      if ((collisions.get(baseId) ?? 0) > 1) {
        const ordinal = assigned.get(baseId) ?? 0;
        assigned.set(baseId, ordinal + 1);
        id = `${baseId}:${ordinal}`;
      }
      return {
        id,
        height: level.height ?? null,
        width: level.width ?? null,
        bitrate: level.bitrate ?? null
      };
    });
  };

  // Gated on list length, the way `resolveHlsCaptionRendering` gates on track
  // count. An empty list once the manifest has parsed is `unavailable/source`,
  // never `unknown` — a verdict that cannot resolve is the same defect this
  // change fixes in provider-native.
  const refreshHlsQualities = (instance: HlsInstanceLike): void => {
    if (destroyed || hls !== instance) return;
    hlsQualityList = hlsQualities(instance.levels);
    selectQualityAvailability =
      hlsQualityList.length === 0
        ? { status: 'unavailable', reason: 'source' }
        : { status: 'available' };
    // A held selection may not outlive the rung it names. `currentLevel` is
    // deliberately not written here: hls.js prunes levels as part of its own
    // error recovery and moves `currentLevel` itself, so writing -1 into the
    // middle of that fights the engine over state it is still repairing.
    if (
      hlsSelectedQualityId !== null &&
      !hlsQualityList.some((quality) => quality.id === hlsSelectedQualityId)
    ) {
      hlsSelectedQualityId = null;
    }
    emit({
      qualities: hlsQualityList,
      selectedQualityId: hlsSelectedQualityId,
      ...(lastCapabilities
        ? { capabilities: decorateCapabilities(lastCapabilities) }
        : {})
    });
  };

  const hlsSubtitleTrackId = (
    track: HlsSubtitleTrackLike,
    index: number
  ): string =>
    track.id !== undefined && track.id !== null
      ? `hls:${track.id}`
      : `hls:${index}`;

  const hlsSubtitleTrackKind = (track: HlsSubtitleTrackLike): TextTrackKind =>
    track.type === 'CLOSED-CAPTIONS' ? 'captions' : 'subtitles';

  // Mirrors provider-native's `resolveSelection`: a held explicit selection
  // always overrides and persists as long as it still names an existing
  // track; otherwise the `default` track applies (native's `<track
  // default>` rule, here hls.js's `MediaPlaylist.default` flag); otherwise
  // no selection.
  const resolveHlsTextTrackSelection = (
    ids: ReadonlyArray<string>,
    defaultIndex: number
  ): string | null => {
    if (hlsHasExplicitTextTrackSelection) {
      return hlsSelectedTextTrackId !== null &&
        ids.includes(hlsSelectedTextTrackId)
        ? hlsSelectedTextTrackId
        : null;
    }
    return defaultIndex === -1 ? null : (ids[defaultIndex] ?? null);
  };

  // No 'native' branch: real browser-native rendering needs hls.js's
  // `renderTextTracksNatively`, which `startHlsJs` keeps off (see the
  // comment there), so there is no native surface to report. See
  // `setCaptionRenderer` below.
  const resolveHlsCaptionRendering = (): CaptionRendering =>
    hlsTextTracks.length === 0 ? 'unavailable' : 'custom';

  const emitHlsCues = (cues: readonly TextCue[]): void =>
    hlsCueListeners.forEach((listener) => listener(cues));

  const normalizeHlsCue = (cue: HlsParsedCueLike): TextCue => {
    const text = typeof cue.text === 'string' ? cue.text : '';
    return {
      id: cue.id ?? null,
      startTime: cue.startTime,
      endTime: cue.endTime,
      text: text.trim().length === 0 ? '' : text
    };
  };

  // Windows the held cues down to the ones active at the media's current
  // time — mirrors what a native `TextTrack`'s `activeCues`/`cuechange`
  // would give us, computed by hand since `CUES_PARSED` delivers cues as
  // they are parsed (which can be well ahead of playback), not as they
  // become active. Driven by `timeupdate`, which the HTML spec fires at
  // roughly 4Hz — cue enter/exit precision is bounded by that cadence, an
  // accepted limitation for this hand-rolled windowing (a real `cuechange`
  // event would be exact).
  const recomputeActiveHlsCues = (): void => {
    const currentTime = media.currentTime;
    emitHlsCues(
      hlsParsedCues.filter(
        (cue) => currentTime >= cue.startTime && currentTime < cue.endTime
      )
    );
  };

  // Pushes the held selection down into the engine (`instance.subtitleTrack`,
  // `-1` for none) and clears the held cues — the previous selection's cues
  // no longer apply, and hls.js only fetches/parses fragments for the
  // subtitle track that is actually selected, so nothing will refill the
  // buffer until the new selection's own cues are parsed.
  const applyHlsTextTrackSelection = (): void => {
    const instance = hls;
    if (!instance) return;
    instance.subtitleTrack =
      hlsSelectedTextTrackId === null
        ? -1
        : hlsTextTracks.findIndex(
            (track) => track.id === hlsSelectedTextTrackId
          );
    hlsParsedCues = [];
    emitHlsCues([]);
  };

  const startHlsJs = async (): Promise<CommandResult> => {
    const startGeneration = ++generation;
    // Both `load()` and `retry()` route through here, so this is the one place
    // a new engine instance's empty ladder has to be published: without it,
    // state would keep advertising a dead instance's rungs until the new
    // manifest parsed. Guarded because on a first load there is nothing to
    // clear, and an unconditional patch would publish a no-op change.
    if (hlsQualityList.length > 0 || hlsSelectedQualityId !== null) {
      hlsQualityList = [];
      hlsSelectedQualityId = null;
      // The capability and the list are one claim and may not disagree, even
      // for the window before the new manifest parses. `retry()` already sets
      // this same verdict; a plain second `load()` does not, so it is set here
      // rather than left to the caller.
      selectQualityAvailability = {
        status: 'unknown',
        reason: 'provider-check'
      };
      emit({
        qualities: [],
        selectedQualityId: null,
        ...(lastCapabilities
          ? { capabilities: decorateCapabilities(lastCapabilities) }
          : {})
      });
    }
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
    // `renderTextTracksNatively` (hls.js's own default is `true`) makes
    // hls.js auto-create a native `TextTrack` per subtitle on
    // `media.textTracks` and manage its mode itself. That collides with
    // `createNativeProvider`'s own caption subsystem below (`native`),
    // which is always wired to the same `media.textTracks` list (it owns
    // captions for the *native* HLS engine's embedded `<track>` elements)
    // and reacts to any track's `mode` changing — including hls.js's own —
    // by re-discovering and re-applying its unrelated selection, fighting
    // hls.js over the very tracks it just created. Keeping it off is what
    // lets this engine's caption pipeline (`CUES_PARSED`, below) stay fully
    // self-contained; see `setCaptionRenderer` for what this costs.
    const instance = new HlsRuntime({ renderTextTracksNatively: false });
    hls = instance;
    media.addEventListener('timeupdate', recomputeActiveHlsCues);
    instance.on(HlsRuntime.Events.ERROR, (_event, data) =>
      handleHlsError(instance, HlsRuntime, data)
    );
    instance.on(HlsRuntime.Events.LEVEL_SWITCHED, (_event, data) => {
      if (destroyed || hls !== instance) return;
      const index = (data as { level: number }).level;
      // Resolved through the same derivation as the list, so the active
      // level's id and its list entry's id cannot drift apart.
      emit({ quality: hlsQualities(instance.levels)[index] ?? null });
    });
    instance.on(HlsRuntime.Events.MANIFEST_PARSED, () => {
      refreshHlsQualities(instance);
    });
    instance.on(HlsRuntime.Events.LEVELS_UPDATED, () => {
      refreshHlsQualities(instance);
    });
    instance.on(HlsRuntime.Events.LEVEL_UPDATED, (_event, data) => {
      if (destroyed || hls !== instance) return;
      const live = (data as { details?: { live?: boolean } }).details?.live;
      if (typeof live === 'boolean') hlsLiveHint = live;
      emitLiveUpdate();
    });
    instance.on(HlsRuntime.Events.SUBTITLE_TRACKS_UPDATED, (_event, data) => {
      if (destroyed || hls !== instance) return;
      const rawTracks =
        (data as { subtitleTracks?: ReadonlyArray<HlsSubtitleTrackLike> })
          .subtitleTracks ?? instance.subtitleTracks;
      const ids = rawTracks.map((track, index) =>
        hlsSubtitleTrackId(track, index)
      );
      hlsTextTracks = rawTracks.map((track, index) => ({
        id: ids[index],
        label: textTrackLabel(track.name, track.lang),
        language: track.lang || null,
        kind: hlsSubtitleTrackKind(track),
        readiness: 'loaded'
      }));
      const defaultIndex = rawTracks.findIndex((track) => track.default);
      hlsSelectedTextTrackId = resolveHlsTextTrackSelection(ids, defaultIndex);
      // Mirrors the native engine's `hasSelectableTextTracks()` rule: the
      // capability is only 'available' once there is at least one track to
      // select among.
      selectTextTrackAvailability =
        hlsTextTracks.length > 0
          ? { status: 'available' }
          : { status: 'unavailable', reason: 'source' };
      applyHlsTextTrackSelection();
      emit({
        textTracks: hlsTextTracks,
        selectedTextTrackId: hlsSelectedTextTrackId,
        captionRendering: resolveHlsCaptionRendering(),
        ...(lastCapabilities
          ? { capabilities: decorateCapabilities(lastCapabilities) }
          : {})
      });
    });
    // hls.js only downloads/parses subtitle fragments for the currently
    // selected `subtitleTrack`, so every cue that arrives while a selection
    // is held belongs to it — no need to correlate hls.js's internal
    // `data.track` label (an implementation-private "default"/"subtitlesN"
    // string, not a documented stable identifier) back to our own track ids.
    instance.on(HlsRuntime.Events.CUES_PARSED, (_event, data) => {
      if (destroyed || hls !== instance || hlsSelectedTextTrackId === null) {
        return;
      }
      const parsedCues =
        (data as { cues?: ReadonlyArray<HlsParsedCueLike> }).cues ?? [];
      hlsParsedCues = [...hlsParsedCues, ...parsedCues.map(normalizeHlsCue)];
      recomputeActiveHlsCues();
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
      hlsCueListeners.clear();
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
    // engine's own caption commands are added below, gated the same way as
    // `selectQuality`.
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
      selectTextTrackAvailability = {
        status: 'unknown',
        reason: 'provider-check'
      };
      hlsLiveHint = undefined;
      liveState = null;
      liveSeekMeaningful = true;
      hlsTextTracks = [];
      hlsSelectedTextTrackId = null;
      hlsHasExplicitTextTrackSelection = false;
      hlsParsedCues = [];
      emitHlsCues([]);
      teardownHls();
      return startHlsJs();
    },
    ...(engine === 'hls.js'
      ? {
          selectQuality: async (id: string | null): Promise<CommandResult> => {
            const instance = hls;
            if (destroyed || !instance) {
              return { ok: false, reason: 'not-ready' };
            }
            if (id === null) {
              instance.currentLevel = -1;
              hlsSelectedQualityId = null;
              emit({ selectedQualityId: null });
              return { ok: true };
            }
            // Resolved against a fresh derivation over the live `levels`
            // array, so a rung hls.js has pruned is `unsupported` rather than
            // a silent switch to whatever now occupies that index.
            const index = hlsQualities(instance.levels).findIndex(
              (quality) => quality.id === id
            );
            if (index === -1) return { ok: false, reason: 'unsupported' };
            instance.currentLevel = index;
            hlsSelectedQualityId = id;
            emit({ selectedQualityId: id });
            return { ok: true };
          },
          selectTextTrack: async (
            id: string | null
          ): Promise<CommandResult> => {
            const instance = hls;
            if (destroyed || !instance) {
              return { ok: false, reason: 'not-ready' };
            }
            if (
              id !== null &&
              !hlsTextTracks.some((track) => track.id === id)
            ) {
              return { ok: false, reason: 'unsupported' };
            }
            hlsHasExplicitTextTrackSelection = true;
            hlsSelectedTextTrackId = id;
            applyHlsTextTrackSelection();
            emit({
              selectedTextTrackId: hlsSelectedTextTrackId,
              captionRendering: resolveHlsCaptionRendering()
            });
            return { ok: true };
          },
          subscribeCues: (listener: (cues: readonly TextCue[]) => void) => {
            hlsCueListeners.add(listener);
            return () => hlsCueListeners.delete(listener);
          },
          // Real browser-native rendering needs `renderTextTracksNatively`,
          // which `startHlsJs` keeps off (see its comment), so there is no
          // native surface this engine can hand a 'native' request to.
          // Honor the call without pretending otherwise: cues keep flowing
          // through `subscribeCues` either way, and captionRendering keeps
          // honestly reporting 'custom'.
          setCaptionRenderer: () => {
            emit({ captionRendering: resolveHlsCaptionRendering() });
          }
        }
      : {})
  };
};
