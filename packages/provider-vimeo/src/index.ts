import type {
  Availability,
  CommandResult,
  MediaDimensions,
  PlayerCapabilities,
  PlayerError,
  PlayerQuality,
  ProviderAdapter,
  ProviderEvent,
  ProviderStateListener,
  TimeRange,
  VimeoSource
} from '@reely/core';
import {
  asRecord,
  available,
  errorString,
  numberField,
  providerCheck,
  providerEvent,
  runVimeoCommand
} from './adapter-values.js';
import {
  loadVimeoSdk,
  type VimeoSdkPlayer,
  type VimeoSdkQuality,
  type VimeoSdkTextTrack
} from './loader.js';
import { createVimeoTextTracks } from './text-tracks.js';

export { loadVimeoSdk, resetVimeoSdkLoader } from './loader.js';
export type {
  VimeoSdkConstructor,
  VimeoSdkEventListener,
  VimeoSdkModule,
  VimeoSdkPlayer,
  VimeoSdkQuality,
  VimeoSdkTextTrack
} from './loader.js';

export type VimeoMountElement = HTMLElement & {
  muted?: boolean;
  volume?: number;
  playbackRate?: number;
};

export type VimeoProviderOptions = {
  readonly controls?: boolean;
  readonly dnt?: boolean;
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

const loadFailure = (cause: unknown): PlayerError => {
  const name = errorString(cause, 'name');
  const category =
    name === 'PrivacyError' || name === 'PasswordError'
      ? 'policy'
      : name === 'NotFoundError'
        ? 'source'
        : 'provider';
  return {
    category,
    fatal: true,
    recoverable: category === 'provider',
    message:
      errorString(cause, 'message') || 'The Vimeo player could not load.',
    cause
  };
};

const vimeoWatchUrl = (source: VimeoSource): string =>
  `https://vimeo.com/${source.videoId}${source.hash ? `/${source.hash}` : ''}`;

const vimeoEmbedUrl = (
  source: VimeoSource,
  options: VimeoProviderOptions,
  muted: boolean | undefined
): string => {
  const url = new URL(`https://player.vimeo.com/video/${source.videoId}`);
  if (source.hash) url.searchParams.set('h', source.hash);
  url.searchParams.set('controls', options.controls === true ? '1' : '0');
  url.searchParams.set('dnt', options.dnt === false ? '0' : '1');
  url.searchParams.set('playsinline', '1');
  if (muted) url.searchParams.set('muted', '1');
  return url.href;
};

const planLimitedAccountTypes = new Set(['free', 'basic']);

// Tiers verified against the live oEmbed API plus Vimeo's documented paid
// lineups (legacy and 2023 rename). Unknown future tiers stay unresolved so a
// gated tier is never misreported as chromeless-capable.
const chromelessAccountTypes = new Set([
  'plus',
  'pro',
  'business',
  'premium',
  'enterprise',
  'custom',
  'starter',
  'standard',
  'advanced'
]);

const chromelessAvailability = async (
  source: VimeoSource
): Promise<Availability> => {
  try {
    const response = await fetch(
      `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(
        vimeoWatchUrl(source)
      )}`
    );
    if (!response.ok) return providerCheck;
    const data: unknown = await response.json();
    const accountType =
      typeof data === 'object' &&
      data !== null &&
      'account_type' in data &&
      typeof data.account_type === 'string'
        ? data.account_type
        : undefined;
    if (!accountType) return providerCheck;
    if (planLimitedAccountTypes.has(accountType)) {
      return { status: 'unavailable', reason: 'provider-plan' };
    }
    return chromelessAccountTypes.has(accountType) ? available : providerCheck;
  } catch {
    return providerCheck;
  }
};

const settleWithFallback = <Value>(
  promise: Promise<Value>,
  fallback: Value,
  milliseconds: number
): Promise<Value> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });

const stringField = (data: unknown, field: string): string | undefined => {
  const value = asRecord(data)[field];
  return typeof value === 'string' ? value : undefined;
};

// The SDK hands back `[start, end]` pairs. Anything else is not a range we can
// vouch for, so it is dropped rather than guessed at.
const toRanges = (
  ranges: ReadonlyArray<readonly number[]>
): readonly TimeRange[] =>
  ranges.flatMap(([start, end]) =>
    typeof start === 'number' &&
    typeof end === 'number' &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    end >= start
      ? [{ start, end }]
      : []
  );

// Vimeo's rung ids are its own stable keys, so they double as the Reely id
// under the `vimeo:` prefix the text tracks already use. `auto` is one of them,
// but it is a mode rather than a rung: the state contract carries that as
// `selectedQualityId: null`, the way it does for hls.js, so it is filtered out
// of the published list instead of appearing as something to pick.
const vimeoQualityId = (id: string): string => `vimeo:${id}`;

const isVimeoRung = (quality: VimeoSdkQuality): boolean =>
  quality.id !== 'auto';

// An embed that does not implement `getQualities` still answers it, so what
// comes back is not guaranteed to be a list of rungs at all. Same rule as the
// buffered ranges: a shape we cannot vouch for is dropped, not guessed at.
const toVimeoQualities = (value: unknown): ReadonlyArray<VimeoSdkQuality> =>
  Array.isArray(value)
    ? (value as ReadonlyArray<VimeoSdkQuality>).filter(
        (quality) => typeof quality?.id === 'string'
      )
    : [];

// The rung label is Vimeo's nominal name for it, not a measurement — the rung
// it calls `240p` renders at 480x270 (#82). It is still the name Vimeo's own
// menu shows, so it is the honest thing to label with; width and bitrate the
// SDK does not report at all.
const vimeoQualityHeight = (id: string): number | null => {
  const match = /^(\d+)p$/.exec(id);
  return match ? Number(match[1]) : null;
};

const toCoreQualities = (
  qualities: ReadonlyArray<VimeoSdkQuality>
): PlayerQuality[] =>
  qualities.filter(isVimeoRung).map((quality) => ({
    id: vimeoQualityId(quality.id),
    height: vimeoQualityHeight(quality.id),
    width: null,
    bitrate: null
  }));

const resolveVimeoQuality = (
  id: string,
  qualities: ReadonlyArray<VimeoSdkQuality>
): VimeoSdkQuality | undefined =>
  qualities
    .filter(isVimeoRung)
    .find((quality) => vimeoQualityId(quality.id) === id);

// `active` marks the entry the player is honouring, which under adaptive
// playback is `auto` itself — the rung actually rendering is not identified,
// and `null` says exactly that.
const activeVimeoQualityId = (
  qualities: ReadonlyArray<VimeoSdkQuality>
): string | null => {
  const active = qualities
    .filter(isVimeoRung)
    .find((quality) => quality.active);
  return active ? vimeoQualityId(active.id) : null;
};

export const createVimeoProvider = (
  mount: VimeoMountElement,
  source: VimeoSource,
  options: VimeoProviderOptions = {}
): VimeoProviderAdapter => {
  const listeners = new Set<ProviderStateListener>();
  const dimensionListeners = new Set<
    (dimensions: MediaDimensions | undefined) => void
  >();
  let attached = false;
  let destroyed = false;
  let started = false;
  let generation = 0;
  let activePlayer: VimeoSdkPlayer | undefined;
  let activeIframe: HTMLIFrameElement | undefined;
  let currentTime = 0;
  let duration: number | null = null;
  let qualities: ReadonlyArray<VimeoSdkQuality> = [];
  let selectedQualityId: string | null = null;
  let qualityAvailability: Availability = providerCheck;
  let volumeAvailability: Availability = available;
  let playbackRateAvailability: Availability = available;
  let pictureInPictureAvailability: Availability = available;
  let customControlsAvailability: Availability = providerCheck;
  let activeDimensions: MediaDimensions | undefined;

  // Anything that is not two finite positive numbers publishes as "not known".
  // A missing figure defaults to 0 so it fails the same `> 0` test the SDK's
  // own zeroes do, rather than needing a separate undefined check.
  const emitDimensions = (width = 0, height = 0): void => {
    const dimensions =
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
        ? { width, height }
        : undefined;
    activeDimensions = dimensions;
    dimensionListeners.forEach((listener) => listener(dimensions));
  };

  const clearDimensions = (): void => {
    if (activeDimensions === undefined) return;
    emitDimensions();
  };

  const emit = (
    patch: Parameters<ProviderStateListener>[0],
    event?: ProviderEvent
  ): void => listeners.forEach((listener) => listener(patch, event));

  const textTracks = createVimeoTextTracks({
    emit,
    isStale: (player) => destroyed || player !== activePlayer,
    getPlayer: () => (destroyed ? undefined : activePlayer),
    getCurrentTime: () => currentTime,
    getCapabilities: () => capabilities()
  });

  const capabilities = (): PlayerCapabilities => ({
    seek: available,
    setVolume: volumeAvailability,
    setPlaybackRate: playbackRateAvailability,
    selectQuality: qualityAvailability,
    selectTextTrack: textTracks.selectTextTrackAvailability(),
    fullscreen: available,
    pictureInPicture: pictureInPictureAvailability,
    // The SDK exposes remote-playback methods, but this adapter wires no
    // command surface for them yet, so they are unavailable through Reely
    // rather than forever "unknown".
    airPlay: { status: 'unavailable', reason: 'provider' },
    customControls: customControlsAvailability
  });

  const isStale = (thisGeneration: number, player?: VimeoSdkPlayer): boolean =>
    destroyed ||
    thisGeneration !== generation ||
    (player !== undefined && player !== activePlayer);

  const teardown = (): void => {
    const player = activePlayer;
    const iframe = activeIframe;
    activePlayer = undefined;
    activeIframe = undefined;
    // Cues belong to the player being discarded; a retry must not inherit them.
    // Neither must its measured shape: the replacement may take a while to
    // answer, or never answer, and until it does a leftover ratio describes a
    // video that is no longer there.
    textTracks.reset();
    clearDimensions();
    if (player) {
      try {
        void Promise.resolve(player.destroy()).catch(() => undefined);
      } catch {
        // Teardown must not escape the provider boundary.
      }
    }
    iframe?.remove();
  };

  const wireEvents = (player: VimeoSdkPlayer, thisGeneration: number): void => {
    const on = (name: string, listener: (data?: unknown) => void): void =>
      player.on(name, (data?: unknown) => {
        if (isStale(thisGeneration, player)) return;
        listener(data);
      });

    on('play', (data) => {
      const seconds = numberField(data, 'seconds');
      if (seconds !== undefined) currentTime = seconds;
      emit(
        {
          playback: 'playing',
          buffering: false,
          ...(seconds === undefined ? {} : { currentTime: seconds })
        },
        providerEvent('play', undefined, data)
      );
    });
    on('playing', () => emit({ playback: 'playing', buffering: false }));
    on('pause', (data) => {
      if (numberField(data, 'percent') === 1) return;
      const seconds = numberField(data, 'seconds');
      if (seconds !== undefined) currentTime = seconds;
      emit(
        {
          playback: 'paused',
          ...(seconds === undefined ? {} : { currentTime: seconds })
        },
        providerEvent('pause', undefined, data)
      );
    });
    on('ended', (data) => {
      const seconds = numberField(data, 'seconds') ?? duration ?? currentTime;
      currentTime = seconds;
      emit(
        { playback: 'ended', buffering: false, currentTime: seconds },
        providerEvent('ended', undefined, data)
      );
    });
    on('timeupdate', (data) => {
      const seconds = numberField(data, 'seconds');
      const nextDuration = numberField(data, 'duration');
      if (seconds === undefined) return;
      currentTime = seconds;
      if (nextDuration !== undefined) duration = nextDuration;
      emit({
        currentTime: seconds,
        ...(nextDuration === undefined ? {} : { duration: nextDuration })
      });
    });
    // `progress.seconds` is the end of the range holding the playhead, not a
    // range from zero, so it cannot describe the buffer on its own: after a
    // seek it both hides real ranges and spans the hole in between (#91).
    // `getBuffered()` reports the ranges themselves.
    on('progress', () => {
      void player.getBuffered().then(
        (ranges) => {
          if (isStale(thisGeneration, player)) return;
          emit({ buffered: toRanges(ranges) });
        },
        () => undefined
      );
    });
    // Unlike `progress`, `resize` carries the new intrinsic size in its own
    // payload, so it needs no getter round trip — and therefore no second,
    // post-await `isStale` guard the way `progress` does above. The one `on`
    // already applies to every listener is the only one this needs.
    on('resize', (data) => {
      emitDimensions(
        numberField(data, 'videoWidth'),
        numberField(data, 'videoHeight')
      );
    });
    on('bufferstart', () => emit({ buffering: true }));
    on('bufferend', () => emit({ buffering: false }));
    on('seeking', (data) => {
      const seconds = numberField(data, 'seconds') ?? currentTime;
      emit(
        { seeking: true },
        providerEvent('seeking', { currentTime: seconds }, data)
      );
    });
    on('seeked', (data) => {
      const seconds = numberField(data, 'seconds') ?? currentTime;
      currentTime = seconds;
      emit(
        { seeking: false, currentTime: seconds },
        providerEvent('seeked', { currentTime: seconds }, data)
      );
    });
    on('volumechange', (data) => {
      const volume = numberField(data, 'volume');
      if (volume === undefined) return;
      void player.getMuted().then(
        (muted) => {
          if (isStale(thisGeneration, player)) return;
          emit(
            { muted, volume },
            providerEvent('volumechange', { muted, volume }, data)
          );
        },
        () => undefined
      );
    });
    on('playbackratechange', (data) => {
      const playbackRate = numberField(data, 'playbackRate');
      if (playbackRate === undefined) return;
      emit(
        { playbackRate },
        providerEvent('ratechange', { playbackRate }, data)
      );
    });
    // Vimeo's own settings menu can pin a rung too, on an embed that shows it.
    // The event reports the *selection*, not the rung adaptive playback is on:
    // under auto the rendition moved 720 -> 540 with nothing fired (#82).
    on('qualitychange', (data) => {
      const quality = stringField(data, 'quality');
      if (quality === undefined) return;
      const next = quality === 'auto' ? null : vimeoQualityId(quality);
      if (next !== null && !resolveVimeoQuality(next, qualities)) return;
      if (next === selectedQualityId) return;
      selectedQualityId = next;
      emit({ selectedQualityId: next });
    });
    on('durationchange', (data) => {
      const nextDuration = numberField(data, 'duration');
      if (nextDuration === undefined) return;
      duration = nextDuration;
      emit({
        duration: nextDuration,
        seekable: [{ start: 0, end: nextDuration }]
      });
    });
    on('fullscreenchange', (data) => {
      const fullscreen = asRecord(data).fullscreen === true;
      emit(
        { fullscreen },
        providerEvent('fullscreenchange', { fullscreen }, data)
      );
    });
    on('enterpictureinpicture', (data) =>
      emit(
        { pictureInPicture: true },
        providerEvent(
          'pictureinpicturechange',
          { pictureInPicture: true },
          data
        )
      )
    );
    on('leavepictureinpicture', (data) =>
      emit(
        { pictureInPicture: false },
        providerEvent(
          'pictureinpicturechange',
          { pictureInPicture: false },
          data
        )
      )
    );
    on('cuechange', textTracks.handlers.onCueChange);
    on('texttrackchange', (data) =>
      textTracks.handlers.onTextTrackChange(player, data)
    );
    on('error', (data) => {
      const record = asRecord(data);
      if (typeof record.method === 'string') return;
      const error = loadFailure(
        Object.assign(new Error(), {
          name: typeof record.name === 'string' ? record.name : 'Error',
          message:
            typeof record.message === 'string'
              ? record.message
              : 'The Vimeo player reported an error.'
        })
      );
      emit(
        {
          lifecycle: 'error',
          activation: 'error',
          playback: 'paused',
          buffering: false,
          seeking: false,
          error
        },
        providerEvent('error', error, data)
      );
    });
  };

  const start = async (thisGeneration: number): Promise<CommandResult> => {
    try {
      const Sdk = await loadVimeoSdk();
      if (isStale(thisGeneration)) return { ok: true };
      const iframe = mount.ownerDocument.createElement('iframe');
      iframe.src = vimeoEmbedUrl(source, options, mount.muted);
      iframe.setAttribute(
        'allow',
        'autoplay; fullscreen; picture-in-picture; encrypted-media'
      );
      iframe.setAttribute('allowfullscreen', '');
      iframe.setAttribute('title', 'Vimeo video player');
      iframe.style.position = 'absolute';
      iframe.style.inset = '0';
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = '0';
      mount.appendChild(iframe);
      const player = new Sdk(iframe);
      activePlayer = player;
      activeIframe = iframe;
      wireEvents(player, thisGeneration);
      // `runCommand` accepts from here, and the SDK queues calls it receives
      // before its own ready resolves. Declaring at `player.ready()` instead
      // would never fire behind a blocked iframe (#69).
      emit({ commandsReady: true });
      const availabilityPromise =
        options.controls === true
          ? Promise.resolve<Availability>({
              status: 'unavailable',
              reason: 'provider'
            })
          : settleWithFallback(
              chromelessAvailability(source),
              providerCheck,
              4000
            );
      await player.ready();
      if (isStale(thisGeneration, player)) return { ok: true };
      const [
        initialDuration,
        initialMuted,
        initialVolume,
        initialPlaybackRate,
        initialTracks,
        initialQualities,
        chromeless,
        initialWidth,
        initialHeight
      ] = await Promise.all([
        player.getDuration().catch(() => null),
        player.getMuted().catch(() => mount.muted ?? false),
        player.getVolume().catch(() => mount.volume ?? 1),
        player.getPlaybackRate().catch(() => mount.playbackRate ?? 1),
        player
          .getTextTracks()
          .catch((): ReadonlyArray<VimeoSdkTextTrack> => []),
        player.getQualities().catch((): ReadonlyArray<VimeoSdkQuality> => []),
        availabilityPromise,
        // An embed that does not answer these leaves the size unknown, which
        // is a fallback the consumer already handles — never a reason to fail
        // the attach.
        player.getVideoWidth().catch((): undefined => undefined),
        player.getVideoHeight().catch((): undefined => undefined)
      ]);
      if (isStale(thisGeneration, player)) return { ok: true };
      emitDimensions(initialWidth, initialHeight);
      duration = initialDuration;
      const textTrackPatch = textTracks.adopt(player, initialTracks);
      qualities = toVimeoQualities(initialQualities);
      // Re-derived from the player in hand, never carried over: a retry builds
      // an embed with nothing pinned, and a stale id would report a rung it is
      // not honouring.
      selectedQualityId = activeVimeoQualityId(qualities);
      const rungs = toCoreQualities(qualities);
      qualityAvailability =
        rungs.length > 0
          ? available
          : { status: 'unavailable', reason: 'source' };
      customControlsAvailability = chromeless;
      if (
        mount.volume !== undefined &&
        Number.isFinite(mount.volume) &&
        mount.volume !== initialVolume
      ) {
        void player
          .setVolume(Math.min(1, Math.max(0, mount.volume)))
          .catch(() => undefined);
      }
      if (
        mount.playbackRate !== undefined &&
        Number.isFinite(mount.playbackRate) &&
        mount.playbackRate > 0 &&
        mount.playbackRate !== initialPlaybackRate
      ) {
        void player.setPlaybackRate(mount.playbackRate).catch(() => undefined);
      }
      emit(
        {
          lifecycle: 'ready',
          activation: 'ready',
          playback: 'paused',
          buffering: false,
          seeking: false,
          currentTime,
          duration,
          muted: initialMuted,
          volume: initialVolume,
          playbackRate: initialPlaybackRate,
          ...(duration === null
            ? {}
            : { seekable: [{ start: 0, end: duration }] }),
          ...textTrackPatch,
          qualities: rungs,
          selectedQualityId,
          capabilities: capabilities()
        },
        providerEvent('ready', undefined)
      );
      return { ok: true };
    } catch (cause) {
      if (isStale(thisGeneration)) return { ok: true };
      teardown();
      const error = loadFailure(cause);
      emit(
        { lifecycle: 'error', activation: 'error', error },
        providerEvent('error', error)
      );
      return { ok: false, reason: 'provider-error', error };
    }
  };

  const runCommand = (
    command: (player: VimeoSdkPlayer) => Promise<unknown>
  ): Promise<CommandResult> =>
    runVimeoCommand(destroyed ? undefined : activePlayer, command);

  return {
    provider: 'vimeo',
    attach: () => {
      if (attached || destroyed) return;
      attached = true;
    },
    load: async () => {
      if (destroyed || started) return;
      started = true;
      await start(++generation);
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      ++generation;
      teardown();
      listeners.clear();
      textTracks.clearCueListeners();
      dimensionListeners.clear();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeDimensions: (listener) => {
      dimensionListeners.add(listener);
      return () => dimensionListeners.delete(listener);
    },
    play: () => runCommand((player) => player.play()),
    pause: () => runCommand((player) => player.pause()),
    seekTo: (time) => {
      if (!Number.isFinite(time))
        return Promise.resolve({ ok: false, reason: 'provider-error' });
      const target = Math.max(
        0,
        duration === null ? time : Math.min(duration, time)
      );
      return runCommand((player) => player.setCurrentTime(target));
    },
    seekBy: (offset) => {
      if (!Number.isFinite(offset))
        return Promise.resolve({ ok: false, reason: 'provider-error' });
      const target = Math.max(
        0,
        duration === null
          ? currentTime + offset
          : Math.min(duration, currentTime + offset)
      );
      return runCommand((player) => player.setCurrentTime(target));
    },
    mute: () => runCommand((player) => player.setMuted(true)),
    unmute: () => runCommand((player) => player.setMuted(false)),
    setVolume: async (volume) => {
      if (!Number.isFinite(volume))
        return { ok: false, reason: 'provider-error' };
      const result = await runCommand((player) =>
        player.setVolume(Math.min(1, Math.max(0, volume)))
      );
      if (!result.ok && result.reason === 'unsupported') {
        volumeAvailability = { status: 'unavailable', reason: 'provider' };
        emit({ capabilities: capabilities() });
      }
      return result;
    },
    setPlaybackRate: async (rate) => {
      if (!Number.isFinite(rate) || rate <= 0)
        return { ok: false, reason: 'provider-error' };
      const result = await runCommand((player) => player.setPlaybackRate(rate));
      if (!result.ok && result.reason === 'unsupported') {
        playbackRateAvailability = {
          status: 'unavailable',
          reason: 'provider-plan'
        };
        emit({ capabilities: capabilities() });
      }
      return result;
    },
    // Resolved against the list the player published before the SDK is called:
    // an id it never offered never settles at all, so an unchecked pass-through
    // is a command that hangs rather than one that fails (#82).
    selectQuality: (id) => {
      const target =
        id === null
          ? qualities.find((quality) => !isVimeoRung(quality))
          : resolveVimeoQuality(id, qualities);
      if (!target) return Promise.resolve({ ok: false, reason: 'unsupported' });
      return runCommand((player) => player.setQuality(target.id)).then(
        (result) => {
          if (result.ok) {
            selectedQualityId = id;
            emit({ selectedQualityId: id });
          }
          return result;
        }
      );
    },
    selectTextTrack: textTracks.selectTextTrack,
    subscribeCues: textTracks.subscribeCues,
    setCaptionRenderer: textTracks.setCaptionRenderer,
    requestFullscreen: () => runCommand((player) => player.requestFullscreen()),
    exitFullscreen: () => runCommand((player) => player.exitFullscreen()),
    requestPictureInPicture: async () => {
      const result = await runCommand((player) =>
        player.requestPictureInPicture()
      );
      if (!result.ok && result.reason === 'unsupported') {
        pictureInPictureAvailability = {
          status: 'unavailable',
          reason: 'provider'
        };
        emit({ capabilities: capabilities() });
      }
      return result;
    },
    exitPictureInPicture: () =>
      runCommand((player) => player.exitPictureInPicture()),
    retry: async () => {
      if (destroyed) return { ok: false, reason: 'not-ready' };
      const thisGeneration = ++generation;
      teardown();
      started = true;
      return start(thisGeneration);
    }
  };
};
