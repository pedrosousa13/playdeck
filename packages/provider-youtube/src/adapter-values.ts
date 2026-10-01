import {
  detectSource,
  type Availability,
  type CommandResult,
  type PlayerCapabilities,
  type PlayerError,
  type PlayerEventDetailMap,
  type PlayerEventOrigin,
  type PlayerEventType,
  type ProviderEvent,
  type ProviderEventFor,
  type ProviderStatePatch
} from '@playdeck/core';

// Publishes a provider-state patch to every subscriber, optionally paired
// with the provider event that caused it. Every seam takes this as its sink.
export type EmitProviderState = (
  patch: ProviderStatePatch,
  event?: ProviderEvent
) => void;

// `origin` defaults to `'provider'`, what every state change YouTube's own
// player reports is. `playback.ts`'s PLAYING branch is the one caller that
// passes `'system'` instead, for a loop restart this seam raised itself
// rather than the platform -- see `boundary.ts`'s `consumeLoopRestart`.
export const providerEvent = <Type extends PlayerEventType>(
  type: Type,
  detail: PlayerEventDetailMap[Type],
  originalEvent?: unknown,
  origin: PlayerEventOrigin = 'provider'
): ProviderEventFor<Type> => ({
  type,
  detail,
  origin,
  ...(originalEvent === undefined ? {} : { originalEvent })
});

export const playerStates = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5
} as const;

export const available: Availability = { status: 'available' };
const notReady: Availability = { status: 'unknown', reason: 'not-ready' };
const providerUnavailable: Availability = {
  status: 'unavailable',
  reason: 'provider'
};
const policyUnavailable: Availability = {
  status: 'unavailable',
  reason: 'policy'
};
export const browserUnavailable: Availability = {
  status: 'unavailable',
  reason: 'browser'
};

// `hqdefault.jpg`, not `maxresdefault.jpg`: the larger file is only generated
// for uploads at a resolution high enough to have one and 404s silently on
// every other video, where `hqdefault.jpg` is generated for every upload
// (#556). Derivable from the id alone, so this costs no request and the
// capability below is `available` from the first patch rather than passing
// through `unknown` first.
export const youTubePosterUrl = (videoId: string): string =>
  `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

// `isYouTubeVideoId` (`@playdeck/core`) is deliberately unbounded
// (`[A-Za-z0-9_-]+`): it also has to pass a short-host URL path segment
// before this package's own embed ever reads it, and a path keyword like
// `shorts` is itself a valid id shape that only the host/path rules above it
// rule out. `resolveYouTubePosterUrl` below has no such second rule standing
// over it, so it holds every id it is asked to build a URL for to YouTube's
// real shape -- 11 characters, always -- rather than to the wider shape
// `detectSource` stops at.
const youTubeVideoIdShape = /^[A-Za-z0-9_-]{11}$/;

/**
 * The poster still for whatever `detectSource` (`@playdeck/core`) would
 * resolve to a YouTube source -- a URL string in any form
 * [Provider setup](https://github.com/pedrosousa13/playdeck/blob/main/docs/provider-setup.md#youtube)
 * lists, or an explicit `{ type: 'youtube', videoId }` object -- and `null`
 * for anything else, including a source another provider would claim and one
 * no provider would.
 *
 * Synchronous and makes no request, reads no browser global: the still is
 * derivable from the video id alone (`youTubePosterUrl` above), which is what
 * makes this safe to call before a provider has attached, including on the
 * server and including for a `loading="interaction"` root, where
 * `poster="provider"` cannot resolve because no provider attaches until a
 * viewer's first click.
 *
 * Parses with `detectSource`, the same parser `@playdeck/react`'s `source`
 * prop resolves with, rather than a second one of this package's own, and
 * then holds the extracted id to YouTube's own shape -- exactly 11 characters
 * -- tighter than `detectSource`'s own `[A-Za-z0-9_-]+`. A look-alike host, a
 * `javascript:` or `data:` URL, an id carrying a path or query fragment, and
 * an id of the wrong length are all read `null` here the same as any other
 * input `detectSource` would refuse. The URL returned is built from a fixed
 * host -- `i.ytimg.com` -- with the id as the only interpolated part; nothing
 * this function takes can move that host.
 */
export const resolveYouTubePosterUrl = (source: unknown): string | null => {
  const detected = detectSource(source);
  if (detected.status !== 'success' || detected.source.type !== 'youtube') {
    return null;
  }
  const { videoId } = detected.source;
  return youTubeVideoIdShape.test(videoId) ? youTubePosterUrl(videoId) : null;
};

const fixedCapabilities = {
  // Enumerable but not selectable, so nothing is offered. Measured against the
  // live IFrame API (#82): `getAvailableQualityLevels()` reports a real ladder,
  // but `setPlaybackQuality()` is accepted and discarded — every level the
  // player itself offered left `getPlaybackQuality()` unmoved, as did setting a
  // level then seeking, and as did `loadVideoById({ suggestedQuality })`.
  // Asking for `tiny` failed exactly like asking for `hd720`, which is what
  // rules out a bandwidth or viewport ceiling rather than a discarded argument.
  selectQuality: providerUnavailable,
  // Selection itself is unavailable, so there is no auto mode to offer
  // alongside it either.
  selectQualityAuto: providerUnavailable,
  // The IFrame Player API documents no audio-track method and no
  // audio-track event, so this is a verdict rather than an 'unknown'.
  selectAudioTrack: providerUnavailable,
  // The IFrame Player API documents no chapter method and no chapter event,
  // and the Data API's video resource has no chapter property either. Nothing
  // resolves this later, so it is a verdict rather than an 'unknown' (#182).
  chapters: providerUnavailable,
  // `getDuration()`, `getCurrentTime()` and `getVideoLoadedFraction()` are the
  // IFrame Player API's whole surface here -- no seekable-range accessor at
  // all, so the start of a DVR window is not expressible and neither is an
  // edge to seek to. `getDuration()` is not a stand-in for one either: on a
  // 24/7 DVR stream it answered a fixed value for 150 seconds while the
  // playhead advanced (measured in the comment above the `PLAYING` branch in
  // `playback.ts`, and #403), so it is a snapshot rather than a value tracking
  // the edge.
  liveEdge: providerUnavailable,
  pictureInPicture: providerUnavailable,
  airPlay: providerUnavailable,
  // The IFrame Player API is an `<iframe>`, not a media element -- there is
  // no `remote` object for it to expose.
  remotePlayback: providerUnavailable,
  customControls: policyUnavailable,
  providerPoster: available
} as const;

export const preReadyCapabilities = (): PlayerCapabilities => ({
  seek: notReady,
  setVolume: notReady,
  setPlaybackRate: notReady,
  fullscreen: notReady,
  // Nothing is known about caption tracks until the captions module reports
  // in, so this is 'not-ready' like its siblings — not a permanent verdict.
  selectTextTrack: notReady,
  ...fixedCapabilities
});

export const readyCapabilities = (
  fullscreen: Availability,
  selectTextTrack: Availability
): PlayerCapabilities => ({
  seek: available,
  setVolume: available,
  setPlaybackRate: available,
  fullscreen,
  selectTextTrack,
  ...fixedCapabilities
});

export const playbackError = (code: number): PlayerError => {
  if (code === 101 || code === 150) {
    return {
      category: 'policy',
      fatal: true,
      recoverable: false,
      message: 'The video owner does not allow embedded playback.'
    };
  }
  if (code === 100) {
    return {
      category: 'source',
      fatal: true,
      recoverable: false,
      message: 'The YouTube video was not found or is private.'
    };
  }
  if (code === 2) {
    return {
      category: 'source',
      fatal: true,
      recoverable: false,
      message: 'The YouTube video id or player parameters are invalid.'
    };
  }
  return {
    category: 'provider',
    fatal: true,
    recoverable: true,
    message: `The YouTube player failed with error code ${code}.`
  };
};

export const blockedError = (): PlayerError => ({
  category: 'policy',
  fatal: false,
  recoverable: true,
  message:
    'YouTube did not confirm playback; autoplay was likely blocked by the browser.'
});

export const commandFailure = (
  cause: unknown
): Exclude<CommandResult, { ok: true }> => ({
  ok: false,
  reason: 'provider-error',
  error: {
    category: 'provider',
    fatal: false,
    recoverable: true,
    message:
      cause instanceof Error ? cause.message : 'The YouTube command failed.',
    cause
  }
});

export const loadFailure = (
  cause: unknown
): Exclude<CommandResult, { ok: true }> => ({
  ok: false,
  reason: 'provider-error',
  error: {
    category: 'provider',
    fatal: false,
    recoverable: true,
    message:
      cause instanceof Error
        ? cause.message
        : 'The YouTube iframe API could not be loaded.',
    cause
  }
});

// Runs one iframe API call against a player the caller has already guarded for
// readiness, keeping a throwing player inside the provider boundary. Generic
// in the player so each seam passes only the slice of it that seam calls.
export const runYouTubeCommand = async <Player>(
  current: Player | undefined,
  command: (player: Player) => void
): Promise<CommandResult> => {
  if (!current) return { ok: false, reason: 'not-ready' };
  try {
    command(current);
    return { ok: true };
  } catch (cause) {
    return commandFailure(cause);
  }
};

export const clamp01 = (value: number): number =>
  Math.min(1, Math.max(0, value));
