import type { CommandResult, HlsSource, PlayerError } from '@playdeck/core';
import type { NativeProviderAdapter } from '@playdeck/provider-native';
import { hlsBuildSupportsSubtitles } from './adapter-values.js';
import type {
  EmitProviderState,
  HlsConstructorLike,
  HlsEngineSelection,
  HlsInstanceLike,
  HlsModuleLoader
} from './adapter-values.js';
import type { HlsErrorRecovery } from './error-recovery.js';
import type { HlsQualityLevels } from './quality-levels.js';
import type { HlsTextTracks } from './text-tracks.js';

export type HlsAttachmentDeps = {
  readonly emit: EmitProviderState;
  readonly loadHls: HlsModuleLoader;
  readonly native: Pick<NativeProviderAdapter, 'attach' | 'load' | 'destroy'>;
  readonly textTracks: Pick<HlsTextTracks, 'handlers' | 'destroy'>;
  readonly qualityLevels: Pick<
    HlsQualityLevels,
    'prepareForStart' | 'refresh' | 'onLevelSwitched'
  >;
  readonly errorRecovery: Pick<HlsErrorRecovery, 'handleError'>;
  // Tears the engine down and publishes the fatal error state; owned by the
  // host because the error patch folds in cross-seam state.
  readonly surfaceFatal: (error: PlayerError) => void;
  // Records the authoritative hls.js liveness flag for the host's live
  // derivation.
  readonly setLiveHint: (live: boolean) => void;
  readonly emitLiveUpdate: () => void;
  // Drops the host's subscription to the embedded native adapter on destroy.
  readonly unsubscribeNative: () => void;
  // Drops the host's provider-state subscribers on destroy.
  readonly clearStateListeners: () => void;
};

// The attachment seam: the adapter's binding to its media element and
// engine — attach, load on either engine path, hls.js instance start with
// its event wiring, and teardown. Owns the attached/destroyed flags, the
// live engine instance, the cached hls.js constructor, and the start
// generation, and exposes the attachment guards every other seam depends on.
export type HlsAttachment = {
  readonly attach: () => void;
  readonly load: () => Promise<void>;
  readonly destroy: () => void;
  // Starts (or restarts) the hls.js engine; `load` and `retry` both route
  // through here.
  readonly startHlsJs: () => Promise<CommandResult>;
  // Tears down the current hls.js instance without touching provider state;
  // the fatal-error surface needs teardown apart from full destroy.
  readonly teardownEngine: () => void;
  readonly isDestroyed: () => boolean;
  readonly getInstance: () => HlsInstanceLike | undefined;
};

export const createHlsAttachment = (
  media: HTMLVideoElement,
  source: HlsSource,
  selection: HlsEngineSelection,
  {
    emit,
    loadHls,
    native,
    textTracks,
    qualityLevels,
    errorRecovery,
    surfaceFatal,
    setLiveHint,
    emitLiveUpdate,
    unsubscribeNative,
    clearStateListeners
  }: HlsAttachmentDeps
): HlsAttachment => {
  const engine = selection.engine;
  let attached = false;
  let destroyed = false;
  let hls: HlsInstanceLike | undefined;
  let hlsConstructor: HlsConstructorLike | undefined;
  let generation = 0;

  const teardownEngine = (): void => {
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

  const startHlsJs = async (): Promise<CommandResult> => {
    const startGeneration = ++generation;
    // Starting owns teardown, rather than each caller remembering it. `retry()`
    // used to do this itself and `load()` did not, so a second `load()` left
    // the previous instance attached with its listeners live, still loading
    // fragments (#85). Every handler is generation- and identity-guarded, so
    // nothing was corrupted — it was a resource leak, not a state bug. A no-op
    // on a first load, where there is nothing to tear down.
    teardownEngine();
    qualityLevels.prepareForStart();
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
    // the embedded native adapter's own caption subsystem (`native`),
    // which is always wired to the same `media.textTracks` list (it owns
    // captions for the *native* HLS engine's embedded `<track>` elements)
    // and reacts to any track's `mode` changing — including hls.js's own —
    // by re-discovering and re-applying its unrelated selection, fighting
    // hls.js over the very tracks it just created. Keeping it off is what
    // lets this engine's caption pipeline (`CUES_PARSED`, below) stay fully
    // self-contained; see the text-track seam's `setCaptionRenderer` for
    // what this costs.
    //
    // `preferManagedMediaSource: false` overrides hls.js's own default
    // (`true`), which reaches for the `ManagedMediaSource` global over plain
    // `MediaSource` wherever WebKit exposes both. Managed buffering is gated
    // on the media element actually streaming -- hls.js only appends
    // fragments between the `startstreaming`/`endstreaming` events the
    // browser fires on it -- and that event pair has a documented history of
    // not firing reliably on WebKit (video-dev/hls.js#7984, fixed for the
    // seek case in 1.6.19/1.7.1; this package is on 1.6.16). Measured on this
    // site's own bench, with this option already `false`: the ladder
    // publishes and the segments append fine on Playwright's Linux WebKit,
    // and `quality` stays `null` because the element then fails to decode
    // the appended stream (`MEDIA_ERR_DECODE`, see
    // `.out-of-scope/webkit-hls-decode.md`) -- a step past anything this
    // option gates. Plain `MediaSource` carries no such gate, which is also
    // what every other engine already uses (neither
    // Chromium nor Firefox expose `ManagedMediaSource`), so this keeps every
    // engine on the one well-exercised path rather than opting only WebKit
    // into the newer, still-fragile one.
    const instance = new HlsRuntime({
      renderTextTracksNatively: false,
      preferManagedMediaSource: false
    });
    hls = instance;
    media.addEventListener('timeupdate', textTracks.handlers.onTimeUpdate);
    instance.on(HlsRuntime.Events.ERROR, (_event, data) =>
      errorRecovery.handleError(instance, HlsRuntime, data)
    );
    instance.on(HlsRuntime.Events.LEVEL_SWITCHED, (_event, data) => {
      if (destroyed || hls !== instance) return;
      qualityLevels.onLevelSwitched(instance, data);
    });
    const buildSupportsSubtitles = hlsBuildSupportsSubtitles(HlsRuntime);
    instance.on(HlsRuntime.Events.MANIFEST_PARSED, (_event, data) => {
      if (destroyed || hls !== instance) return;
      // Text tracks before the ladder: the manifest's answer about subtitles is
      // final at this point, while the ladder is still being refreshed, so the
      // settled fact is published before the moving one.
      textTracks.handlers.onManifestParsed(data, buildSupportsSubtitles);
      qualityLevels.refresh(instance);
    });
    instance.on(HlsRuntime.Events.LEVELS_UPDATED, () => {
      if (destroyed || hls !== instance) return;
      qualityLevels.refresh(instance);
    });
    instance.on(HlsRuntime.Events.LEVEL_UPDATED, (_event, data) => {
      if (destroyed || hls !== instance) return;
      const live = (data as { details?: { live?: boolean } }).details?.live;
      if (typeof live === 'boolean') setLiveHint(live);
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
      teardownEngine();
      unsubscribeNative();
      native.destroy();
      if (engine === 'native') {
        // The native engine owns media.src (React sets none on the HLS
        // <video>); detach it so the element stops buffering the manifest.
        media.removeAttribute('src');
        media.load();
      }
      clearStateListeners();
      textTracks.destroy();
    },
    startHlsJs,
    teardownEngine,
    isDestroyed: () => destroyed,
    getInstance: () => hls
  };
};
