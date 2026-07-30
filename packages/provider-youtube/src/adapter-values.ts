import type {
  Availability,
  CommandResult,
  PlayerCapabilities,
  PlayerError,
  PlayerEventDetailMap,
  PlayerEventType,
  ProviderEventFor,
  TextTrack
} from '@reely/core';
import { textTrackLabel } from '@reely/core';

export const providerEvent = <Type extends PlayerEventType>(
  type: Type,
  detail: PlayerEventDetailMap[Type],
  originalEvent?: unknown
): ProviderEventFor<Type> => ({
  type,
  detail,
  origin: 'provider',
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
// A video without caption tracks is a property of the source, not of the
// provider — every provider reports the empty-track case the same way.
export const sourceUnavailable: Availability = {
  status: 'unavailable',
  reason: 'source'
};
const policyUnavailable: Availability = {
  status: 'unavailable',
  reason: 'policy'
};
export const browserUnavailable: Availability = {
  status: 'unavailable',
  reason: 'browser'
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
  pictureInPicture: providerUnavailable,
  airPlay: providerUnavailable,
  customControls: policyUnavailable
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

export const clamp01 = (value: number): number =>
  Math.min(1, Math.max(0, value));

// The iframe API exposes no ranges, only `getVideoLoadedFraction()`, which
// measures the end of the range the playhead sits in, never its start (#91).
// Every playhead position seen while that same range held it is a start we can
// prove, so the earliest one anchors the range -- reporting less than is
// buffered, never more, and without the start sliding along with the thumb.
export type BufferView = { readonly anchor: number; readonly end: number };

export const nextBufferView = (
  previous: BufferView | undefined,
  currentTime: number,
  end: number
): BufferView | undefined => {
  // A seek can leave the playhead outside the buffer for a poll or two, and
  // playback can outrun it entirely. Neither leaves a range to report.
  if (end <= currentTime) return undefined;
  // A playhead past the edge we knew is in a range we were not tracking, so
  // nothing we remember about the old one applies to it.
  const continuous = previous !== undefined && currentTime <= previous.end;
  return {
    anchor: continuous ? Math.min(previous.anchor, currentTime) : currentTime,
    end
  };
};

// YouTube renders captions inside its own iframe (captionRendering:
// 'provider'), so this adapter only normalizes track discovery and
// selection -- no cue overlay. Shape and field names follow the
// community-documented (unofficial) "captions" module; unverified against a
// real player (see issue #11).
export type YouTubeCaptionTrack = {
  readonly languageCode: string;
  readonly displayName?: string;
  readonly languageName?: string;
  readonly vssId?: string;
  readonly kind?: string;
};

const youtubeTextTrackId = (
  track: YouTubeCaptionTrack,
  index: number,
  tracks: readonly YouTubeCaptionTrack[]
): string =>
  tracks.filter((candidate) => candidate.languageCode === track.languageCode)
    .length > 1
    ? `youtube:${track.languageCode}:${index}`
    : `youtube:${track.languageCode}`;

export const resolveYouTubeTextTrack = (
  id: string,
  tracks: readonly YouTubeCaptionTrack[]
): YouTubeCaptionTrack | undefined =>
  tracks.find(
    (candidate, index) => youtubeTextTrackId(candidate, index, tracks) === id
  );

export const findYouTubeTextTrackId = (
  languageCode: string,
  tracks: readonly YouTubeCaptionTrack[]
): string | null => {
  const index = tracks.findIndex(
    (track) => track.languageCode === languageCode
  );
  return index === -1
    ? null
    : youtubeTextTrackId(tracks[index]!, index, tracks);
};

export const toCoreTextTracks = (
  tracks: readonly YouTubeCaptionTrack[]
): TextTrack[] =>
  tracks.map((track, index) => ({
    id: youtubeTextTrackId(track, index, tracks),
    label: textTrackLabel(
      track.displayName || track.languageName,
      track.languageCode
    ),
    language: track.languageCode,
    kind: 'captions',
    readiness: 'loaded'
  }));

export const youtubeCaptionRendering = (
  tracks: readonly YouTubeCaptionTrack[]
): 'provider' | 'unavailable' =>
  tracks.length > 0 ? 'provider' : 'unavailable';
