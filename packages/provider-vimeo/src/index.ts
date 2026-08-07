import type {
  PlayerCapabilities,
  ProviderAdapter,
  ProviderEvent,
  ProviderStateListener,
  VimeoSource
} from '@reely/core';
import { available, type VimeoMountElement } from './adapter-values.js';
import { createVimeoAttachment } from './attachment.js';
import { createVimeoBoundary } from './boundary.js';
import { createVimeoChromelessAvailability } from './chromeless-availability.js';
import { createVimeoPlayback } from './playback.js';
import { createVimeoPresentation } from './presentation.js';
import { createVimeoQualityLevels } from './quality-levels.js';
import { createVimeoTextTracks } from './text-tracks.js';

export type { VimeoMountElement } from './adapter-values.js';
export { loadVimeoSdk, resetVimeoSdkLoader } from './loader.js';
export type {
  VimeoSdkConstructor,
  VimeoSdkEventListener,
  VimeoSdkModule,
  VimeoSdkPlayer,
  VimeoSdkQuality,
  VimeoSdkTextTrack
} from './loader.js';

export type VimeoProviderOptions = {
  readonly controls?: boolean;
  readonly dnt?: boolean;
  /**
   * Restart the video when it ends. `Root`'s `loop` prop is folded into this
   * bag by `packages/react/src/root.tsx`'s `resolvedProviderOptions`, so
   * `PlayerProviderOptions` omits the key and this is not a second home for
   * the setting (ADR-0004).
   */
  readonly loop?: boolean;
  /**
   * Where playback begins, in seconds. Written to the embed url as a `#t=`
   * load hint and then seeked to once the player is ready, which is what
   * actually holds. A non-finite or non-positive value is no start.
   *
   * Like `loop`, `Root`'s `startTime` prop is folded into this bag by
   * `packages/react/src/root.tsx`, so `PlayerProviderOptions` omits the key
   * and this is not a second home for the setting (ADR-0004).
   */
  readonly startTime?: number;
  /**
   * Where playback ends, in seconds. Vimeo has no end mechanism of its own, so
   * this adapter enforces it: reaching the boundary publishes `ended`, or
   * restarts from `startTime` when `loop` is on. An end that is not finite, or
   * not above the sanitised start, is no end; one past the duration is clamped
   * to it.
   *
   * Folded in from `Root`'s `endTime` prop and omitted from
   * `PlayerProviderOptions` the same way `loop` and `startTime` are (ADR-0004).
   */
  readonly endTime?: number;
  readonly customControls?: boolean;
};

type VimeoCommand =
  | 'play'
  | 'pause'
  | 'seekTo'
  | 'seekBy'
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
  | 'retry';

export type VimeoProviderAdapter = ProviderAdapter &
  Required<Pick<ProviderAdapter, VimeoCommand>> & {
    readonly provider: 'vimeo';
  };

export const createVimeoProvider = (
  mount: VimeoMountElement,
  source: VimeoSource,
  options: VimeoProviderOptions = {}
): VimeoProviderAdapter => {
  const listeners = new Set<ProviderStateListener>();

  const emit = (
    patch: Parameters<ProviderStateListener>[0],
    event?: ProviderEvent
  ): void => listeners.forEach((listener) => listener(patch, event));

  const chromeless = createVimeoChromelessAvailability({ source, options });

  const boundary = createVimeoBoundary(options);

  const playback = createVimeoPlayback(mount, {
    emit,
    isStale: (player) => attachment.isStale(player),
    getPlayer: () => attachment.getPlayer(),
    getCapabilities: playerCapabilities,
    boundary
  });

  const qualityLevels = createVimeoQualityLevels({
    emit,
    getPlayer: () => attachment.getPlayer()
  });

  const presentation = createVimeoPresentation({
    emit,
    getPlayer: () => attachment.getPlayer(),
    getCapabilities: playerCapabilities
  });

  const textTracks = createVimeoTextTracks({
    emit,
    isStale: (player) => attachment.isStale(player),
    getPlayer: () => attachment.getPlayer(),
    getCurrentTime: playback.getCurrentTime,
    getCapabilities: playerCapabilities
  });

  // The capabilities this embed has, folding every seam that decides one
  // together. Recomputed on every publication: each answer changes with the
  // player and the account tier behind it, not with the adapter.
  function playerCapabilities(): PlayerCapabilities {
    return {
      seek: available,
      setVolume: playback.setVolumeAvailability(),
      setPlaybackRate: playback.setPlaybackRateAvailability(),
      selectQuality: qualityLevels.selectQualityAvailability(),
      selectTextTrack: textTracks.selectTextTrackAvailability(),
      fullscreen: available,
      pictureInPicture: presentation.pictureInPictureAvailability(),
      // The SDK exposes remote-playback methods, but this adapter wires no
      // command surface for them yet, so they are unavailable through Reely
      // rather than forever "unknown".
      airPlay: { status: 'unavailable', reason: 'provider' },
      customControls: chromeless.customControlsAvailability()
    };
  }

  const attachment = createVimeoAttachment(mount, source, {
    emit,
    options,
    getCapabilities: playerCapabilities,
    chromeless,
    playback,
    presentation,
    qualityLevels,
    textTracks,
    clearStateListeners: () => listeners.clear()
  });

  return {
    provider: 'vimeo',
    attach: attachment.attach,
    load: attachment.load,
    destroy: attachment.destroy,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeDimensions: attachment.subscribeDimensions,
    play: playback.play,
    pause: playback.pause,
    seekTo: playback.seekTo,
    seekBy: playback.seekBy,
    mute: playback.mute,
    unmute: playback.unmute,
    setVolume: playback.setVolume,
    setPlaybackRate: playback.setPlaybackRate,
    selectQuality: qualityLevels.selectQuality,
    selectTextTrack: textTracks.selectTextTrack,
    subscribeCues: textTracks.subscribeCues,
    setCaptionRenderer: textTracks.setCaptionRenderer,
    requestFullscreen: presentation.requestFullscreen,
    exitFullscreen: presentation.exitFullscreen,
    requestPictureInPicture: presentation.requestPictureInPicture,
    exitPictureInPicture: presentation.exitPictureInPicture,
    retry: attachment.retry
  };
};
