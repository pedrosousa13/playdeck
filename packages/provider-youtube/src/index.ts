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
  /** Embed host; defaults to the privacy-enhanced youtube-nocookie.com. */
  readonly host?: string;
  /** Overridable iframe API loader so tests can inject a fake API object. */
  readonly loadIframeApi?: () => Promise<YouTubeIframeApi>;
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
    host: options.host ?? 'https://www.youtube-nocookie.com',
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
