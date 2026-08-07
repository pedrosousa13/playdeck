import type {
  MediaDimensions,
  PlayerCapabilities,
  PlayerLiveState,
  ProviderStatePatch
} from '@reely/core';
import { deriveLiveState, liveStateEqual } from '@reely/core';
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
  // Drops the last published liveness so the next derivation is published
  // again. Called wherever the element reloads its source.
  readonly resetLiveState: () => void;
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
  let liveState: PlayerLiveState = null;

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

  // Liveness from the element's own signals only: the *raw* duration, which is
  // endless on a live stream (the published duration normalizes that away, so
  // it cannot be the input), plus the moving seekable window and the playhead.
  // No `isLiveHint` and no `liveEdge` — a media element offers neither — and no
  // `atEdgeThreshold`, so the tolerance shared with every other adapter applies.
  const computeLiveState = (): PlayerLiveState =>
    deriveLiveState({
      duration: media.duration,
      seekable: toRanges(media.seekable),
      currentTime: media.currentTime
    });

  // Merges `live` into an outgoing patch, and only when the derived value
  // differs from the last one published: an unchanged liveness adds no key.
  const syncLive = (patch: ProviderStatePatch): ProviderStatePatch => {
    const nextLive = computeLiveState();
    if (liveStateEqual(nextLive, liveState)) return patch;
    liveState = nextLive;
    return { ...patch, live: nextLive };
  };

  // Liveness on its own, for the paths whose other state is published
  // elsewhere. Silent when the value held: no empty patch escapes.
  const emitLiveUpdate = (): void => {
    const before = liveState;
    const patch = syncLive({});
    if (liveStateEqual(before, liveState)) return;
    emit(patch);
  };

  const emitMediaState = (originalEvent?: Event): void =>
    emit(
      syncLive({
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
      }),
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
    onTimeUpdate: onPlaybackTimeUpdate,
    onError
  } = playback.handlers;

  // The at-edge flag is a distance between the playhead and the window end, so
  // it goes stale on every tick. Published after the playback seam's own patch,
  // and only when it actually moved.
  const onTimeUpdate = (originalEvent: Event): void => {
    onPlaybackTimeUpdate(originalEvent);
    emitLiveUpdate();
  };

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
    emit(
      syncLive({
        buffered: toRanges(media.buffered),
        seekable: toRanges(media.seekable)
      })
    );
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
    resetLiveState: () => {
      liveState = null;
    },
    subscribeDimensions: (listener) => {
      dimensionListeners.add(listener);
      return () => dimensionListeners.delete(listener);
    }
  };
};
