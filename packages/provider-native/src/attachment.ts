import type {
  MediaDimensions,
  PlayerCapabilities,
  PlayerLiveState,
  ProviderStatePatch,
  TimeRange
} from '@playdeck/core';
import { deriveLiveState, liveStateEqual, notifySafely } from '@playdeck/core';
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
    dimensionListeners.forEach((listener) =>
      notifySafely(listener, dimensions)
    );
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

  // The published duration: the raw one with the endless and unknown cases
  // normalized to `null`, which is what `PlayerState.duration` carries.
  const publishedDuration = (): number | null =>
    Number.isFinite(media.duration) ? media.duration : null;

  // The value last put on the wire, so `durationchange` can tell news from
  // noise. `undefined` only until the attach snapshot writes it. `attach()`
  // adds the listeners before it takes that snapshot, so the unset window is
  // real; what keeps a handler out of it is that nothing between those two
  // statements dispatches a media event.
  let lastDuration: number | null | undefined;

  // The buffered ranges last put on the wire — what `CONTEXT.md` calls the
  // **Buffered window**. An element reporting no ranges is saying one of two
  // things it gives no way to tell apart, "nothing is buffered" and "not
  // telling you", so this adapter answers for it: within one attachment an
  // empty reading is treated as unknown and its key is withheld from the patch,
  // which `#applyPatch` resolves by retaining the ranges it already holds.
  // Withheld rather than ignored outright, and scoped to one source with an
  // explicit reset point below, because eviction is real — an empty reading
  // genuinely can mean none.
  //
  // What made the ambiguity concrete: on some loads of the ~1s WebM tracer clip
  // WebKit opened a buffered window while it parsed and closed it again when
  // parsing finished, with the data still there and still playable, so a
  // `progress` reading empty took an already-rendered indicator back off the
  // DOM and walked `PlayerState.buffered` back below what the player had been
  // told. Measured in situ 2026-08-21, on 2 of 13 sequential loads of the
  // reference composition on the maintainer's machine; on 6 of the others the
  // window never opened at any observable instant, which is #401's subject and
  // is not what this rule addresses (#401, #405).
  //
  // Starts at `[]`, the value `createInitialPlayerState()` holds, so the record
  // mirrors the controller from before the first patch.
  let lastBuffered: ReadonlyArray<TimeRange> = [];

  // The `buffered` key for an outgoing patch, or no key at all. Every publisher
  // of `buffered` goes through this; nothing else may read `media.buffered`
  // onto the wire.
  const syncBuffered = (): { buffered?: ReadonlyArray<TimeRange> } => {
    const buffered = toRanges(media.buffered);
    if (buffered.length === 0 && lastBuffered.length > 0) return {};
    lastBuffered = buffered;
    return { buffered };
  };

  const emitMediaState = (originalEvent?: Event): void => {
    lastDuration = publishedDuration();
    emit(
      syncLive({
        lifecycle: media.readyState >= HAVE_METADATA ? 'ready' : 'loading',
        activation:
          media.readyState >= HAVE_METADATA ? 'ready' : 'loading-provider',
        currentTime: media.currentTime,
        duration: lastDuration,
        ...syncBuffered(),
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
  };

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
  // Duration used to be published from `emitMediaState` alone, which runs on
  // the attach snapshot, `canplay` and `loadedmetadata` and nowhere else. An
  // element that keeps revising its duration — WebKit publishes a growing one
  // while it is still parsing — therefore latched whatever the last of those
  // read and never recovered, so `SeekSlider`'s `max`, taken from
  // `seekWindow(duration, seekable)`, stayed a fraction of the clip for the
  // whole session; and under the default `step={1}` a sub-second `max` leaves
  // `0` as the only value on the grid, which makes the control inoperable
  // rather than merely mis-scaled (#400).
  //
  // A narrow patch rather than a second `emitMediaState` call — the shape
  // `progress`, `volumechange` and `ratechange` already use: a patch carrying
  // what the event reports and nothing else, which is one key here and two in
  // `progress`. Republishing the snapshot was the obvious reading of the
  // issue's suggestion and is rejected on two counts: it rebuilds
  // `capabilities` and restates `lifecycle`/`activation`, fields this event has
  // no news about and other seams own the timing of — and `durationchange` also
  // fires from the media load algorithm, with `readyState` back at 0, so a
  // retry would walk a ready player back to `loading` on its way through.
  //
  // Silent when the published value held, the rule `emitLiveUpdate` already
  // follows: a live stream fires `durationchange` for a duration that
  // normalizes to `null` every time, and a snapshot per event for a value that
  // never moves is exactly the empty patch the review of #361 refused. What
  // liveness such an event does change is still published, because the raw
  // duration is what `computeLiveState` reads.
  //
  // `seekable` is deliberately left out of that key. For a finite duration
  // above zero `seekWindow` reads the duration and ignores the window entirely
  // — it guards on `duration > 0`, so a finite `0` falls through to the
  // seekable branch — and for the live DVR case that does read it, `progress`
  // is the event that reports the window moving and already publishes it on
  // every one. A duration changing says nothing about the window that a
  // `progress` has not said.
  const onDurationChange = (): void => {
    const duration = publishedDuration();
    if (duration === lastDuration) {
      emitLiveUpdate();
      return;
    }
    lastDuration = duration;
    emit(syncLive({ duration }));
  };
  // `seekable` on every one of these, withheld or not: only `buffered` carries
  // the ambiguity, and `progress` is the event that reports the window moving.
  const onProgress = (): void =>
    emit(
      syncLive({
        ...syncBuffered(),
        seekable: toRanges(media.seekable)
      })
    );
  // The one point inside an attachment where an empty buffer is news rather
  // than silence. `emptied` fires from the media load algorithm, which empties
  // the element's buffer as it runs, so here the ranges are gone rather than
  // merely unreported and the retained value goes with them.
  //
  // A seek is deliberately not such a point. Engines carry their ranges across
  // one — the old ranges stay, a disjoint range is added at the target, and a
  // seek back into a retained range plays from it without refetching — so
  // clearing on a seek would discard ranges that are still true. #405 records
  // the measurement behind that.
  //
  // Silent when the record was already empty, the rule `onDurationChange` and
  // `emitLiveUpdate` follow: `load()` calls `media.load()`, so every ordinary
  // load fires this, and a patch restating a value that never moved is the
  // empty patch the review of #361 refused. Through `syncLive` like every other
  // emitter here, because the load algorithm empties the seekable window too
  // and liveness is derived from it.
  const onEmptied = (): void => {
    if (lastBuffered.length === 0) return;
    lastBuffered = [];
    emit(syncLive({ buffered: [] }));
  };
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
    media.addEventListener('durationchange', onDurationChange);
    media.addEventListener('resize', onResize);
    media.addEventListener('seeking', onSeeking);
    media.addEventListener('seeked', onSeeked);
    media.addEventListener('timeupdate', onTimeUpdate);
    media.addEventListener('progress', onProgress);
    media.addEventListener('emptied', onEmptied);
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
    media.removeEventListener('durationchange', onDurationChange);
    media.removeEventListener('resize', onResize);
    media.removeEventListener('seeking', onSeeking);
    media.removeEventListener('seeked', onSeeked);
    media.removeEventListener('timeupdate', onTimeUpdate);
    media.removeEventListener('progress', onProgress);
    media.removeEventListener('emptied', onEmptied);
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
      dimensionListeners.forEach((listener) =>
        notifySafely(listener, undefined)
      );
      dimensionListeners.clear();
    },
    isDestroyed: () => destroyed,
    subscribeDimensions: (listener) => {
      dimensionListeners.add(listener);
      return () => dimensionListeners.delete(listener);
    }
  };
};
