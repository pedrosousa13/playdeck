import type {
  HlsSource,
  PlayerCapabilities,
  PlayerError,
  PlayerLiveState,
  ProviderAdapter,
  ProviderEvent,
  ProviderStateListener,
  ProviderStatePatch
} from '@reely/core';
import { deriveLiveState, liveStateEqual, notifySafely } from '@reely/core';
import {
  createNativeProvider,
  type NativePlaybackOptions
} from '@reely/provider-native';
import {
  readMediaRanges,
  unsupportedSelection,
  type HlsEngineSelection,
  type HlsModuleLoader
} from './adapter-values.js';
import { createHlsAttachment } from './attachment.js';
import { createHlsErrorRecovery } from './error-recovery.js';
import { createHlsPlayback } from './playback.js';
import { createHlsQualityLevels } from './quality-levels.js';
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

// The liveness derivation lives in `@reely/core`, so every adapter shares one
// copy. Re-exported here because it is part of this package's documented
// surface: a custom HLS adapter reaches for it from the package it is
// extending.
export { deriveLiveState };
export type { LiveDerivationInput } from '@reely/core';

const NATIVE_HLS_MIME = 'application/vnd.apple.mpegurl';
const MSE_TEST_CODEC = 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"';
// A seekable span below this minimum is treated as pure live edge with no
// meaningful window to scrub. This is HLS's own seek-window rule, not the
// shared at-edge tolerance, which `deriveLiveState` owns.
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

// The native adapter derives liveness too, from the raw element duration and
// the seekable window alone. This adapter's own derivation adds the hls.js live
// flag and `liveSyncPosition`, so it is the authority on both engines — and
// `syncLive` merges its value only when *its* value changed, which would let an
// unchanged native answer through underneath. Dropped before the merge.
const withoutLiveState = (patch: ProviderStatePatch): ProviderStatePatch => {
  const rest = { ...patch };
  delete rest.live;
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
  let lastCapabilities: PlayerCapabilities | undefined;
  let hlsLiveHint: boolean | undefined;
  let liveState: PlayerLiveState = null;
  let liveSeekMeaningful = true;

  const emit = (patch: ProviderStatePatch, event?: ProviderEvent): void => {
    if (attachment.isDestroyed()) return;
    listeners.forEach((listener) => notifySafely(listener, patch, event));
  };

  const decorateCapabilities = (
    capabilities: PlayerCapabilities
  ): PlayerCapabilities => {
    const withQuality: PlayerCapabilities = {
      ...capabilities,
      selectQuality:
        engine === 'native'
          ? { status: 'unavailable', reason: 'provider' }
          : qualityLevels.selectQualityAvailability(),
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
    isDestroyed: () => attachment.isDestroyed(),
    getInstance: () => attachment.getInstance(),
    capabilitiesPatch
  });

  const qualityLevels = createHlsQualityLevels({
    emit,
    isDestroyed: () => attachment.isDestroyed(),
    getInstance: () => attachment.getInstance(),
    capabilitiesPatch
  });

  const computeLiveState = (): PlayerLiveState =>
    deriveLiveState({
      isLiveHint: engine === 'hls.js' ? hlsLiveHint : undefined,
      duration: media.duration,
      seekable: readMediaRanges(media.seekable),
      currentTime: media.currentTime,
      liveEdge:
        engine === 'hls.js'
          ? (attachment.getInstance()?.liveSyncPosition ?? undefined)
          : undefined
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
    if (attachment.isDestroyed()) return;
    if (engine === 'hls.js' && patch.lifecycle === 'error') {
      // hls.js owns error recovery and surfacing on the MSE path; raw media
      // element errors would preempt its bounded recovery table.
      return;
    }
    if (patch.capabilities) lastCapabilities = patch.capabilities;
    const merged = syncLive(
      withoutLiveState(engine === 'hls.js' ? withoutCaptionState(patch) : patch)
    );
    // A native patch whose only field was stripped leaves nothing to say —
    // unless it carried an event, which is state-independent.
    if (event === undefined && Object.keys(merged).length === 0) return;
    emit(merged, event);
  });

  const surfaceFatal = (error: PlayerError): void => {
    attachment.teardownEngine();
    qualityLevels.clearForFatal();
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
    isStale: (instance) =>
      attachment.isDestroyed() || attachment.getInstance() !== instance,
    surfaceFatal
  });

  const attachment = createHlsAttachment(media, source, selection, {
    emit,
    loadHls,
    native,
    textTracks,
    qualityLevels,
    errorRecovery,
    surfaceFatal,
    setLiveHint: (live) => {
      hlsLiveHint = live;
    },
    emitLiveUpdate,
    unsubscribeNative,
    clearStateListeners: () => listeners.clear()
  });

  const playback = createHlsPlayback(native, selection, {
    isDestroyed: () => attachment.isDestroyed(),
    resetEngineState: () => {
      errorRecovery.reset();
      qualityLevels.reset();
      hlsLiveHint = undefined;
      liveState = null;
      liveSeekMeaningful = true;
      textTracks.reset();
    },
    startHlsJs: attachment.startHlsJs
  });

  return {
    provider: 'hls',
    attach: attachment.attach,
    load: attachment.load,
    destroy: attachment.destroy,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    play: playback.play,
    pause: playback.pause,
    seekTo: playback.seekTo,
    seekBy: playback.seekBy,
    mute: playback.mute,
    unmute: playback.unmute,
    setVolume: playback.setVolume,
    setPlaybackRate: playback.setPlaybackRate,
    requestFullscreen: playback.requestFullscreen,
    exitFullscreen: playback.exitFullscreen,
    requestPictureInPicture: playback.requestPictureInPicture,
    exitPictureInPicture: playback.exitPictureInPicture,
    showAirPlayPicker: playback.showAirPlayPicker,
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
    retry: playback.retry,
    ...(engine === 'hls.js'
      ? {
          selectQuality: qualityLevels.selectQuality,
          selectTextTrack: textTracks.selectTextTrack,
          subscribeCues: textTracks.subscribeCues,
          setCaptionRenderer: textTracks.setCaptionRenderer
        }
      : {})
  };
};
