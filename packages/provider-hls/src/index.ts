import type {
  Availability,
  CommandResult,
  HlsSource,
  PlayerCapabilities,
  PlayerError,
  PlayerLiveState,
  PlayerQuality,
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
import {
  liveStateEqual,
  readMediaRanges,
  unsupportedSelection,
  type HlsConstructorLike,
  type HlsEngineSelection,
  type HlsInstanceLike,
  type HlsLevelLike,
  type HlsModuleLoader
} from './adapter-values.js';
import { createHlsErrorRecovery } from './error-recovery.js';
import { createHlsTextTracks } from './text-tracks.js';

export type {
  HlsConfigLike,
  HlsConstructorLike,
  HlsEngineSelection,
  HlsInstanceLike,
  HlsLevelLike,
  HlsModuleLoader,
  HlsParsedCueLike,
  HlsSubtitleTrackLike
} from './adapter-values.js';

export type HlsEnvironment = {
  readonly nativeHls: boolean;
  readonly mse: boolean;
};

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
// Ordinary-live tolerances. At-edge is a coarse "close to the live edge"
// window, not the tight target of DVR/LL-HLS tuning (out of MVP scope). A
// seekable span below the minimum is treated as pure live edge with no
// meaningful window to scrub.
const LIVE_EDGE_THRESHOLD_SECONDS = 10;
const LIVE_MIN_SEEK_WINDOW_SECONDS = 2;

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
const defaultLoadHls: HlsModuleLoader = () => import('hls.js');

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
  let selectQualityAvailability: Availability = {
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
  // The held selection's collision-free base id, kept so a selection can be
  // re-matched after its `:<idx>` suffix shifts or collapses.
  let hlsSelectedQualityBaseId: string | null = null;

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
          ? textTracks.selectTextTrackAvailability()
          : capabilities.selectTextTrack
    };
    return liveSeekMeaningful
      ? withQuality
      : { ...withQuality, seek: { status: 'unavailable', reason: 'source' } };
  };

  // The last-seen capabilities snapshot, re-decorated, as a spreadable patch
  // fragment — empty until the native adapter has published one.
  const capabilitiesPatch = (): ProviderStatePatch =>
    lastCapabilities
      ? { capabilities: decorateCapabilities(lastCapabilities) }
      : {};

  const textTracks = createHlsTextTracks(media, {
    emit,
    isDestroyed: () => destroyed,
    getInstance: () => hls,
    capabilitiesPatch
  });

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
    media.removeEventListener('timeupdate', textTracks.handlers.onTimeUpdate);
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
    hlsSelectedQualityBaseId = null;
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
        ...capabilitiesPatch(),
        error
      },
      { type: 'error', detail: error, origin: 'provider' }
    );
  };

  const errorRecovery = createHlsErrorRecovery({
    isStale: (instance) => destroyed || hls !== instance,
    surfaceFatal
  });

  // Content-derived, never index-derived: hls.js removes levels from `levels`
  // after repeated errors, so an index-keyed id would silently repoint a held
  // selection at a different rung. `HlsLevelLike`'s fields are all optional
  // (audio-only renditions carry no dimensions), so a missing one renders as
  // `-` rather than the string "undefined".
  // `== null` rather than `=== undefined`: the sibling mapping below uses
  // `?? null`, and the two must agree about what a missing dimension is, or a
  // null from hls.js would read `hls:nullx…` in the id while the exposed field
  // read `null`.
  const hlsLevelToken = (value: number | null | undefined): string =>
    value == null ? '-' : String(value);

  const hlsQualityBaseId = (level: HlsLevelLike): string =>
    `hls:${hlsLevelToken(level.height)}x${hlsLevelToken(level.width)}` +
    `@${hlsLevelToken(level.bitrate)}`;

  // Rungs identical on every field this contract exposes are separated by a
  // `:<idx>` suffix. That suffix moves when the collision set changes — and
  // the id also loses it entirely when a pair collapses to one — so a held
  // selection is re-matched by `baseId`, never by the suffixed id alone. See
  // `refreshHlsQualities`.
  const hlsQualityEntries = (
    levels: ReadonlyArray<HlsLevelLike>
  ): ReadonlyArray<{
    readonly quality: PlayerQuality;
    readonly baseId: string;
  }> => {
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
        baseId,
        quality: {
          id,
          height: level.height ?? null,
          width: level.width ?? null,
          bitrate: level.bitrate ?? null
        }
      };
    });
  };

  const hlsQualities = (levels: ReadonlyArray<HlsLevelLike>): PlayerQuality[] =>
    hlsQualityEntries(levels).map((entry) => entry.quality);

  // Gated on list length, the way `resolveHlsCaptionRendering` gates on track
  // count. An empty list once the manifest has parsed is `unavailable/source`,
  // never `unknown` — a verdict that cannot resolve is the same defect this
  // change fixes in provider-native.
  const refreshHlsQualities = (instance: HlsInstanceLike): void => {
    if (destroyed || hls !== instance) return;
    const entries = hlsQualityEntries(instance.levels);
    hlsQualityList = entries.map((entry) => entry.quality);
    selectQualityAvailability =
      hlsQualityList.length === 0
        ? { status: 'unavailable', reason: 'source' }
        : { status: 'available' };
    // A held selection may not outlive the rung it names — but it must also
    // survive a rung that still exists under a different id. Pruning one of a
    // pair of indistinguishable rungs collapses the survivor's `:<idx>` suffix
    // away, so an id-only membership test would drop a selection whose rung is
    // still right there, while the engine stays pinned to it: state would
    // report auto while playback was locked to one level, with no way back.
    // Matching on `baseId` re-adopts the survivor under its new id. Rungs
    // sharing a baseId are identical on every field this contract exposes, so
    // which one is adopted is not observable.
    if (hlsSelectedQualityId !== null) {
      const held =
        entries.find((entry) => entry.quality.id === hlsSelectedQualityId) ??
        entries.find((entry) => entry.baseId === hlsSelectedQualityBaseId);
      hlsSelectedQualityId = held?.quality.id ?? null;
      hlsSelectedQualityBaseId = held?.baseId ?? null;
    }
    // `currentLevel` is deliberately not written: hls.js prunes levels as part
    // of its own error recovery and reindexes `currentLevel` itself, so
    // writing into the middle of that fights the engine over state it is
    // still repairing.
    emit({
      qualities: hlsQualityList,
      selectedQualityId: hlsSelectedQualityId,
      ...capabilitiesPatch()
    });
  };

  const startHlsJs = async (): Promise<CommandResult> => {
    const startGeneration = ++generation;
    // Starting owns teardown, rather than each caller remembering it. `retry()`
    // used to do this itself and `load()` did not, so a second `load()` left
    // the previous instance attached with its listeners live, still loading
    // fragments (#85). Every handler is generation- and identity-guarded, so
    // nothing was corrupted — it was a resource leak, not a state bug. A no-op
    // on a first load, where there is nothing to tear down.
    teardownHls();
    // Both `load()` and `retry()` route through here, so this is the one place
    // a new engine instance's empty ladder has to be published: without it,
    // state would keep advertising a dead instance's rungs until the new
    // manifest parsed. Guarded because on a first load there is nothing to
    // clear, and an unconditional patch would publish a no-op change.
    // Also fires on a stale verdict alone: a previous instance that parsed an
    // empty manifest left `unavailable/source`, which is too confident for a
    // brand-new instance whose manifest has not been read yet.
    if (
      hlsQualityList.length > 0 ||
      hlsSelectedQualityId !== null ||
      selectQualityAvailability.status !== 'unknown'
    ) {
      hlsQualityList = [];
      hlsSelectedQualityId = null;
      hlsSelectedQualityBaseId = null;
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
        ...capabilitiesPatch()
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
    media.addEventListener('timeupdate', textTracks.handlers.onTimeUpdate);
    instance.on(HlsRuntime.Events.ERROR, (_event, data) =>
      errorRecovery.handleError(instance, HlsRuntime, data)
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
      textTracks.handlers.onSubtitleTracksUpdated(instance, data);
    });
    instance.on(HlsRuntime.Events.CUES_PARSED, (_event, data) => {
      if (destroyed || hls !== instance) return;
      textTracks.handlers.onCuesParsed(data);
    });
    instance.on(HlsRuntime.Events.MEDIA_ATTACHED, () => {
      if (destroyed || hls !== instance) return;
      // attachMedia points `media.src` at an MSE blob, which re-runs the load
      // algorithm and resets `playbackRate`. Commands land and stick from
      // here, well before the manifest parses (#69).
      emit({ commandsReady: true });
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
      textTracks.destroy();
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
    // Ungated, unlike `subscribeCues` below: the intrinsic size is read off
    // the <video> element, which both engines play into and whose
    // `loadedmetadata`/`resize` listeners `native.attach()` installs on either
    // path. hls.js owns captions — it does not own the element's own geometry,
    // so the reasoning that gates the caption members does not carry over.
    subscribeDimensions: native.subscribeDimensions,
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
      errorRecovery.reset();
      selectQualityAvailability = {
        status: 'unknown',
        reason: 'provider-check'
      };
      hlsLiveHint = undefined;
      liveState = null;
      liveSeekMeaningful = true;
      textTracks.reset();
      // No `teardownHls()` here: `startHlsJs()` owns it now (#85).
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
              hlsSelectedQualityBaseId = null;
              emit({ selectedQualityId: null });
              return { ok: true };
            }
            // Resolved against a fresh derivation over the live `levels`
            // array, so a rung hls.js has pruned is `unsupported` rather than
            // a silent switch to whatever now occupies that index.
            // Deliberately NOT `hlsQualityList`, which is what the mirrored
            // `selectTextTrack` below checks: hls.js mutates `levels` through
            // `removeLevel` and only then fires `LEVELS_UPDATED`, so the live
            // array is the authority and the published list can lag it.
            const entries = hlsQualityEntries(instance.levels);
            const index = entries.findIndex((entry) => entry.quality.id === id);
            if (index === -1) return { ok: false, reason: 'unsupported' };
            instance.currentLevel = index;
            hlsSelectedQualityId = id;
            hlsSelectedQualityBaseId = entries[index]?.baseId ?? null;
            emit({ selectedQualityId: id });
            return { ok: true };
          },
          selectTextTrack: textTracks.selectTextTrack,
          subscribeCues: textTracks.subscribeCues,
          setCaptionRenderer: textTracks.setCaptionRenderer
        }
      : {})
  };
};
