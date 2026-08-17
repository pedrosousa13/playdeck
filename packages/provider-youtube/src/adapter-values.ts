import type {
  Availability,
  CommandResult,
  PlayerCapabilities,
  PlayerError,
  PlayerEventDetailMap,
  PlayerEventType,
  ProviderEvent,
  ProviderEventFor,
  ProviderStatePatch
} from '@reely/core';

// Publishes a provider-state patch to every subscriber, optionally paired
// with the provider event that caused it. Every seam takes this as its sink.
export type EmitProviderState = (
  patch: ProviderStatePatch,
  event?: ProviderEvent
) => void;

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
  // The IFrame Player API documents no chapter method and no chapter event,
  // and the Data API's video resource has no chapter property either. Nothing
  // resolves this later, so it is a verdict rather than an 'unknown' (#182).
  chapters: providerUnavailable,
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
