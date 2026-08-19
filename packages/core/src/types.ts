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

// One named division of a video's timeline. No provider reports an end time —
// Vimeo publishes only a start and a title, and a WebVTT chapter cue's own end
// is not guaranteed to abut the next cue — so `endTime` is the library's own
// derivation: the next chapter's `startTime`, and for the last chapter the
// media duration, which is why it is nullable rather than a number. There is
// no `index`: the position in the collection already carries it (#182).
export type Chapter = {
  readonly id: string;
  readonly title: string;
  readonly startTime: number;
  readonly endTime: number | null;
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
  // Opts out of the `prefers-reduced-motion: reduce` suppression, so a
  // configured autoplay is attempted whatever the viewer asked for. Named for
  // what it does rather than for the case it enables, so a consumer reading the
  // call site sees a deliberate accessibility trade-off (#311).
  readonly ignoreReducedMotion?: boolean;
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
  // Whether the provider can report chapters at all, which is what tells a
  // provider that cannot ('unavailable' with the `provider` reason) apart from
  // a source that simply has none (the `source` reason) — both publish an
  // empty `chapters` collection (#182).
  readonly chapters: Availability;
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
  // Where the seek in flight came from, and `null` whenever `seeking` is false
  // — a seek that is not happening has no provenance. `seeking` keeps its plain
  // boolean meaning; this is the additive field beside it. The library's own
  // requests are labelled with the origin their command carried (`'user'` from
  // a control, `'api'` from an untagged public command), and a seek nobody
  // asked for keeps the `'provider'` the adapter stamps it with (#186).
  readonly seekOrigin: PlayerEventOrigin | null;
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
  // `'suppressed'` means configured but deliberately not attempted, because the
  // viewer matches `prefers-reduced-motion: reduce` and the player was not told
  // to ignore it. It is a member of its own because `'idle'` already covers "no
  // autoplay configured", so without it a consumer cannot tell a suppressed
  // autoplay from one that never existed. Only the attempt is declined, so a
  // consumer reading this state gets a new member to handle and no behaviour
  // change anywhere else: the React poster gate never enumerated the autoplay
  // states, so `'suppressed'` falls through it and holds the poster over the
  // frame exactly as `'blocked'` does (#311).
  readonly autoplay:
    'idle' | 'attempting' | 'started' | 'blocked' | 'failed' | 'suppressed';
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
  // Ordered by ascending `startTime`, and empty both where the provider cannot
  // report chapters and where the source has none — `capabilities.chapters` is
  // what tells those two apart. Never routed through `textTracks`: nothing
  // downstream of that collection filters on kind, so a chapters track in it
  // would reach the captions menu, the captions toggle and the cue overlay
  // (#182).
  readonly chapters: readonly Chapter[];
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

// The consumer-supplied URL props the shared allowlist governs outside a
// provider — the five surfaces #320 routed through `isPermittedSourceUrl` and
// left silent. Named for the prop the consumer wrote, because the prop is what
// the operator has to go and fix.
//
// A closed union rather than a `string`, deliberately. `reportRefusedUrl` is
// reached from React components holding the value that was just refused, and a
// free-form parameter is an open invitation to pass it along "for context" —
// which would put attacker-controlled text into an error a monitor may log and
// `ErrorDisplay` may render. The type makes that impossible rather than
// discouraged, and the notice message is built in core from this key alone
// (#330).
export type RefusedUrlSurface =
  | 'poster src'
  | 'poster srcSet'
  | 'nativePoster'
  | 'textTracks src'
  | 'mediaSession artwork';

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
