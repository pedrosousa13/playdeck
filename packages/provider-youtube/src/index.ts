import type {
  PlayerCapabilities,
  ProviderAdapter,
  ProviderEvent,
  ProviderStateListener
} from '@reely/core';
import { readyCapabilities } from './adapter-values.js';
import { createYouTubeAttachment } from './attachment.js';
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
   * -- deliberately Vimeo's polarity (`provider-vimeo/src/attachment.ts:61`,
   * `options.controls === true ? '1' : '0'`), so the two providers cannot
   * drift.
   */
  readonly controls?: boolean;
  /**
   * Embed host; defaults to the privacy-enhanced youtube-nocookie.com. Only
   * the two origins YouTube serves the embed from are honoured — anything
   * else falls back to that default.
   */
  readonly host?: string;
  /** Overridable iframe API loader so tests can inject a fake API object. */
  readonly loadIframeApi?: () => Promise<YouTubeIframeApi>;
};

// The privacy-enhanced embed host, and the only other origin YouTube serves
// the iframe API's embed from.
const DEFAULT_HOST = 'https://www.youtube-nocookie.com';
const EMBED_HOSTS: readonly string[] = [
  'https://www.youtube.com',
  DEFAULT_HOST
];

// `host` reaches the iframe API as the origin the embed is built from
// (`attachment.ts:146`, `host,` passed to `new api.Player`), so an origin
// unrelated to YouTube would both relocate the iframe and receive the page's
// own origin in the `origin` player var. It is checked here, where the default
// is applied, so the default and the override flow through one decision.
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
    return EMBED_HOSTS.includes(origin) ? origin : DEFAULT_HOST;
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

  const timeUpdates = createYouTubeTimeUpdates({
    emit,
    isDestroyed: () => attachment.isDestroyed(),
    getPlayer: () => attachment.getPlayer()
  });

  const playback = createYouTubePlayback({
    emit,
    isDestroyed: () => attachment.isDestroyed(),
    getPlayer: () => attachment.getPlayer(),
    getReadyPlayer: () => attachment.getReadyPlayer(),
    timeUpdates
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
    host: resolveHost(options.host),
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
