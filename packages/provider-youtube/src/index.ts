import type {
  PlayerCapabilities,
  ProviderAdapter,
  ProviderEvent,
  ProviderStateListener
} from '@reely/core';
import { readyCapabilities } from './adapter-values.js';
import { createYouTubeAttachment } from './attachment.js';
import { createYouTubeBoundary } from './boundary.js';
import { loadYouTubeIframeApi, type YouTubeIframeApi } from './loader.js';
import { createYouTubePlayback } from './playback.js';
import { createYouTubePresentation } from './presentation.js';
import { createYouTubeTextTracks } from './text-tracks.js';
import { createYouTubeTimeUpdates } from './time-updates.js';

export {
  loadYouTubeIframeApi,
  type YouTubeIframeApi,
  type YouTubePlayer,
  type YouTubePlayerConstructor,
  type YouTubePlayerEventHandlers,
  type YouTubePlayerOptions
} from './loader.js';

export { PLAYBACK_CONFIRMATION_TIMEOUT_MS } from './playback.js';

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

// `host` reaches the iframe API as the origin the embed is built from
// (`attachment.ts:146`, `host,` passed to `new api.Player`), so an origin
// unrelated to YouTube would both relocate the iframe and receive the page's
// own origin in the `origin` player var. It is checked here, where the default
// is applied — the provider factory every consumer of this package passes
// through, not only those coming via `Player.Root` — so the default and the
// override flow through one decision.
//
// Compared on the parsed origin rather than the string: that resolves a
// trailing slash and letter case to the spelling the allowlist holds, instead
// of reading either as a third host. An unrecognised origin falls back rather
// than throwing — a misconfigured `host` must degrade to the safe embed, not
// break the page — and `new URL()` rejecting a malformed or empty value is the
// same answer.
const resolveHost = (host: string | undefined): string => {
  if (host === undefined) return DEFAULT_HOST;
  try {
    const { origin } = new URL(host);
    return EMBED_ORIGINS.includes(origin) ? origin : DEFAULT_HOST;
  } catch {
    return DEFAULT_HOST;
  }
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

export const createYouTubeProvider = (
  mount: HTMLElement,
  videoId: string,
  options: YouTubeProviderOptions = {}
): YouTubeProviderAdapter => {
  const listeners = new Set<ProviderStateListener>();

  const emit = (
    patch: Parameters<ProviderStateListener>[0],
    event?: ProviderEvent
  ): void => listeners.forEach((listener) => listener(patch, event));

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
    host: resolveHost(options.host),
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
