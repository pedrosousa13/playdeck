import type {
  HlsEngine,
  PlayerError,
  ProviderEvent,
  ProviderStatePatch,
  TimeRange
} from '@playdeck/core';

// Publishes a provider-state patch to every subscriber, optionally paired
// with the provider event that caused it. Every seam takes this as its sink.
export type EmitProviderState = (
  patch: ProviderStatePatch,
  event?: ProviderEvent
) => void;

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
  readonly preferManagedMediaSource?: boolean;
};

export type HlsInstanceLike = {
  readonly levels: ReadonlyArray<HlsLevelLike>;
  currentLevel: number;
  // The target live edge (behind the raw seekable end by the configured live
  // sync latency); null on VOD or before the first live level update.
  readonly liveSyncPosition?: number | null;
  readonly subtitleTracks: ReadonlyArray<HlsSubtitleTrackLike>;
  subtitleTrack: number;
  // Method shorthand, not a property-typed function, and deliberately so:
  // method parameters are checked bivariantly, so a real hls.js `Hls`, whose
  // `on` only accepts its own `keyof HlsListeners`, satisfies this. Written as
  // `on: (event: string, ...) => void` it did not, and every consumer passing
  // `loadHls: () => import('hls.js')` — the form this package's README
  // documents — needed `as unknown as`. This adapter only ever calls `on` with
  // names taken from the constructor's own `Events`.
  on(event: string, listener: (event: string, data: unknown) => void): void;
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
    readonly MEDIA_ATTACHED: string;
    readonly SUBTITLE_TRACKS_UPDATED: string;
    readonly SUBTITLE_TRACK_SWITCH: string;
    readonly CUES_PARSED: string;
  };
  readonly ErrorTypes: {
    readonly NETWORK_ERROR: string;
    readonly MEDIA_ERROR: string;
  };
  // Read by `hlsBuildSupportsSubtitles` alone, and optional because a build
  // that does not expose it is treated as capable rather than as incapable.
  readonly DefaultConfig?: {
    readonly subtitleTrackController?: unknown;
  };
};

export type HlsModuleLoader = () => Promise<{
  readonly default: HlsConstructorLike;
}>;

/**
 * Whether the hls.js build in hand carries the machinery that surfaces subtitle
 * tracks, read off the constructor's own default config.
 *
 * `hls.js/light` ships no `SubtitleTrackController` and no
 * `SubtitleStreamController`, so it parses a manifest's subtitle renditions,
 * reports them once on `MANIFEST_PARSED`, and then never emits
 * `SUBTITLE_TRACKS_UPDATED` for them. A consumer reaches that build through
 * `loadHls`, which exists so a build can be pinned or swapped, and it saves
 * about 53 KB gzip over the full build by compiling this machinery out along
 * with alternate audio, CMCD, EME and Variable Substitution.
 *
 * Read from `DefaultConfig` rather than waited for: the controllers are absent
 * from the constructor before anything has loaded, so the answer is synchronous
 * and needs no deadline. The event *names* are no use for the same question --
 * `Events` is one shared enum and carries `SUBTITLE_TRACKS_UPDATED` in both
 * builds. What the light build lacks is the controller that emits it.
 *
 * A build exposing no `DefaultConfig` at all reads as capable, so an
 * unrecognised one reports what it always did rather than being called
 * incapable on the strength of a field this package went looking for.
 */
export const hlsBuildSupportsSubtitles = (Hls: HlsConstructorLike): boolean =>
  Hls.DefaultConfig === undefined ||
  typeof Hls.DefaultConfig.subtitleTrackController === 'function';

export const readMediaRanges = (
  ranges: globalThis.TimeRanges
): ReadonlyArray<TimeRange> =>
  Array.from({ length: ranges.length }, (_, index) => ({
    start: ranges.start(index),
    end: ranges.end(index)
  }));

export const unsupportedSelection = (message: string): HlsEngineSelection => ({
  engine: null,
  error: {
    category: 'unsupported',
    fatal: true,
    recoverable: false,
    message
  }
});
