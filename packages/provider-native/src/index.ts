import type {
  Availability,
  MediaDimensions,
  PlayerCapabilities,
  ProviderAdapter,
  ProviderEvent,
  ProviderStateListener
} from '@reely/core';
import {
  available,
  HAVE_METADATA,
  notReady,
  policyBlocked,
  policyDisallowed,
  providerEvent,
  runCommand,
  toRanges,
  unsupported
} from './media-helpers.js';
import {
  createNativePlayback,
  type NativePlaybackOptions
} from './playback.js';
import {
  createNativeTextTracks,
  type NativeTextTracks
} from './text-tracks.js';

export type { NativePlaybackOptions } from './playback.js';

type WebKitPresentationMode = 'inline' | 'picture-in-picture' | 'fullscreen';

type WebKitHTMLVideoElement = HTMLVideoElement & {
  readonly webkitSupportsFullscreen?: boolean;
  readonly webkitDisplayingFullscreen?: boolean;
  readonly webkitEnterFullscreen?: () => void;
  readonly webkitExitFullscreen?: () => void;
  readonly webkitSupportsPresentationMode?: (
    mode: WebKitPresentationMode
  ) => boolean;
  readonly webkitSetPresentationMode?: (mode: WebKitPresentationMode) => void;
  readonly webkitPresentationMode?: WebKitPresentationMode;
  readonly webkitShowPlaybackTargetPicker?: () => void;
  // Present-but-unused: AirPlay is fire-and-forget today. Surfacing an active
  // wireless-route flag needs a new observable state field (a route-change
  // subscription + PlayerState surface), which is a feature, not hardening —
  // deferred rather than added here. The `webkitcurrentplaybacktargetiswireless
  // changed` event would drive it.
  readonly webkitCurrentPlaybackTargetIsWireless?: boolean;
  readonly disableRemotePlayback?: boolean;
};

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
  const dimensionListeners = new Set<
    (dimensions: MediaDimensions | undefined) => void
  >();
  const ownerDocument = media.ownerDocument;
  const webkitMedia: WebKitHTMLVideoElement = media;
  let attached = false;
  let destroyed = false;
  let loaded = false;

  const emit = (
    patch: Parameters<ProviderStateListener>[0],
    event?: ProviderEvent
  ): void => listeners.forEach((listener) => listener(patch, event));

  const playback = createNativePlayback(media, options, {
    emit,
    isDestroyed: () => destroyed
  });

  // Before metadata arrives, and on an audio-only or errored source, both
  // dimensions read 0 — and some DOM test environments omit them entirely.
  // Either way the size is not known, so unusable pairs publish `undefined`.
  const publishDimensions = (): void => {
    const width = media.videoWidth;
    const height = media.videoHeight;
    const dimensions =
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
        ? { width, height }
        : undefined;
    dimensionListeners.forEach((listener) => listener(dimensions));
  };

  const fullscreenAvailability = (): Availability => {
    if (typeof media.requestFullscreen === 'function') {
      return ownerDocument.fullscreenEnabled === false
        ? policyDisallowed
        : available;
    }
    if (typeof webkitMedia.webkitEnterFullscreen === 'function') {
      if (webkitMedia.webkitSupportsFullscreen === true) return available;
      return media.readyState >= HAVE_METADATA ? unsupported : notReady;
    }
    return unsupported;
  };

  const supportsWebKitPictureInPicture = (): boolean =>
    typeof webkitMedia.webkitSetPresentationMode === 'function' &&
    typeof webkitMedia.webkitSupportsPresentationMode === 'function' &&
    webkitMedia.webkitSupportsPresentationMode('picture-in-picture') === true;

  const pictureInPictureAvailability = (): Availability => {
    if (media.disablePictureInPicture === true) return policyDisallowed;
    if (typeof media.requestPictureInPicture === 'function') {
      return ownerDocument.pictureInPictureEnabled === false
        ? policyDisallowed
        : available;
    }
    return supportsWebKitPictureInPicture() ? available : unsupported;
  };

  // WebKit is the only engine exposing a native AirPlay route picker. Blink and
  // Gecko have no equivalent, so AirPlay reports unavailable there.
  const airPlayDisallowed = (): boolean =>
    media.getAttribute('x-webkit-airplay') === 'deny' ||
    webkitMedia.disableRemotePlayback === true;

  // Whether WebKit has told us a playback target exists. Starts false: Apple's
  // guidance is to show an AirPlay control only once the availability event
  // reports a route, and every native Apple player behaves that way, so an
  // always-present button reads as broken rather than as a feature (#71).
  //
  // `unavailable`, not `unknown`, for the pre-event window. `unknown` promises
  // a verdict is coming, and on a machine that never sees a receiver the event
  // never fires — which is exactly the trap `selectQuality` used to be in
  // (see its comment below): a consumer gating UI on it waits forever. This
  // says what is true right now and flips the moment that stops being true.
  let airPlayRouteAvailable = false;
  const airPlayNoRoute: Availability = {
    status: 'unavailable',
    reason: 'provider'
  };

  const airPlayAvailability = (): Availability => {
    if (typeof webkitMedia.webkitShowPlaybackTargetPicker !== 'function') {
      return unsupported;
    }
    if (airPlayDisallowed()) return policyDisallowed;
    return airPlayRouteAvailable ? available : airPlayNoRoute;
  };

  const onAirPlayTargetAvailabilityChange = (event: Event): void => {
    const next =
      (event as { readonly availability?: string }).availability ===
      'available';
    // WebKit re-announces on route changes that leave availability unchanged;
    // recomputing capabilities on each would push an identical patch to every
    // subscriber and wake every capability-gated control for nothing.
    if (next === airPlayRouteAvailable) return;
    airPlayRouteAvailable = next;
    emit({ capabilities: mediaCapabilities() });
  };

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
      fullscreen: fullscreenAvailability(),
      pictureInPicture: pictureInPictureAvailability(),
      airPlay: airPlayAvailability(),
      customControls: available
    };
  }

  const emitMediaState = (originalEvent?: Event): void =>
    emit(
      {
        lifecycle: media.readyState >= HAVE_METADATA ? 'ready' : 'loading',
        activation:
          media.readyState >= HAVE_METADATA ? 'ready' : 'loading-provider',
        currentTime: media.currentTime,
        duration: Number.isFinite(media.duration) ? media.duration : null,
        buffered: toRanges(media.buffered),
        seekable: toRanges(media.seekable),
        muted: media.muted,
        volume: media.volume,
        playbackRate: media.playbackRate,
        capabilities: mediaCapabilities()
      },
      originalEvent
        ? providerEvent('ready', originalEvent, undefined)
        : undefined
    );

  const {
    onPlay,
    onPlaying,
    onPause,
    onEnded,
    onWaiting,
    onSeeking,
    onSeeked,
    onTimeUpdate,
    onError
  } = playback.handlers;

  const onCanPlay = (originalEvent: Event): void => {
    emit({ buffering: false });
    emitMediaState(originalEvent);
  };
  const onLoadedMetadata = (originalEvent: Event): void => {
    playback.applyInitialPosition();
    publishDimensions();
    onCanPlay(originalEvent);
  };
  // The intrinsic size can change after metadata — an adaptive rendition
  // switch, or a new source loaded into the same element. `resize` is the only
  // event that reports it; `loadedmetadata` has already fired by then.
  const onResize = (): void => publishDimensions();
  const onProgress = (): void =>
    emit({
      buffered: toRanges(media.buffered),
      seekable: toRanges(media.seekable)
    });
  const onVolumeChange = (originalEvent: Event): void =>
    emit(
      { muted: media.muted, volume: media.volume },
      providerEvent('volumechange', originalEvent, {
        muted: media.muted,
        volume: media.volume
      })
    );
  const onRateChange = (originalEvent: Event): void =>
    emit(
      { playbackRate: media.playbackRate },
      providerEvent('ratechange', originalEvent, {
        playbackRate: media.playbackRate
      })
    );
  const onFullscreenChange = (originalEvent: Event): void =>
    emit(
      { fullscreen: ownerDocument.fullscreenElement === media },
      providerEvent('fullscreenchange', originalEvent, {
        fullscreen: ownerDocument.fullscreenElement === media
      })
    );
  const onPictureInPictureChange = (originalEvent: Event): void =>
    emit(
      { pictureInPicture: ownerDocument.pictureInPictureElement === media },
      providerEvent('pictureinpicturechange', originalEvent, {
        pictureInPicture: ownerDocument.pictureInPictureElement === media
      })
    );
  const onWebKitFullscreenChange = (originalEvent: Event): void => {
    const fullscreen = originalEvent.type === 'webkitbeginfullscreen';
    emit(
      { fullscreen },
      providerEvent('fullscreenchange', originalEvent, { fullscreen })
    );
  };
  // Only picture-in-picture state is derived here; fullscreen presentation
  // mode transitions rely on webkitbeginfullscreen/webkitendfullscreen,
  // which Safari fires alongside this event.
  const onWebKitPresentationModeChange = (originalEvent: Event): void => {
    const pictureInPicture =
      webkitMedia.webkitPresentationMode === 'picture-in-picture';
    emit(
      { pictureInPicture },
      providerEvent('pictureinpicturechange', originalEvent, {
        pictureInPicture
      })
    );
  };

  const addListeners = (): void => {
    media.addEventListener('play', onPlay);
    media.addEventListener('playing', onPlaying);
    media.addEventListener('pause', onPause);
    media.addEventListener('ended', onEnded);
    media.addEventListener('waiting', onWaiting);
    media.addEventListener('canplay', onCanPlay);
    media.addEventListener('loadedmetadata', onLoadedMetadata);
    media.addEventListener('resize', onResize);
    media.addEventListener('seeking', onSeeking);
    media.addEventListener('seeked', onSeeked);
    media.addEventListener('timeupdate', onTimeUpdate);
    media.addEventListener('progress', onProgress);
    media.addEventListener('volumechange', onVolumeChange);
    media.addEventListener('ratechange', onRateChange);
    media.addEventListener('error', onError);
    ownerDocument.addEventListener('fullscreenchange', onFullscreenChange);
    media.addEventListener('enterpictureinpicture', onPictureInPictureChange);
    media.addEventListener('leavepictureinpicture', onPictureInPictureChange);
    media.addEventListener('webkitbeginfullscreen', onWebKitFullscreenChange);
    media.addEventListener('webkitendfullscreen', onWebKitFullscreenChange);
    media.addEventListener(
      'webkitpresentationmodechanged',
      onWebKitPresentationModeChange
    );
    media.addEventListener(
      'webkitplaybacktargetavailabilitychanged',
      onAirPlayTargetAvailabilityChange
    );
  };

  const removeListeners = (): void => {
    media.removeEventListener('play', onPlay);
    media.removeEventListener('playing', onPlaying);
    media.removeEventListener('pause', onPause);
    media.removeEventListener('ended', onEnded);
    media.removeEventListener('waiting', onWaiting);
    media.removeEventListener('canplay', onCanPlay);
    media.removeEventListener('loadedmetadata', onLoadedMetadata);
    media.removeEventListener('resize', onResize);
    media.removeEventListener('seeking', onSeeking);
    media.removeEventListener('seeked', onSeeked);
    media.removeEventListener('timeupdate', onTimeUpdate);
    media.removeEventListener('progress', onProgress);
    media.removeEventListener('volumechange', onVolumeChange);
    media.removeEventListener('ratechange', onRateChange);
    media.removeEventListener('error', onError);
    ownerDocument.removeEventListener('fullscreenchange', onFullscreenChange);
    media.removeEventListener(
      'enterpictureinpicture',
      onPictureInPictureChange
    );
    media.removeEventListener(
      'leavepictureinpicture',
      onPictureInPictureChange
    );
    media.removeEventListener(
      'webkitbeginfullscreen',
      onWebKitFullscreenChange
    );
    media.removeEventListener('webkitendfullscreen', onWebKitFullscreenChange);
    media.removeEventListener(
      'webkitpresentationmodechanged',
      onWebKitPresentationModeChange
    );
    media.removeEventListener(
      'webkitplaybacktargetavailabilitychanged',
      onAirPlayTargetAvailabilityChange
    );
  };

  return {
    provider: 'native',
    attach: () => {
      if (attached || destroyed) return;
      attached = true;
      addListeners();
      textTracks.attachListeners();
      textTracks.discover();
      emitMediaState();
    },
    load: () => {
      if (destroyed || loaded) return;
      loaded = true;
      // Caption state is deliberately left alone: `load()` runs once, right
      // after `attach()` discovered this source's tracks. A source switch
      // creates a new provider, and the controller clears caption state on
      // the swap.
      media.load();
      // Declared here rather than at attach: the commands operate on the
      // element from birth, but the load algorithm resets `playbackRate` to
      // `defaultPlaybackRate`, so anything applied earlier is undone (#69).
      emit({ commandsReady: true });
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      playback.cancelPendingReplay();
      if (attached) removeListeners();
      textTracks.destroy();
      if (!media.paused) {
        try {
          media.pause();
        } catch {
          // Teardown must not escape the provider boundary.
        }
      }
      listeners.clear();
      // Announced before the set is dropped: whatever this element measured
      // stops being true the moment the provider lets go of it.
      dimensionListeners.forEach((listener) => listener(undefined));
      dimensionListeners.clear();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeCues: textTracks.subscribeCues,
    subscribeDimensions: (listener) => {
      dimensionListeners.add(listener);
      return () => dimensionListeners.delete(listener);
    },
    play: playback.play,
    pause: playback.pause,
    seekTo: playback.seekTo,
    seekBy: playback.seekBy,
    mute: playback.mute,
    unmute: playback.unmute,
    setVolume: playback.setVolume,
    setPlaybackRate: playback.setPlaybackRate,
    requestFullscreen: async () => {
      if (typeof media.requestFullscreen === 'function') {
        if (ownerDocument.fullscreenEnabled === false) {
          return policyBlocked(
            'Fullscreen is disallowed by the document permissions policy.'
          );
        }
        return runCommand(() => media.requestFullscreen());
      }
      const enterWebKitFullscreen = webkitMedia.webkitEnterFullscreen;
      if (typeof enterWebKitFullscreen !== 'function')
        return { ok: false, reason: 'unsupported' };
      if (webkitMedia.webkitSupportsFullscreen !== true) {
        return media.readyState >= HAVE_METADATA
          ? { ok: false, reason: 'unsupported' }
          : { ok: false, reason: 'not-ready' };
      }
      return runCommand(() => enterWebKitFullscreen.call(media));
    },
    exitFullscreen: async () => {
      // Standard fullscreen first: Blink still ships the legacy WebKit video
      // fullscreen properties, so webkitDisplayingFullscreen is also true
      // after a standard requestFullscreen there.
      if (ownerDocument.fullscreenElement === media) {
        if (!ownerDocument.exitFullscreen)
          return { ok: false, reason: 'unsupported' };
        return runCommand(() => ownerDocument.exitFullscreen());
      }
      if (webkitMedia.webkitDisplayingFullscreen === true) {
        const exitWebKitFullscreen = webkitMedia.webkitExitFullscreen;
        if (typeof exitWebKitFullscreen !== 'function')
          return { ok: false, reason: 'unsupported' };
        return runCommand(() => exitWebKitFullscreen.call(media));
      }
      return { ok: true };
    },
    requestPictureInPicture: async () => {
      if (media.disablePictureInPicture === true) {
        return policyBlocked(
          'Picture-in-picture is disabled on this media element.'
        );
      }
      if (typeof media.requestPictureInPicture === 'function') {
        if (ownerDocument.pictureInPictureEnabled === false) {
          return policyBlocked(
            'Picture-in-picture is disallowed by the document permissions policy.'
          );
        }
        return runCommand(() => media.requestPictureInPicture());
      }
      const setPresentationMode = webkitMedia.webkitSetPresentationMode;
      if (
        typeof setPresentationMode !== 'function' ||
        !supportsWebKitPictureInPicture()
      ) {
        return { ok: false, reason: 'unsupported' };
      }
      return runCommand(() =>
        setPresentationMode.call(media, 'picture-in-picture')
      );
    },
    exitPictureInPicture: async () => {
      const setPresentationMode = webkitMedia.webkitSetPresentationMode;
      if (
        webkitMedia.webkitPresentationMode === 'picture-in-picture' &&
        typeof setPresentationMode === 'function'
      ) {
        return runCommand(() => setPresentationMode.call(media, 'inline'));
      }
      if (ownerDocument.pictureInPictureElement !== media) return { ok: true };
      if (!ownerDocument.exitPictureInPicture)
        return { ok: false, reason: 'unsupported' };
      return runCommand(() => ownerDocument.exitPictureInPicture());
    },
    showAirPlayPicker: async () => {
      const showPicker = webkitMedia.webkitShowPlaybackTargetPicker;
      if (typeof showPicker !== 'function') {
        return { ok: false, reason: 'unsupported' };
      }
      if (airPlayDisallowed()) {
        return policyBlocked('AirPlay is disabled on this media element.');
      }
      return runCommand(() => showPicker.call(media));
    },
    retry: playback.retry,
    selectTextTrack: textTracks.selectTextTrack,
    setCaptionRenderer: textTracks.setCaptionRenderer
  };
};
