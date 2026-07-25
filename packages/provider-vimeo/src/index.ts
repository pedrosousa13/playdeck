import type {
  Availability,
  CaptionRendering,
  CommandResult,
  PlayerCapabilities,
  PlayerError,
  PlayerEventDetailMap,
  PlayerEventType,
  ProviderAdapter,
  ProviderEvent,
  ProviderEventFor,
  ProviderStateListener,
  TextCue,
  TextTrack,
  TextTrackKind,
  VimeoSource
} from '@reely/core';
import { textTrackLabel } from '@reely/core';
import {
  loadVimeoSdk,
  type VimeoSdkPlayer,
  type VimeoSdkTextTrack
} from './loader.js';

export { loadVimeoSdk, resetVimeoSdkLoader } from './loader.js';
export type {
  VimeoSdkConstructor,
  VimeoSdkEventListener,
  VimeoSdkModule,
  VimeoSdkPlayer,
  VimeoSdkTextTrack
} from './loader.js';

const available: Availability = { status: 'available' };
const providerCheck: Availability = {
  status: 'unknown',
  reason: 'provider-check'
};

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

const commandFailure = (
  cause: unknown
): Exclude<CommandResult, { ok: true }> => {
  const name = errorString(cause, 'name');
  const message = errorString(cause, 'message') || 'The Vimeo command failed.';
  if (name === 'NotAllowedError') {
    return {
      ok: false,
      reason: 'blocked',
      error: {
        category: 'policy',
        fatal: false,
        recoverable: true,
        message,
        cause
      }
    };
  }
  if (name === 'UnsupportedError' || name === 'NotSupportedError') {
    return {
      ok: false,
      reason: 'unsupported',
      error: {
        category: 'unsupported',
        fatal: false,
        recoverable: true,
        message,
        cause
      }
    };
  }
  return {
    ok: false,
    reason: 'provider-error',
    error: {
      category: 'provider',
      fatal: false,
      recoverable: true,
      message,
      cause
    }
  };
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

const asRecord = (data: unknown): Record<string, unknown> =>
  typeof data === 'object' && data !== null
    ? (data as Record<string, unknown>)
    : {};

const numberField = (data: unknown, field: string): number | undefined => {
  const value = asRecord(data)[field];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
};

// `language` is Vimeo's stable per-track key, so it doubles as the id; the
// array index only disambiguates the rare case of two tracks sharing a
// language.
const vimeoTextTrackKind = (kind: string): TextTrackKind =>
  kind === 'captions' ? 'captions' : 'subtitles';

const vimeoTextTrackId = (
  track: VimeoSdkTextTrack,
  index: number,
  tracks: ReadonlyArray<VimeoSdkTextTrack>
): string =>
  tracks.filter((candidate) => candidate.language === track.language).length > 1
    ? `vimeo:${track.language}:${index}`
    : `vimeo:${track.language}`;

const resolveVimeoTextTrack = (
  id: string,
  tracks: ReadonlyArray<VimeoSdkTextTrack>
): VimeoSdkTextTrack | undefined =>
  tracks.find(
    (candidate, index) => vimeoTextTrackId(candidate, index, tracks) === id
  );

const toCoreTextTracks = (
  tracks: ReadonlyArray<VimeoSdkTextTrack>
): TextTrack[] =>
  tracks.map((track, index) => ({
    id: vimeoTextTrackId(track, index, tracks),
    label: textTrackLabel(track.label, track.language),
    language: track.language || null,
    kind: vimeoTextTrackKind(track.kind),
    readiness: 'loaded'
  }));

const showingVimeoTextTrackId = (
  tracks: ReadonlyArray<VimeoSdkTextTrack>
): string | null => {
  const index = tracks.findIndex((track) => track.mode === 'showing');
  return index === -1 ? null : vimeoTextTrackId(tracks[index]!, index, tracks);
};

const findVimeoTextTrackIndex = (
  language: string,
  kind: string,
  tracks: ReadonlyArray<VimeoSdkTextTrack>
): number =>
  language === ''
    ? -1
    : tracks.findIndex(
        (track) =>
          track.language === language && (kind === '' || track.kind === kind)
      );

const resolveActiveVimeoTextTrackId = (
  language: string,
  kind: string,
  tracks: ReadonlyArray<VimeoSdkTextTrack>
): string | null => {
  const index = findVimeoTextTrackIndex(language, kind, tracks);
  return index === -1 ? null : vimeoTextTrackId(tracks[index]!, index, tracks);
};

// Vimeo can either draw the cues itself or hand them over as `cuechange`
// payloads, so the renderer mode picks the owner: 'custom' means we enabled
// the track with `showing: false` and draw it in Reely's overlay, 'native'
// means Vimeo's in-iframe renderer draws it -- which is what 'provider'
// reports, and the fallback for anything the overlay cannot render.
const vimeoCaptionRendering = (
  tracks: ReadonlyArray<VimeoSdkTextTrack>,
  renderer: 'custom' | 'native'
): CaptionRendering =>
  tracks.length === 0
    ? 'unavailable'
    : renderer === 'custom'
      ? 'custom'
      : 'provider';

// Vimeo's cue payload is markup, not plain text: WebVTT tags survive in the
// `text` property (their own docs' example contains `<i>`), lines are joined
// with U+21B5 instead of a newline, and WebVTT requires `&`/`<`/`>` in cue
// text to arrive escaped. `TextCue.text` is plain text with real newlines, so
// this is a parse rather than a passthrough -- handing `text` straight through
// would render literal tags in the overlay.
const decodeCueEntities = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // A no-break space, not a plain one: captions use `&nbsp;` precisely to
    // stop the overlay breaking a line there.
    .replace(/&nbsp;/g, ' ')
    // `&amp;` last, so an escaped entity like `&amp;lt;` survives as `&lt;`
    // instead of being decoded twice into `<`.
    .replace(/&amp;/g, '&');

const vimeoCueText = (text: string): string =>
  decodeCueEntities(text.replace(/↵/g, '\n').replace(/<[^>]*>/g, ''));

export const createVimeoProvider = (
  mount: VimeoMountElement,
  source: VimeoSource,
  options: VimeoProviderOptions = {}
): VimeoProviderAdapter => {
  const listeners = new Set<ProviderStateListener>();
  const cueListeners = new Set<(cues: readonly TextCue[]) => void>();
  let attached = false;
  let destroyed = false;
  let started = false;
  let generation = 0;
  let activePlayer: VimeoSdkPlayer | undefined;
  let activeIframe: HTMLIFrameElement | undefined;
  let currentTime = 0;
  let duration: number | null = null;
  let textTracks: ReadonlyArray<VimeoSdkTextTrack> = [];
  let selectedTextTrackId: string | null = null;
  let volumeAvailability: Availability = available;
  let playbackRateAvailability: Availability = available;
  let pictureInPictureAvailability: Availability = available;
  let textTrackAvailability: Availability = providerCheck;
  let customControlsAvailability: Availability = providerCheck;
  let captionRenderer: 'custom' | 'native' = 'custom';
  let activeCues: readonly TextCue[] = [];

  const emitCues = (cues: readonly TextCue[]): void => {
    activeCues = cues;
    cueListeners.forEach((listener) => listener(cues));
  };

  const clearCues = (): void => {
    if (activeCues.length === 0) return;
    emitCues([]);
  };

  // `showing: false` is what makes Vimeo hand the cues over instead of drawing
  // them, so every enable has to carry the current renderer mode.
  const enableWithRenderer = (
    player: VimeoSdkPlayer,
    track: VimeoSdkTextTrack
  ): Promise<unknown> =>
    player.enableTextTrack(
      track.language,
      track.kind,
      captionRenderer === 'native'
    );

  const emit = (
    patch: Parameters<ProviderStateListener>[0],
    event?: ProviderEvent
  ): void => listeners.forEach((listener) => listener(patch, event));

  const event = <Type extends PlayerEventType>(
    type: Type,
    detail: PlayerEventDetailMap[Type],
    originalEvent?: unknown
  ): ProviderEventFor<Type> => ({
    type,
    detail,
    origin: 'provider',
    ...(originalEvent === undefined ? {} : { originalEvent })
  });

  const capabilities = (): PlayerCapabilities => ({
    seek: available,
    setVolume: volumeAvailability,
    setPlaybackRate: playbackRateAvailability,
    // The SDK exposes quality and remote-playback methods, but this adapter
    // wires no command surface for them yet, so they are unavailable through
    // Reely rather than forever "unknown".
    selectQuality: { status: 'unavailable', reason: 'provider' },
    selectTextTrack: textTrackAvailability,
    fullscreen: available,
    pictureInPicture: pictureInPictureAvailability,
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
    clearCues();
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
        event('play', undefined, data)
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
        event('pause', undefined, data)
      );
    });
    on('ended', (data) => {
      const seconds = numberField(data, 'seconds') ?? duration ?? currentTime;
      currentTime = seconds;
      emit(
        { playback: 'ended', buffering: false, currentTime: seconds },
        event('ended', undefined, data)
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
    on('progress', (data) => {
      const seconds = numberField(data, 'seconds');
      if (seconds === undefined) return;
      emit({ buffered: [{ start: 0, end: seconds }] });
    });
    on('bufferstart', () => emit({ buffering: true }));
    on('bufferend', () => emit({ buffering: false }));
    on('seeking', (data) => {
      const seconds = numberField(data, 'seconds') ?? currentTime;
      emit({ seeking: true }, event('seeking', { currentTime: seconds }, data));
    });
    on('seeked', (data) => {
      const seconds = numberField(data, 'seconds') ?? currentTime;
      currentTime = seconds;
      emit(
        { seeking: false, currentTime: seconds },
        event('seeked', { currentTime: seconds }, data)
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
            event('volumechange', { muted, volume }, data)
          );
        },
        () => undefined
      );
    });
    on('playbackratechange', (data) => {
      const playbackRate = numberField(data, 'playbackRate');
      if (playbackRate === undefined) return;
      emit({ playbackRate }, event('ratechange', { playbackRate }, data));
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
      emit({ fullscreen }, event('fullscreenchange', { fullscreen }, data));
    });
    on('enterpictureinpicture', (data) =>
      emit(
        { pictureInPicture: true },
        event('pictureinpicturechange', { pictureInPicture: true }, data)
      )
    );
    on('leavepictureinpicture', (data) =>
      emit(
        { pictureInPicture: false },
        event('pictureinpicturechange', { pictureInPicture: false }, data)
      )
    );
    on('cuechange', (data) => {
      const rawCues = asRecord(data).cues;
      if (!Array.isArray(rawCues)) return;
      // Vimeo's payload carries no cue timings at all, so the position the cue
      // became active at is the only honest thing to report for both bounds.
      const position = currentTime;
      emitCues(
        rawCues.flatMap((raw): TextCue[] => {
          const text = asRecord(raw).text;
          if (typeof text !== 'string') return [];
          const normalized = vimeoCueText(text);
          if (normalized.trim() === '') return [];
          return [
            {
              id: null,
              startTime: position,
              endTime: position,
              text: normalized
            }
          ];
        })
      );
    });
    on('texttrackchange', (data) => {
      // Fires whenever the active track changes, including through Vimeo's
      // own in-iframe UI, so this keeps our selection state honest with it.
      const record = asRecord(data);
      const language =
        typeof record.language === 'string' ? record.language : '';
      const kind = typeof record.kind === 'string' ? record.kind : '';
      if (
        findVimeoTextTrackIndex(language, kind, textTracks) !== -1 ||
        language === ''
      ) {
        selectedTextTrackId = resolveActiveVimeoTextTrackId(
          language,
          kind,
          textTracks
        );
        emit({ selectedTextTrackId });
        return;
      }
      // The reported track isn't part of the last known set -- refresh it
      // from the SDK before resolving the selection.
      void player.getTextTracks().then(
        (freshTracks) => {
          if (isStale(thisGeneration, player)) return;
          textTracks = freshTracks;
          textTrackAvailability =
            freshTracks.length > 0
              ? available
              : { status: 'unavailable', reason: 'source' };
          selectedTextTrackId = resolveActiveVimeoTextTrackId(
            language,
            kind,
            freshTracks
          );
          emit({
            textTracks: toCoreTextTracks(freshTracks),
            selectedTextTrackId,
            captionRendering: vimeoCaptionRendering(
              freshTracks,
              captionRenderer
            ),
            capabilities: capabilities()
          });
        },
        () => undefined
      );
    });
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
        event('error', error, data)
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
        chromeless
      ] = await Promise.all([
        player.getDuration().catch(() => null),
        player.getMuted().catch(() => mount.muted ?? false),
        player.getVolume().catch(() => mount.volume ?? 1),
        player.getPlaybackRate().catch(() => mount.playbackRate ?? 1),
        player
          .getTextTracks()
          .catch((): ReadonlyArray<VimeoSdkTextTrack> => []),
        availabilityPromise
      ]);
      if (isStale(thisGeneration, player)) return { ok: true };
      duration = initialDuration;
      textTracks = initialTracks;
      selectedTextTrackId = showingVimeoTextTrackId(initialTracks);
      // Vimeo can arrive with a track already showing -- a viewer's stored
      // preference, or `texttrack=` on the embed URL. Discovery only reads it,
      // so re-enable it under the current renderer: otherwise Vimeo keeps
      // drawing a track the overlay is also about to draw.
      if (selectedTextTrackId !== null) {
        const showing = resolveVimeoTextTrack(
          selectedTextTrackId,
          initialTracks
        );
        if (showing) {
          void Promise.resolve(enableWithRenderer(player, showing)).catch(
            () => undefined
          );
        }
      }
      textTrackAvailability =
        initialTracks.length > 0
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
          textTracks: toCoreTextTracks(textTracks),
          selectedTextTrackId,
          captionRendering: vimeoCaptionRendering(textTracks, captionRenderer),
          capabilities: capabilities()
        },
        event('ready', undefined)
      );
      return { ok: true };
    } catch (cause) {
      if (isStale(thisGeneration)) return { ok: true };
      teardown();
      const error = loadFailure(cause);
      emit(
        { lifecycle: 'error', activation: 'error', error },
        event('error', error)
      );
      return { ok: false, reason: 'provider-error', error };
    }
  };

  const runCommand = async (
    command: (player: VimeoSdkPlayer) => Promise<unknown>
  ): Promise<CommandResult> => {
    const player = activePlayer;
    if (destroyed || !player) return { ok: false, reason: 'not-ready' };
    try {
      await command(player);
      return { ok: true };
    } catch (cause) {
      return commandFailure(cause);
    }
  };

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
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
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
    selectTextTrack: (id) => {
      if (id === null) {
        return runCommand((player) => player.disableTextTrack()).then(
          (result) => {
            if (result.ok) {
              selectedTextTrackId = null;
              clearCues();
              emit({ selectedTextTrackId: null });
            }
            return result;
          }
        );
      }
      const match = resolveVimeoTextTrack(id, textTracks);
      if (!match) return Promise.resolve({ ok: false, reason: 'unsupported' });
      return runCommand((player) => enableWithRenderer(player, match)).then(
        (result) => {
          if (result.ok) {
            selectedTextTrackId = id;
            emit({ selectedTextTrackId: id });
          }
          return result;
        }
      );
    },
    subscribeCues: (listener) => {
      cueListeners.add(listener);
      return () => cueListeners.delete(listener);
    },
    setCaptionRenderer: (mode) => {
      if (mode === captionRenderer) return;
      captionRenderer = mode;
      // Vimeo decides whether to draw the cues at enable time, so the active
      // track has to be re-enabled for a mode flip to take effect.
      const player = activePlayer;
      const active =
        selectedTextTrackId === null
          ? undefined
          : resolveVimeoTextTrack(selectedTextTrackId, textTracks);
      if (player && active) {
        void Promise.resolve(enableWithRenderer(player, active)).catch(
          () => undefined
        );
      }
      if (captionRenderer === 'native') clearCues();
      emit({
        captionRendering: vimeoCaptionRendering(textTracks, captionRenderer)
      });
    },
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
