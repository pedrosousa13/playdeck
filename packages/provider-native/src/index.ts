import type {
  PlayerCapabilities,
  ProviderAdapter,
  ProviderEvent,
  ProviderStatePatch
} from '@playdeck/core';
import { createNativeAttachment } from './attachment.js';
import {
  available,
  sourceHasNoPoster,
  type EmitProviderState
} from './adapter-values.js';
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

// What this module actually stores a subscriber under: `ProviderStateListener`
// widened to admit the real return value `playback.ts`'s `startTime` seam
// needs back — the disposer a notice-carrying patch's listener hands back to
// withdraw it later (`EmitProviderState`, #475). Local to this module and
// never exported: `ProviderAdapter.subscribe` still takes and returns exactly
// `ProviderStateListener` at the public boundary, so nothing outside this file
// has to know the stored type is wider. A `ProviderStateListener` — declared
// `void` — is assignable here without a cast, because TypeScript's "a
// void-returning function's actual return value is ignored" leniency runs the
// other way too: a function typed to return `void` may be passed wherever a
// wider return is expected, since `void` itself is a member of the wider
// union. That is what lets `emit` below read a real `PlayerController`
// subscription's disposer back out with no cast of its own, unlike widening
// `ProviderStateListener` itself, which is declared `void` for the reason its
// own comment in `@playdeck/core` gives.
type NativeStateListener = (
  patch: ProviderStatePatch,
  event?: ProviderEvent
) => void | (() => void);

export const createNativeProvider = (
  media: HTMLVideoElement,
  options: NativePlaybackOptions = {}
): NativeProviderAdapter => {
  const listeners = new Set<NativeStateListener>();

  // Not `notifySafely`: that helper's signature forces a listener's return to
  // `void`, which is exactly the value `playback.ts`'s `startTime` seam needs
  // back. Which listener's disposer this returns when more than one is
  // subscribed is unspecified — the last one to run wins, here as it does for
  // `notifySafely`'s own fan-out — because `subscribe` is public API and
  // nothing about this module limits it to one subscriber. The `try`/`catch`
  // below is `notifySafely`'s own safety, kept so one listener throwing
  // cannot stop a later one from being notified or drop its own disposer.
  const emit: EmitProviderState = (patch, event) => {
    let disposer: (() => void) | undefined;
    listeners.forEach((listener) => {
      try {
        const result = listener(patch, event);
        if (typeof result === 'function') disposer = result;
      } catch (cause) {
        queueMicrotask(() => {
          throw cause;
        });
      }
    });
    return disposer;
  };

  const playback = createNativePlayback(media, options, {
    emit,
    isDestroyed: () => attachment.isDestroyed()
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
      chapters: textTracks.chaptersAvailability(),
      fullscreen: presentation.fullscreenAvailability(),
      pictureInPicture: presentation.pictureInPictureAvailability(),
      airPlay: presentation.airPlayAvailability(),
      customControls: available,
      providerPoster: sourceHasNoPoster
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
