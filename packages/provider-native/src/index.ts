import type {
  Availability,
  CommandResult,
  PlayerCapabilities,
  PlayerError,
  PlayerEventDetailMap,
  PlayerEventType,
  ProviderAdapter,
  ProviderEvent,
  ProviderEventFor,
  ProviderStateListener,
  TimeRange
} from '@reely/core';
import { createNativeTextTracks, type NativeTextTracks } from './text-tracks';

export { createNativeTextTracks, type NativeTextTracks } from './text-tracks';

const available: Availability = { status: 'available' };
const unsupported: Availability = {
  status: 'unavailable',
  reason: 'browser'
};
const policyDisallowed: Availability = {
  status: 'unavailable',
  reason: 'policy'
};
const notReady: Availability = { status: 'unknown', reason: 'not-ready' };

// HTMLMediaElement.HAVE_METADATA, inlined because some DOM test environments
// omit the static readyState constants.
const HAVE_METADATA = 1;

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

export type NativePlaybackOptions = {
  readonly loop?: boolean;
  readonly startTime?: number;
  readonly endTime?: number;
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

const toRanges = (ranges: globalThis.TimeRanges): ReadonlyArray<TimeRange> =>
  Array.from({ length: ranges.length }, (_, index) => ({
    start: ranges.start(index),
    end: ranges.end(index)
  })).sort((left, right) => left.start - right.start);

const mediaError = (media: HTMLVideoElement): PlayerError => {
  const code = media.error?.code;
  const category =
    code === 2
      ? 'network'
      : code === 3
        ? 'decode'
        : code === 4
          ? 'source'
          : 'provider';
  return {
    category,
    fatal: true,
    recoverable: category === 'network',
    message:
      media.error?.message || 'The media element could not load the source.'
  };
};

const errorString = (cause: unknown, property: 'message' | 'name') => {
  if (
    (typeof cause !== 'object' || cause === null) &&
    typeof cause !== 'function'
  ) {
    return undefined;
  }
  try {
    const value = Reflect.get(cause, property);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
};

const policyBlocked = (
  message: string
): Exclude<CommandResult, { ok: true }> => ({
  ok: false,
  reason: 'blocked',
  error: {
    category: 'policy',
    fatal: false,
    recoverable: true,
    message
  }
});

const commandError = (cause: unknown): Exclude<CommandResult, { ok: true }> => {
  const blocked = errorString(cause, 'name') === 'NotAllowedError';
  return {
    ok: false,
    reason: blocked ? 'blocked' : 'provider-error',
    error: {
      category: blocked ? 'policy' : 'provider',
      fatal: false,
      recoverable: true,
      message: errorString(cause, 'message') || 'The native command failed.',
      cause
    }
  };
};

const runCommand = async (
  command: () => void | Promise<unknown>
): Promise<CommandResult> => {
  try {
    await command();
    return { ok: true };
  } catch (cause) {
    return commandError(cause);
  }
};

const withinMediaBounds = (
  media: HTMLVideoElement,
  time: number,
  startTime: number,
  endTime: number | undefined
): number | undefined => {
  const duration = Number.isFinite(media.duration) ? media.duration : undefined;
  const effectiveEnd =
    endTime === undefined
      ? duration
      : duration === undefined
        ? endTime
        : Math.min(endTime, duration);
  const effectiveStart =
    effectiveEnd === undefined ? startTime : Math.min(startTime, effectiveEnd);
  const bounded = Math.max(
    effectiveStart,
    effectiveEnd === undefined ? time : Math.min(time, effectiveEnd)
  );
  if (media.seekable.length === 0) return bounded;
  const intersections = Array.from(
    { length: media.seekable.length },
    (_, index) => ({
      start: Math.max(media.seekable.start(index), effectiveStart),
      end: Math.min(
        media.seekable.end(index),
        effectiveEnd ?? Number.POSITIVE_INFINITY
      )
    })
  ).filter(({ end, start }) => start <= end);
  if (intersections.length === 0) return undefined;
  for (const { end, start } of intersections) {
    if (bounded >= start && bounded <= end) return bounded;
  }
  return intersections
    .flatMap(({ end, start }) => [start, end])
    .reduce((closest, point) =>
      Math.abs(point - bounded) < Math.abs(closest - bounded) ? point : closest
    );
};

export const createNativeProvider = (
  media: HTMLVideoElement,
  options: NativePlaybackOptions = {}
): NativeProviderAdapter => {
  const listeners = new Set<ProviderStateListener>();
  const ownerDocument = media.ownerDocument;
  const webkitMedia: WebKitHTMLVideoElement = media;
  const startTime =
    Number.isFinite(options.startTime) && (options.startTime ?? 0) > 0
      ? (options.startTime ?? 0)
      : 0;
  const endTime =
    Number.isFinite(options.endTime) && (options.endTime ?? 0) > startTime
      ? options.endTime
      : undefined;
  const loop = options.loop ?? false;
  let attached = false;
  let destroyed = false;
  let loaded = false;
  let positioned = false;
  let boundaryEnded = false;
  let seekingFromEnded = false;
  let replayGeneration = 0;

  const emit = (
    patch: Parameters<ProviderStateListener>[0],
    event?: ProviderEvent
  ): void => listeners.forEach((listener) => listener(patch, event));

  const event = <Type extends PlayerEventType>(
    type: Type,
    originalEvent: Event,
    detail: PlayerEventDetailMap[Type]
  ): ProviderEventFor<Type> => ({
    type,
    detail,
    origin: 'provider',
    originalEvent
  });

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

  const airPlayAvailability = (): Availability => {
    if (typeof webkitMedia.webkitShowPlaybackTargetPicker !== 'function') {
      return unsupported;
    }
    return airPlayDisallowed() ? policyDisallowed : available;
  };

  const textTracks: NativeTextTracks = createNativeTextTracks(
    media,
    (patch) => emit(patch),
    () => mediaCapabilities()
  );

  function mediaCapabilities(): PlayerCapabilities {
    return {
      seek: available,
      setVolume: available,
      setPlaybackRate: available,
      selectQuality: { status: 'unknown', reason: 'provider-check' },
      selectTextTrack: textTracks.hasSelectableTextTracks()
        ? available
        : { status: 'unavailable', reason: 'provider' },
      fullscreen: fullscreenAvailability(),
      pictureInPicture: pictureInPictureAvailability(),
      airPlay: airPlayAvailability(),
      customControls: available
    };
  }

  const emitMediaState = (originalEvent?: Event): void =>
    emit(
      {
        lifecycle:
          media.readyState >= HTMLMediaElement.HAVE_METADATA
            ? 'ready'
            : 'loading',
        activation:
          media.readyState >= HTMLMediaElement.HAVE_METADATA
            ? 'ready'
            : 'loading-provider',
        currentTime: media.currentTime,
        duration: Number.isFinite(media.duration) ? media.duration : null,
        buffered: toRanges(media.buffered),
        seekable: toRanges(media.seekable),
        muted: media.muted,
        volume: media.volume,
        playbackRate: media.playbackRate,
        capabilities: mediaCapabilities()
      },
      originalEvent ? event('ready', originalEvent, undefined) : undefined
    );

  const onPlay = (originalEvent: Event): void => {
    boundaryEnded = false;
    seekingFromEnded = false;
    emit(
      {
        playback: 'playing',
        buffering: false,
        currentTime: media.currentTime
      },
      event('play', originalEvent, undefined)
    );
  };
  const onPlaying = (): void => emit({ playback: 'playing', buffering: false });
  const onPause = (originalEvent: Event): void => {
    if (boundaryEnded) return;
    emit({ playback: 'paused' }, event('pause', originalEvent, undefined));
  };
  const boundaryStart = (): number =>
    withinMediaBounds(media, startTime, startTime, endTime) ?? startTime;
  const beforeEffectiveEnd = (time: number): boolean => {
    const duration = Number.isFinite(media.duration)
      ? media.duration
      : undefined;
    const effectiveEnd =
      endTime === undefined
        ? duration
        : duration === undefined
          ? endTime
          : Math.min(endTime, duration);
    return effectiveEnd === undefined || time < effectiveEnd;
  };
  const restartFromBoundary = (): void => {
    boundaryEnded = false;
    seekingFromEnded = false;
    const restartTime = boundaryStart();
    const generation = ++replayGeneration;
    media.currentTime = restartTime;
    emit({ currentTime: restartTime, buffering: false });
    void Promise.resolve().then(async () => {
      if (destroyed || generation !== replayGeneration) return;
      try {
        await media.play();
      } catch (cause) {
        if (destroyed || generation !== replayGeneration) return;
        boundaryEnded = true;
        const failure = commandError(cause);
        emit({
          playback: 'ended',
          buffering: false,
          seeking: false,
          error: failure.error
        });
      }
    });
  };
  const onEnded = (originalEvent: Event): void => {
    if (loop) {
      restartFromBoundary();
      return;
    }
    boundaryEnded = true;
    emit(
      { playback: 'ended', buffering: false },
      event('ended', originalEvent, undefined)
    );
  };
  const onWaiting = (): void => emit({ buffering: true });
  const applyInitialPosition = (): void => {
    if (positioned) return;
    positioned = true;
    const initialPosition = withinMediaBounds(
      media,
      startTime,
      startTime,
      endTime
    );
    if (initialPosition !== undefined) media.currentTime = initialPosition;
  };
  const onCanPlay = (originalEvent: Event): void => {
    emit({ buffering: false });
    emitMediaState(originalEvent);
  };
  const onLoadedMetadata = (originalEvent: Event): void => {
    applyInitialPosition();
    onCanPlay(originalEvent);
  };
  const onSeeking = (originalEvent: Event): void => {
    if (boundaryEnded && beforeEffectiveEnd(media.currentTime)) {
      boundaryEnded = false;
      seekingFromEnded = true;
    }
    emit(
      { seeking: true },
      event('seeking', originalEvent, { currentTime: media.currentTime })
    );
  };
  const onSeeked = (originalEvent: Event): void => {
    const playback = seekingFromEnded ? { playback: 'paused' as const } : {};
    seekingFromEnded = false;
    emit(
      { seeking: false, currentTime: media.currentTime, ...playback },
      event('seeked', originalEvent, { currentTime: media.currentTime })
    );
  };
  const onTimeUpdate = (originalEvent: Event): void => {
    if (endTime !== undefined && media.currentTime >= endTime) {
      if (loop) {
        restartFromBoundary();
        return;
      }
      media.currentTime = endTime;
      if (!boundaryEnded) {
        boundaryEnded = true;
        media.pause();
        emit(
          { currentTime: endTime, playback: 'ended', buffering: false },
          event('ended', originalEvent, undefined)
        );
      }
      return;
    }
    boundaryEnded = false;
    emit({ currentTime: media.currentTime });
  };
  const onProgress = (): void =>
    emit({
      buffered: toRanges(media.buffered),
      seekable: toRanges(media.seekable)
    });
  const onVolumeChange = (originalEvent: Event): void =>
    emit(
      { muted: media.muted, volume: media.volume },
      event('volumechange', originalEvent, {
        muted: media.muted,
        volume: media.volume
      })
    );
  const onRateChange = (originalEvent: Event): void =>
    emit(
      { playbackRate: media.playbackRate },
      event('ratechange', originalEvent, {
        playbackRate: media.playbackRate
      })
    );
  const onError = (originalEvent: Event): void => {
    ++replayGeneration;
    boundaryEnded = false;
    seekingFromEnded = false;
    const error = mediaError(media);
    emit(
      {
        lifecycle: 'error',
        activation: 'error',
        playback: 'paused',
        buffering: false,
        seeking: false,
        error
      },
      event('error', originalEvent, error)
    );
  };
  const onFullscreenChange = (originalEvent: Event): void =>
    emit(
      { fullscreen: ownerDocument.fullscreenElement === media },
      event('fullscreenchange', originalEvent, {
        fullscreen: ownerDocument.fullscreenElement === media
      })
    );
  const onPictureInPictureChange = (originalEvent: Event): void =>
    emit(
      { pictureInPicture: ownerDocument.pictureInPictureElement === media },
      event('pictureinpicturechange', originalEvent, {
        pictureInPicture: ownerDocument.pictureInPictureElement === media
      })
    );
  const onWebKitFullscreenChange = (originalEvent: Event): void => {
    const fullscreen = originalEvent.type === 'webkitbeginfullscreen';
    emit(
      { fullscreen },
      event('fullscreenchange', originalEvent, { fullscreen })
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
      event('pictureinpicturechange', originalEvent, { pictureInPicture })
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
  };

  const removeListeners = (): void => {
    media.removeEventListener('play', onPlay);
    media.removeEventListener('playing', onPlaying);
    media.removeEventListener('pause', onPause);
    media.removeEventListener('ended', onEnded);
    media.removeEventListener('waiting', onWaiting);
    media.removeEventListener('canplay', onCanPlay);
    media.removeEventListener('loadedmetadata', onLoadedMetadata);
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
      textTracks.reset();
      media.load();
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      ++replayGeneration;
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
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeCues: textTracks.subscribeCues,
    play: () =>
      runCommand(() => {
        if (
          boundaryEnded ||
          (endTime !== undefined && media.currentTime >= endTime)
        ) {
          boundaryEnded = false;
          media.currentTime = boundaryStart();
        }
        return media.play();
      }),
    pause: () => {
      ++replayGeneration;
      return runCommand(() => media.pause());
    },
    seekTo: (time) => {
      if (!Number.isFinite(time))
        return Promise.resolve({ ok: false, reason: 'provider-error' });
      const target = withinMediaBounds(media, time, startTime, endTime);
      if (target === undefined)
        return Promise.resolve({ ok: false, reason: 'provider-error' });
      return runCommand(() => {
        if (boundaryEnded && beforeEffectiveEnd(target)) {
          boundaryEnded = false;
          seekingFromEnded = true;
        }
        media.currentTime = target;
      });
    },
    seekBy: (offset) => {
      if (!Number.isFinite(offset))
        return Promise.resolve({ ok: false, reason: 'provider-error' });
      const target = withinMediaBounds(
        media,
        media.currentTime + offset,
        startTime,
        endTime
      );
      if (target === undefined)
        return Promise.resolve({ ok: false, reason: 'provider-error' });
      return runCommand(() => {
        if (boundaryEnded && beforeEffectiveEnd(target)) {
          boundaryEnded = false;
          seekingFromEnded = true;
        }
        media.currentTime = target;
      });
    },
    mute: () =>
      runCommand(() => {
        media.muted = true;
      }),
    unmute: () =>
      runCommand(() => {
        media.muted = false;
      }),
    setVolume: (volume) => {
      if (!Number.isFinite(volume))
        return Promise.resolve({ ok: false, reason: 'provider-error' });
      return runCommand(() => {
        media.volume = Math.min(1, Math.max(0, volume));
      });
    },
    setPlaybackRate: (rate) => {
      if (!Number.isFinite(rate) || rate <= 0)
        return Promise.resolve({ ok: false, reason: 'provider-error' });
      return runCommand(() => {
        media.playbackRate = rate;
      });
    },
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
    retry: () => {
      ++replayGeneration;
      return runCommand(() => {
        positioned = false;
        boundaryEnded = false;
        media.load();
      });
    },
    selectTextTrack: textTracks.selectTextTrack,
    setCaptionRenderer: textTracks.setCaptionRenderer
  };
};
