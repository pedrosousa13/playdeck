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
  // Whether retrying can change the outcome, and the one signal a control reads
  // to decide whether to offer a retry — never the category, which says what
  // went wrong rather than what a retry would do. Every `configuration` error
  // carries `false`: the remedy for one is a change the consumer makes, so a
  // retry re-runs the same rejected configuration and republishes the same
  // error (#198).
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

export type TextCue = {
  readonly id: string | null;
  readonly startTime: number;
  readonly endTime: number;
  readonly text: string;
};

// The media's own pixel dimensions, not the layout box it is drawn into.
// Numbers only: core's public types compile with `"lib": ["ES2022"]`, so no
// element the figures were read off may appear here.
export type MediaDimensions = {
  readonly width: number;
  readonly height: number;
};

export type CommandResult =
  | { ok: true }
  | { ok: false; reason: CommandFailureReason; error?: PlayerError };

// `'audible-then-muted'` attempts audible playback and, only when that attempt
// is refused by policy (`reason: 'blocked'`), mutes and attempts once more.
// Any other failure is reported as it is, unretried. `'muted'` and `'audible'`
// keep their strict meanings: neither ever changes what the other does (#306).
export type AutoplayMode = false | 'muted' | 'audible' | 'audible-then-muted';

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

export type PlayerProvider = 'native' | 'hls' | 'youtube' | 'vimeo' | 'wistia';

export type HlsEngine = 'native' | 'hls.js';

export type PlayerQuality = {
  readonly id: string;
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
  // True only where `autoplay` is `'started'` because an audible attempt was
  // refused by policy and the muted retry of `'audible-then-muted'` is what
  // played. It is what tells a deliberate muted autoplay apart from a recovered
  // one, so a consumer can offer an unmute affordance. False everywhere else,
  // the in-flight retry included: the recovery is only recorded once playback
  // has started (#306).
  readonly autoplayRecovered: boolean;
  readonly provider: PlayerProvider | null;
  readonly hlsEngine: HlsEngine | null;
  readonly quality: PlayerQuality | null;
  // `quality` above is the level playing right now, and moves on its own under
  // adaptive selection; `selectedQualityId` is what the consumer chose, `null`
  // meaning auto. A menu needs both: the selection checks a radio item, the
  // active level labels the auto row ("Auto (1080p)").
  readonly qualities: readonly PlayerQuality[];
  readonly selectedQualityId: string | null;
  readonly capabilities: PlayerCapabilities;
  readonly error: PlayerError | null;
  readonly textTracks: readonly TextTrack[];
  readonly selectedTextTrackId: string | null;
  readonly captionRendering: CaptionRendering;
  // Declared by the provider adapter, not derived here: it means a command
  // issued now is accepted *and* will not be undone by a load that has yet to
  // run. Core cannot compute it — the four adapters open their command guards
  // at four different moments (#69).
  readonly commandsReady: boolean;
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

export type WistiaSource = { type: 'wistia'; mediaId: string };

export type PlayerSource =
  | string
  | VideoFileSource
  | HlsSource
  | YouTubeSource
  | VimeoSource
  | WistiaSource;

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
  selectQuality?: (id: string | null) => Promise<CommandResult>;
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
  // A side channel like `subscribeCues`, and deliberately not `PlayerState`:
  // the React layer writes the ratio straight to the DOM, so routing it
  // through state would re-render every state consumer on every source and
  // dimension change. `undefined` is how "not known" is expressed — including
  // clearing.
  subscribeDimensions?: (
    listener: (dimensions: MediaDimensions | undefined) => void
  ) => () => void;
  setCaptionRenderer?: (mode: 'custom' | 'native') => void;
};
