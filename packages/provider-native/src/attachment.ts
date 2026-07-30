import type { MediaDimensions, PlayerCapabilities } from '@reely/core';
import {
  HAVE_METADATA,
  providerEvent,
  toRanges,
  type EmitProviderState
} from './adapter-values.js';
import type { NativePlayback } from './playback.js';
import type { NativePresentation } from './presentation.js';
import type { NativeTextTracks } from './text-tracks.js';

export type NativeAttachmentDeps = {
  readonly emit: EmitProviderState;
  // Recomputes the host's full `PlayerCapabilities` snapshot for the media
  // state published on attach/ready.
  readonly getCapabilities: () => PlayerCapabilities;
  readonly playback: Pick<
    NativePlayback,
    'applyInitialPosition' | 'cancelPendingReplay' | 'handlers'
  >;
  readonly presentation: Pick<NativePresentation, 'handlers'>;
  readonly textTracks: Pick<
    NativeTextTracks,
    'attachListeners' | 'discover' | 'destroy'
  >;
  // Drops the host's provider-state subscribers on destroy.
  readonly clearStateListeners: () => void;
};

// The load/attach/teardown seam: owns the attached/loaded/destroyed flags,
// wires every seam's event handlers to the media element (and its document)
// on attach, unwires them on destroy, and publishes the media-state and
// dimension snapshots that are not driven by any one seam's state.
export type NativeAttachment = {
  readonly attach: () => void;
  readonly load: () => void;
  readonly destroy: () => void;
  readonly isDestroyed: () => boolean;
  readonly subscribeDimensions: (
    listener: (dimensions: MediaDimensions | undefined) => void
  ) => () => void;
};

export const createNativeAttachment = (
  media: HTMLVideoElement,
  {
    emit,
    getCapabilities,
    playback,
    presentation,
    textTracks,
    clearStateListeners
  }: NativeAttachmentDeps
): NativeAttachment => {
  const ownerDocument = media.ownerDocument;
  const dimensionListeners = new Set<
    (dimensions: MediaDimensions | undefined) => void
  >();
  let attached = false;
  let destroyed = false;
  let loaded = false;

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
        capabilities: getCapabilities()
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

  const {
    onFullscreenChange,
    onPictureInPictureChange,
    onWebKitFullscreenChange,
    onWebKitPresentationModeChange,
    onAirPlayTargetAvailabilityChange
  } = presentation.handlers;

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
      clearStateListeners();
      // Announced before the set is dropped: whatever this element measured
      // stops being true the moment the provider lets go of it.
      dimensionListeners.forEach((listener) => listener(undefined));
      dimensionListeners.clear();
    },
    isDestroyed: () => destroyed,
    subscribeDimensions: (listener) => {
      dimensionListeners.add(listener);
      return () => dimensionListeners.delete(listener);
    }
  };
};
