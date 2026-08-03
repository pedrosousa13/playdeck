import type {
  Availability,
  PlayerCapabilities,
  ProviderAdapter,
  ProviderEvent,
  ProviderStateListener,
  WistiaSource
} from '@reely/core';
import { available, type WistiaMountElement } from './adapter-values.js';
import { createWistiaAttachment } from './attachment.js';
import { createWistiaPlayback } from './playback.js';
import { createWistiaPresentation } from './presentation.js';

export type { WistiaMountElement } from './adapter-values.js';
export { API_READY_TIMEOUT_MS } from './attachment.js';
export { loadWistiaPlayer, resetWistiaPlayerLoader } from './loader.js';
// Every type the loader declares, with no gap: `dist/index.d.ts` is the only
// surface `package.json`'s `exports` map offers, so a type left out of this
// block is a type no consumer can import however the README describes it.
// `test/exports.contract.test.ts` is what keeps the two in step.
export type {
  AFTER_REPLACE_EVENT_TYPE,
  API_READY_EVENT_TYPE,
  BEFORE_REPLACE_EVENT_TYPE,
  IMPL_CREATED_EVENT_TYPE,
  LOADED_MEDIA_DATA_EVENT_TYPE,
  MediaData,
  MUTE_CHANGE_EVENT_TYPE,
  PLAYER_COLOR_CHANGE_EVENT_TYPE,
  PublicApi,
  WistiaApiReadyDetail,
  WistiaMuteChangeDetail,
  WistiaPlayerApi,
  WistiaPlayerAttribute,
  WistiaPlayerElement,
  WistiaPlayerEvents,
  WistiaPlayerState
} from './loader.js';

export type WistiaProviderOptions = {
  readonly controls?: boolean;
  readonly dnt?: boolean;
  readonly loop?: boolean;
};

type WistiaCommand =
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
  | 'retry';

export type WistiaProviderAdapter = ProviderAdapter &
  Required<Pick<ProviderAdapter, WistiaCommand>> & {
    readonly provider: 'wistia';
  };

// What this adapter does not drive at all. Aurora has a `videoQuality()` coarse
// setter and a captions API, but neither is wired here, so both report
// unavailable through Reely rather than staying forever "unknown".
const outOfScope: Availability = { status: 'unavailable', reason: 'provider' };

export const createWistiaProvider = (
  mount: WistiaMountElement,
  source: WistiaSource,
  options: WistiaProviderOptions = {}
): WistiaProviderAdapter => {
  const listeners = new Set<ProviderStateListener>();

  const emit = (
    patch: Parameters<ProviderStateListener>[0],
    event?: ProviderEvent
  ): void => listeners.forEach((listener) => listener(patch, event));

  const playback = createWistiaPlayback(mount, {
    emit,
    isStale: (player) => attachment.isStale(player),
    getPlayer: () => attachment.getPlayer(),
    getCapabilities: playerCapabilities
  });

  const presentation = createWistiaPresentation({
    emit,
    getPlayer: () => attachment.getPlayer()
  });

  // The capabilities this player has, folding in the one seam that decides
  // any of them. Recomputed on every publication: the two the playback seam
  // owns change with the device the player is on, not with the adapter.
  function playerCapabilities(): PlayerCapabilities {
    return {
      // `PublicApi.time(seconds)` seeks.
      seek: available,
      setVolume: playback.setVolumeAvailability(),
      setPlaybackRate: playback.setPlaybackRateAvailability(),
      selectQuality: outOfScope,
      selectTextTrack: outOfScope,
      // `PublicApi.requestFullscreen()` / `cancelFullscreen()`.
      fullscreen: available,
      // Not in Aurora's public API: `PublicApi` declares no picture-in-picture
      // member at all.
      pictureInPicture: outOfScope,
      airPlay: outOfScope,
      // Chromeless is a plain set of embed attributes, declared in Wistia's own
      // `Attributes` and gated by no account tier.
      customControls: available
    };
  }

  const attachment = createWistiaAttachment(mount, source, {
    emit,
    options,
    getCapabilities: playerCapabilities,
    playback,
    presentation,
    clearStateListeners: () => listeners.clear()
  });

  return {
    provider: 'wistia',
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
    requestFullscreen: presentation.requestFullscreen,
    exitFullscreen: presentation.exitFullscreen,
    retry: attachment.retry
  };
};
