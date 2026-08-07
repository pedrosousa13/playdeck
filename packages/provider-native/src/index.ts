import type {
  PlayerCapabilities,
  ProviderAdapter,
  ProviderEvent,
  ProviderStateListener
} from '@reely/core';
import { createNativeAttachment } from './attachment.js';
import { available } from './adapter-values.js';
import {
  createNativePlayback,
  type NativePlaybackOptions
} from './playback.js';
import { createNativePresentation } from './presentation.js';
import {
  createNativeTextTracks,
  type NativeTextTracks
} from './text-tracks.js';

export type { NativePlaybackOptions } from './playback.js';

type NativeCommand =
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
  | 'requestPictureInPicture'
  | 'exitPictureInPicture'
  | 'showAirPlayPicker'
  | 'retry';

export type NativeProviderAdapter = ProviderAdapter &
  Required<Pick<ProviderAdapter, NativeCommand>> & {
    readonly provider: 'native';
  };

export const createNativeProvider = (
  media: HTMLVideoElement,
  options: NativePlaybackOptions = {}
): NativeProviderAdapter => {
  const listeners = new Set<ProviderStateListener>();

  const emit = (
    patch: Parameters<ProviderStateListener>[0],
    event?: ProviderEvent
  ): void => listeners.forEach((listener) => listener(patch, event));

  const playback = createNativePlayback(media, options, {
    emit,
    isDestroyed: () => attachment.isDestroyed(),
    resetLiveState: () => attachment.resetLiveState()
  });

  const presentation = createNativePresentation(media, {
    emit,
    getCapabilities: () => mediaCapabilities()
  });

  const textTracks: NativeTextTracks = createNativeTextTracks(media, emit, () =>
    mediaCapabilities()
  );

  function mediaCapabilities(): PlayerCapabilities {
    return {
      seek: available,
      setVolume: available,
      setPlaybackRate: available,
      // A plain media element exposes no rendition ladder. This used to be
      // `unknown`/`provider-check`, but nothing ever resolved it — this
      // function returns the same literal on every recomputation — so a
      // consumer gating a quality menu on it waited on a verdict that never
      // arrived.
      selectQuality: { status: 'unavailable', reason: 'source' },
      selectTextTrack: textTracks.selectTextTrackAvailability(),
      fullscreen: presentation.fullscreenAvailability(),
      pictureInPicture: presentation.pictureInPictureAvailability(),
      airPlay: presentation.airPlayAvailability(),
      customControls: available
    };
  }

  const attachment = createNativeAttachment(media, {
    emit,
    getCapabilities: mediaCapabilities,
    playback,
    presentation,
    textTracks,
    clearStateListeners: () => listeners.clear()
  });

  return {
    provider: 'native',
    attach: attachment.attach,
    load: attachment.load,
    destroy: attachment.destroy,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeCues: textTracks.subscribeCues,
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
    requestPictureInPicture: presentation.requestPictureInPicture,
    exitPictureInPicture: presentation.exitPictureInPicture,
    showAirPlayPicker: presentation.showAirPlayPicker,
    retry: playback.retry,
    selectTextTrack: textTracks.selectTextTrack,
    setCaptionRenderer: textTracks.setCaptionRenderer
  };
};
