import {
  isYouTubeVideoId,
  notifySafely,
  type CommandResult,
  type PlayerCapabilities,
  type PlayerError,
  type ProviderAdapter,
  type ProviderEvent,
  type ProviderStateListener
} from '@playdeck/core';
import { providerEvent, readyCapabilities } from './adapter-values.js';
import { createYouTubeAttachment } from './attachment.js';
import { createYouTubeBoundary } from './boundary.js';
import { loadYouTubeIframeApi, type YouTubeIframeApi } from './loader.js';
import { createYouTubePlayback } from './playback.js';
import { createYouTubePresentation } from './presentation.js';
import { createYouTubeTextTracks } from './text-tracks.js';
import { createYouTubeTimeUpdates } from './time-updates.js';

export {
  API_READY_TIMEOUT_MS,
  loadYouTubeIframeApi,
  resetYouTubeIframeApiLoader,
  type YouTubeIframeApi,
  type YouTubePlayer,
  type YouTubePlayerConstructor,
  type YouTubePlayerEventHandlers,
  type YouTubePlayerOptions
} from './loader.js';

export { PLAYBACK_CONFIRMATION_TIMEOUT_MS } from './playback.js';
export { PLAYER_READY_TIMEOUT_MS } from './attachment.js';

export type YouTubeProviderOptions = {
  /**
   * Show YouTube's own player chrome. Unset and `false` both mean chromeless
   * -- deliberately Vimeo's polarity (`provider-vimeo/src/attachment.ts:62`,
   * `options.controls === true ? '1' : '0'`), so the two providers cannot
   * drift.
   */
  readonly controls?: boolean;
  /**
   * Restart the video when it ends. `Root`'s `loop` prop is folded into this
   * bag by `packages/react/src/root.tsx`'s `resolvedProviderOptions`, so
   * `PlayerProviderOptions` omits the key and this is not a second home for
   * the setting (ADR-0004).
   */
  readonly loop?: boolean;
  /**
   * Start playback at this offset in seconds. A non-finite or non-positive
   * value is no start at all. `Root`'s `startTime` prop is folded into this
   * bag by `packages/react/src/root.tsx`, so `PlayerProviderOptions` omits the
   * key and this is not a second home for the setting (ADR-0004).
   */
  readonly startTime?: number;
  /**
   * End playback at this offset in seconds, publishing `ended` there rather
   * than at the end of the video. A value that is non-finite, or not above the
   * sanitised `startTime`, is no end at all; one past the video's duration is
   * clamped to it. Folded in from `Root`'s `endTime` prop exactly as
   * `startTime` is (ADR-0004).
   *
   * YouTube has no end mechanism this adapter can trust, so the boundary is
   * enforced from the 250 ms position poll. It can therefore overshoot by up
   * to that much before the end is published; the published `currentTime` is
   * the boundary itself.
   */
  readonly endTime?: number;
  /**
   * Embed host; defaults to the privacy-enhanced youtube-nocookie.com. Only
   * the two origins YouTube serves the embed from are honoured — anything
   * else falls back to that default.
   */
  readonly host?: string;
  /** Overridable iframe API loader so tests can inject a fake API object. */
  readonly loadIframeApi?: () => Promise<YouTubeIframeApi>;
};

// The privacy-enhanced embed host, and the two origins YouTube serves the
// iframe API's embed from. `DEFAULT_HOST` is named for the iframe API option
// it feeds; the allowlist holds origins, which is what the check below parses
// a `host` down to before comparing.
const DEFAULT_HOST = 'https://www.youtube-nocookie.com';
const EMBED_ORIGINS: readonly string[] = [
  'https://www.youtube.com',
  DEFAULT_HOST
];

// `host` is the origin the embed url is built from (`attachment.ts:193`,
// `host` passed to `youTubeEmbedUrl`), so an origin unrelated to YouTube would
// both relocate the iframe and receive the page's own origin in the `origin`
// player var that url carries. It is checked here, where the default
// is applied — the provider factory every consumer of this package passes
// through, not only those coming via `Player.Root` — so the default and the
// override flow through one decision.
//
// Compared on the parsed origin rather than the string: that resolves a
// trailing slash and letter case to the spelling the allowlist holds, instead
// of reading either as a third host. An unrecognised origin falls back rather
// than throwing — a misconfigured `host` must degrade to the safe embed, not
// break the page — and `new URL()` rejecting a malformed or empty value is the
// same answer. That degrade used to be silent; `rejected` below is what makes
// it a reported `configuration` notice instead, published to every subscriber
// by `createYouTubeProvider` (#235).
//
// Answers both the resolved host and whether `host` was rejected from the one
// parse: a separate `hostRejected` used to re-run this exact shape — the same
// `new URL(host)`, the same allowlist check, the same `catch` — to answer a
// second question about the same value at the same construction site. `host`
// still always answers with a value, silently defaulting when the input is
// `undefined`; `rejected` is the fact beside it — `false` for `undefined`,
// `true` for anything else that misses the allowlist — which is what tells
// `createYouTubeProvider` whether the degrade above is worth a notice (#235).
const resolveHost = (
  host: string | undefined
): { readonly host: string; readonly rejected: boolean } => {
  if (host === undefined) return { host: DEFAULT_HOST, rejected: false };
  try {
    const { origin } = new URL(host);
    return EMBED_ORIGINS.includes(origin)
      ? { host: origin, rejected: false }
      : { host: DEFAULT_HOST, rejected: true };
  } catch {
    return { host: DEFAULT_HOST, rejected: true };
  }
};

// What a rejected `host` publishes. Never `recoverable`: the fix is a
// different `host` value, so a retry would just replay the same rejection
// (#198). Names the option rather than echoing the rejected value, which is
// exactly what a misconfigured `host` would have disclosed the page to
// (`attachment.ts:193`'s `origin` player var).
const hostConfigurationNotice: PlayerError = {
  category: 'configuration',
  fatal: false,
  recoverable: false,
  message: 'The host option was rejected, so the default host was used.'
};

type YouTubeCommand =
  | 'play'
  | 'pause'
  | 'seekTo'
  | 'seekBy'
  | 'mute'
  | 'unmute'
  | 'setVolume'
  | 'setPlaybackRate'
  | 'requestFullscreen'
  | 'exitFullscreen'
  | 'retry'
  | 'selectTextTrack';

export type YouTubeProviderAdapter = ProviderAdapter &
  Required<Pick<ProviderAdapter, YouTubeCommand>> & {
    readonly provider: 'youtube';
  };

// Every command this adapter never has a live handle for, no matter which one
// is asked: there is no player behind a rejected id, so every command answers
// the same as one issued before a real handle has arrived (`not-ready`,
// `attachment.ts`'s `retry` on a destroyed adapter).
const rejectedCommand = async (): Promise<CommandResult> => ({
  ok: false,
  reason: 'not-ready'
});

// Built instead of the normal composition when `videoId` fails
// `isYouTubeVideoId`, so `createYouTubeAttachment` (and the boundary/playback/
// presentation/text-tracks/time-updates seams under it) are never called on
// this path — no iframe API load, no `new api.Player(...)` call, no `playlist`
// var written, by construction rather than by care. `attach`/`load`/`retry`
// are permanent no-ops, `destroy` is idempotent, and every subscriber --
// present or future -- is handed the same fixed `source` error immediately,
// so a late subscriber sees it too rather than missing it.
const createRejectedYouTubeProvider = (): YouTubeProviderAdapter => {
  const error: PlayerError = {
    category: 'source',
    fatal: true,
    recoverable: true,
    message: 'The YouTube video id is not a supported format.'
  };

  return {
    provider: 'youtube',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    // Called straight rather than through `notifySafely`: this is the one call
    // a `subscribe` makes at registration, on the subscriber's own stack, and
    // not a fan-out — only the emits after registration are the emitter's to
    // isolate (#233).
    subscribe: (listener) => {
      listener(
        {
          lifecycle: 'error',
          activation: 'error',
          commandsReady: false,
          error
        },
        providerEvent('error', error)
      );
      return () => undefined;
    },
    play: rejectedCommand,
    pause: rejectedCommand,
    seekTo: rejectedCommand,
    seekBy: rejectedCommand,
    mute: rejectedCommand,
    unmute: rejectedCommand,
    setVolume: rejectedCommand,
    setPlaybackRate: rejectedCommand,
    requestFullscreen: rejectedCommand,
    exitFullscreen: rejectedCommand,
    retry: rejectedCommand,
    selectTextTrack: rejectedCommand
  };
};

export const createYouTubeProvider = (
  mount: HTMLElement,
  videoId: string,
  options: YouTubeProviderOptions = {}
): YouTubeProviderAdapter => {
  if (!isYouTubeVideoId(videoId)) return createRejectedYouTubeProvider();

  const listeners = new Set<ProviderStateListener>();

  // Decided once, at construction — `host` does not change after that, so
  // neither does the resolved value or whether it was rejected.
  const { host: resolvedHost, rejected: hostWasRejected } = resolveHost(
    options.host
  );
  const hostNotice = hostWasRejected ? hostConfigurationNotice : undefined;

  const emit = (
    patch: Parameters<ProviderStateListener>[0],
    event?: ProviderEvent
  ): void =>
    listeners.forEach((listener) => notifySafely(listener, patch, event));

  // The poll is where the window is enforced and the window drives the poll,
  // so one of the two has to reach the other lazily; the seams below reach
  // `attachment` the same way.
  const timeUpdates = createYouTubeTimeUpdates({
    emit,
    isDestroyed: () => attachment.isDestroyed(),
    getPlayer: () => attachment.getPlayer(),
    boundary: { onTimeReport: (time) => boundary.onTimeReport(time) }
  });

  const boundary = createYouTubeBoundary(options, {
    emit,
    isDestroyed: () => attachment.isDestroyed(),
    getPlayer: () => attachment.getPlayer(),
    timeUpdates
  });

  const playback = createYouTubePlayback({
    emit,
    isDestroyed: () => attachment.isDestroyed(),
    getPlayer: () => attachment.getPlayer(),
    getReadyPlayer: () => attachment.getReadyPlayer(),
    timeUpdates,
    boundary
  });

  const presentation = createYouTubePresentation(mount, {
    emit,
    isDestroyed: () => attachment.isDestroyed(),
    hasPlayer: () => attachment.getPlayer() !== undefined,
    getIframe: () => attachment.getIframe()
  });

  const textTracks = createYouTubeTextTracks({
    emit,
    getReadyPlayer: () => attachment.getReadyPlayer(),
    getCapabilities: playerCapabilities
  });

  // The capabilities a ready player has, folding the two seams that decide
  // them together. Recomputed on every publication: both answers change with
  // the player, not with the adapter.
  function playerCapabilities(): PlayerCapabilities {
    return readyCapabilities(
      presentation.fullscreenAvailability(),
      textTracks.selectTextTrackAvailability()
    );
  }

  const attachment = createYouTubeAttachment(mount, videoId, {
    emit,
    controls: options.controls,
    loop: options.loop,
    host: resolvedHost,
    boundary,
    loadIframeApi: options.loadIframeApi ?? loadYouTubeIframeApi,
    getCapabilities: playerCapabilities,
    playback,
    presentation,
    textTracks,
    timeUpdates,
    clearStateListeners: () => listeners.clear()
  });

  return {
    provider: 'youtube',
    attach: attachment.attach,
    load: attachment.load,
    destroy: attachment.destroy,
    subscribe: (listener) => {
      listeners.add(listener);
      // Called straight rather than through `notifySafely`, for the same
      // reason `createRejectedYouTubeProvider`'s `subscribe` is: this is the
      // one call a `subscribe` makes at registration, on the subscriber's own
      // stack, and not a fan-out (#233). Run on every registration, not once
      // at construction, so a subscriber that registers after this one still
      // sees the notice (#235).
      if (hostNotice) listener({ error: hostNotice });
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
    selectTextTrack: textTracks.selectTextTrack,
    requestFullscreen: presentation.requestFullscreen,
    exitFullscreen: presentation.exitFullscreen,
    retry: attachment.retry
  };
};
