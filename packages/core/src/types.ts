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

// How much a Notice matters when two of them contend for the single error slot.
// `'protective'` means a control that protects the viewer fired — an untrusted
// URL was blocked, a privacy opt-out did not take — and `'presentational'` means
// a cosmetic option was ignored and the fall-back is what the viewer sees. Two
// levels and no more: the one question the slot has to answer is which of two
// notices an operator most needs to hear, and a third level would only invite a
// judgement call at each notice site (#368).
export type PlayerErrorSeverity = 'protective' | 'presentational';

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
  // What the slot ranks two Notices by, and read nowhere else — a category that
  // is not a notice never contends for the slot against one, so nothing is
  // gained by rating a decode failure. Optional deliberately: `PlayerError`
  // carries every category, and a provider outside this repo emits notices
  // through the same patch, so an absent severity has to keep working. It is
  // read as `'presentational'` — the level that displaces nothing — because a
  // notice that has not claimed to protect anyone must not outrank one that has
  // (#368).
  readonly severity?: PlayerErrorSeverity;
  readonly message: string;
  readonly cause?: unknown;
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

// A play command that was turned down, as `PlayerState.refusedPlay` publishes
// it. It answers one question — was a play refused, and who asked for it — for
// every trigger there is, so a consumer never assembles that answer out of two
// unrelated fields (#361).
//
// `origin` is the Requested origin the command carried: `'user'` for a
// `PlayButton` press or any other control a person operated, `'api'` for an
// untagged public command, `'autoplay'` for autoplay's own attempt. It is what
// separates the case this exists for — the viewer pressed play and nothing
// happened — from a refused autoplay, with no second field to consult.
//
// `reason` is the `CommandFailureReason` off the `CommandResult` the caller
// received, unchanged, so a policy refusal is not read as a provider fault.
//
// The `PlayerError` that result may also carry is deliberately absent. The
// state has one error slot; a refused play must not take it, because
// `ErrorDisplay` renders whatever is in it and presenting a refusal is exactly
// the decision `.out-of-scope/default-presentation-on-blocked-autoplay.md`
// declines to make on a consumer's behalf. Repeating the error here instead
// would give one `PlayerError` two homes with two different clearing rules,
// which is worse than not publishing the message at all: `reason` is the part
// a consumer branches on, and the copy is theirs to write.
export type RefusedPlay = {
  readonly origin: PlayerEventOrigin;
  readonly reason: CommandFailureReason;
};

// The commands a `RefusedCommand` can name — every command a consumer may issue
// through `PlayerController`, with the two seek entry points collapsed into the
// one command a viewer performed.
//
// `retry` is deliberately not a member. The `not-ready` it raises is its
// generation-moved guard, reached with a provider already attached, so the very
// attach that moved the generation would withdraw the refusal it caused. That
// is a moment, and this vocabulary exists for a condition — see
// `RefusedCommand`. Keeping it out of the type is what keeps it out of both of
// its refusal sites, rather than published from one and not the other.
export type PlayerCommand =
  | 'play'
  | 'pause'
  | 'seek'
  | 'mute'
  | 'unmute'
  | 'setVolume'
  | 'setPlaybackRate'
  | 'selectQuality'
  | 'selectTextTrack'
  | 'requestFullscreen'
  | 'exitFullscreen'
  | 'requestPictureInPicture'
  | 'exitPictureInPicture'
  | 'showAirPlayPicker';

// A command turned down because no provider was attached, as
// `PlayerState.refusedCommand` publishes it. It is the general half of
// `RefusedPlay`: that one answers "was a play refused, and who asked" for every
// way a play can be refused, and this one answers "was anything I asked for
// refused before there was anything to ask it of", for every command there is.
// One field rather than one slot per command, so a consumer never ORs eleven of
// them together — the assembly `RefusedPlay` exists to prevent.
//
// **Its lifetime is the pre-attach window.** The refusal stands from the moment
// it is made until a provider attaches, and attach is what withdraws it, in the
// same synchronous update that publishes `activation: 'loading-provider'`. So
// no snapshot ever reports a provider in hand beside a refusal that says there
// was none. Nothing else clears it, because nothing else can make "no provider
// was attached" stop being true; a later refusal replaces it, and a refusal
// nothing followed simply stands.
//
// `reason` is the literal `'not-ready'` and never another
// `CommandFailureReason`. No other one has a clearing rule that would keep this
// a condition rather than a log: `unsupported` is already published per command
// as `PlayerCapabilities`, and a `blocked` or a `provider-error` on a
// `setVolume` is a moment with no natural end. Admitting them would make this a
// record of things that happened, which is the shape #361 rejected.
//
// `origin` is the Requested origin the command carried, and `null` where it
// carried none: only play, pause and seek have `*WithOrigin` entry points, and
// the rest share one command path with nothing to tag them with. Note this is
// not the `null` of `PlayerState.seekOrigin`, which means no seek is in flight.
// Here it means the origin was never recorded — not that nobody asked.
//
// A pre-attach play fills this AND `refusedPlay`, deliberately, the way an
// autoplay refused by policy already fills both `refusedPlay` and `autoplay`.
// The two are not one field because they do not end together: `refusedPlay`
// carries any reason and is cleared by confirmed playback, this carries one
// reason and is cleared by attach. Ask this field which command, and
// `refusedPlay` about the play.
export type RefusedCommand = {
  readonly command: PlayerCommand;
  readonly origin: PlayerEventOrigin | null;
  readonly reason: 'not-ready';
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
  // The last play command refused against the media attached now, and `null`
  // while none stands. A refusal is a moment and a field is a condition, so
  // what this states is the condition: the last play command this controller
  // issued was refused, and nothing has played since. It is cleared by the
  // patch that confirms playback and by the provider changing, and by nothing
  // else — a pause, a seek, a stall or an error does not make the refusal
  // untrue (#361).
  //
  // Commands settle out of order, and the condition holds through that: a
  // refusal reported by a play that a later play replaced, or that playback
  // was confirmed after, is never published at all — a later pause does not
  // bring it back. Nor is one refused while playback is already `'playing'`,
  // which would say nothing is playing while something is. The caller of such
  // a command still receives its `CommandResult` unchanged; it is this field
  // that declines to state a thing that has stopped being true.
  //
  // Beside `autoplay` rather than folded into it, and it replaces neither
  // `'blocked'` nor `'failed'`: `autoplay` reports the autoplay machine, whose
  // `'attempting'`, `'suppressed'`, `'started'` and recovered members are
  // states no record of a refusal could carry, while this reports the command.
  // An autoplay refused by policy therefore appears in both, and
  // `origin: 'autoplay'` is what says which one it was. That is the whole
  // story about which applies when: ask this field about the refusal, and
  // `autoplay` about autoplay.
  readonly refusedPlay: RefusedPlay | null;
  // The last command turned down for want of a provider, and `null` while none
  // stands. Every control this library ships is rendered, enabled and operable
  // before a provider attaches, so a command issued in that window is refused
  // with `not-ready` and the caller may be the only party that hears of it.
  // This is where the refusal is stated for the consumer who is not the caller
  // — no control presents it, and none gains a `disabled` attribute on the
  // strength of it. Cleared by attach and by nothing else: see
  // `RefusedCommand`, which also says why a pre-attach play fills both this and
  // `refusedPlay`.
  readonly refusedCommand: RefusedCommand | null;
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
