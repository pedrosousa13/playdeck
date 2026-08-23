import {
  createTimeBoundary,
  deriveLiveState,
  isPermittedSourceUrl,
  liveStateEqual,
  notifySafely,
  resolveNetworkPath,
  type CommandResult,
  type MediaDimensions,
  type PlayerCapabilities,
  type PlayerError,
  type PlayerLiveState,
  type ProviderStatePatch,
  type WistiaSource
} from '@playdeck/core';
import {
  asRecord,
  errorString,
  providerEvent,
  type EmitProviderState,
  type IsStalePlayer,
  type WistiaMountElement
} from './adapter-values.js';
import {
  API_READY_EVENT,
  loadWistiaPlayer,
  readApiHandle,
  WISTIA_PLAYER_TAG,
  type WistiaLoadedMediaDataDetail,
  type WistiaPlayerApi,
  type WistiaPlayerAttribute,
  type WistiaPlayerElement
} from './loader.js';
import { toPlaybackState, type WistiaPlayback } from './playback.js';
import type { WistiaPresentation } from './presentation.js';

const loadFailure = (cause: unknown): PlayerError => ({
  category: 'provider',
  fatal: true,
  recoverable: true,
  message: errorString(cause, 'message') || 'The Wistia player could not load.',
  cause
});

// How long the `api-ready` handshake is given before the attach is reported
// as failed. Aurora has no failure event to wait for instead: when the media
// data comes back asking for the legacy iframe embed, the element writes that
// iframe into its shadow root and returns without ever initialising a public
// API, and when the fetch rejects it re-throws inside its own promise chain
// (`WistiaPlayer.tsx:2597-2651` in the published source map). Either way
// nothing is dispatched, so without a deadline the adapter would sit in
// `loading` for ever with nothing for the host to retry.
//
// Fifteen seconds, not four: the handshake covers a media-data request and the
// engine import from Wistia's CDN, which retries three times on its own before
// giving up. This is a "that is never coming" backstop, not a performance
// budget, and cutting it short would report a slow connection as a failure.
export const API_READY_TIMEOUT_MS = 15_000;

// How often the at-edge half of `live` is recomputed while the media is paused.
// Deliberately not an event: `time-update` is the only report that carries the
// playhead, and Wistia stops dispatching it the moment the player pauses, so a
// paused live stream would hold the last flag it published while the live edge
// went on advancing — a control bar reading "at the live edge" for a viewer
// minutes behind. There is no idle event to bind instead. Every playback name
// this adapter binds is dispatched by the engine Wistia's element fetches from
// its CDN, none of them fires while paused, and the eight events the shipped
// package does declare (`dist/types/types/events.d.ts`) are load, replace and
// embed-option notices with no counterpart to the native `progress`.
//
// Five seconds, which is half the shared at-edge tolerance in
// `@playdeck/core`'s `deriveLiveState`: the published flag is then never more than
// half a window out of date, and a paused player costs twelve wake-ups a minute
// doing nothing but arithmetic on two numbers it already has.
export const LIVE_EDGE_POLL_MS = 5_000;

// Rejects if `settled` has not answered within the deadline. The timer is
// cleared the moment it does, so a normal attach leaves nothing pending.
const withDeadline = <Value>(
  settled: Promise<Value>,
  milliseconds: number,
  onTimeout: () => Error
): Promise<Value> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), milliseconds);
    settled.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause: unknown) => {
        clearTimeout(timer);
        reject(cause as Error);
      }
    );
  });

// Wistia names its embed options in camelCase and reads them off kebab-case
// attributes, so the two spellings are one conversion rather than a table to
// keep in step. `WistiaPlayerAttribute` restates Wistia's own `Attributes`
// names, so an option this adapter sets has to be one of them — but since #225
// that list is a local copy rather than the vendor's type, so a name Wistia
// renames now diverges silently instead of failing to compile.
const attributeName = (option: WistiaPlayerAttribute): string =>
  option.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

// `playerColor` and `poster` are documented as a hex colour and an image URL
// but reach the provider as bare strings, so each is checked here — the one
// place either option becomes an attribute, which covers every consumer of
// the package rather than only those coming through `Player.Root`. This does
// not extend to `mediaId`, set below: that value reaches the element
// unchecked by this file, because `createWistiaProvider` already validates it
// with `isWistiaMediaId` before this seam is even built (#222). A value that
// fails its check sets no attribute, the same element state as omitting the
// option — one bad presentation option must not fail playback. That drop used
// to be silent; it is no longer unreported, since `buildElement` below
// publishes it as a non-fatal `configuration` notice (#235).
//
// Every hex form CSS Color 4 spells: three, four, six, or eight digits, with
// or without the hash — the four- and eight-digit forms carry an alpha channel.
// The hash is optional because Wistia's own examples write `playerColor` bare,
// and the attribute is handed to the player as given.
const isHexColor = (value: string): boolean =>
  /^#?(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);

// What a rejected `playerColor` or `poster` publishes. Never `recoverable`:
// the fix is a different option value, so a retry would just replay the same
// rejection (#198). Names the option and what was expected rather than
// echoing the rejected value, the same posture as the YouTube adapter's
// `hostConfigurationNotice` (#235).
//
// The two are ranked apart, and that is what decides which one an operator is
// shown when an attach rejects both. A colour that failed its hex check left the
// player wearing Wistia's own; a poster that failed the shared allowlist is an
// untrusted URL this adapter refused to hand the element, which is a security
// control firing (#368).
const playerColorConfigurationNotice: PlayerError = {
  category: 'configuration',
  fatal: false,
  recoverable: false,
  severity: 'presentational',
  message: 'The playerColor option was rejected: expected a CSS hex colour.'
};

const posterConfigurationNotice: PlayerError = {
  category: 'configuration',
  fatal: false,
  recoverable: false,
  severity: 'protective',
  message: 'The poster option was rejected: expected a permitted source URL.'
};

// The event the element dispatches once its media data is back, named
// `LOADED_MEDIA_DATA_EVENT` in the SDK's `utilities/eventConstants`. Restated
// as a string for the same reason `API_READY_EVENT` in `loader.ts` is: that
// module ships no runtime entry point this package can import.
const LOADED_MEDIA_DATA_EVENT = 'loaded-media-data';

type WistiaMediaData = WistiaLoadedMediaDataDetail['mediaData'];

// Wistia's only liveness signal. `MediaData.mediaType` is optional and has four
// members, of which `'LiveStream'` is the live one; anything else — `Audio`,
// `Video`, `ab-test`, a payload naming no type at all, or a load that never
// reports media data — is not live. The source URL, the media id and the
// filename are never consulted: a name is a guess, and a guess published as
// state is a control that lies.
//
// `MediaData.liveStreamEventDetails` is deliberately not read. It carries the
// broadcast's schedule — `scheduledFor`, `startedAt`, a manifest URL — and
// nothing about where the playhead sits, so it cannot answer the at-edge half.
const isLiveMediaData = (detail: unknown): boolean => {
  const mediaData =
    asRecord(detail)['mediaData' satisfies keyof WistiaLoadedMediaDataDetail];
  const mediaType =
    asRecord(mediaData)['mediaType' satisfies keyof WistiaMediaData];
  return mediaType === ('LiveStream' satisfies WistiaMediaData['mediaType']);
};

// The embed options this adapter expresses, read when the element is built
// rather than snapshotted at construction. Kept in step with
// `WistiaProviderOptions` in `index.ts`.
type WistiaEmbedOptions = {
  readonly controls?: boolean;
  readonly dnt?: boolean;
  readonly endTime?: number;
  readonly loop?: boolean;
  readonly playerColor?: string;
  readonly swatch?: boolean;
  readonly poster?: string;
  readonly startTime?: number;
  readonly transparentLetterbox?: boolean;
};

// Every piece of Wistia's own chrome. `controls-visible-on-load` alone only
// hides them until the first hover or click, so a genuinely chromeless embed
// has to switch each one off by name. `playPauseNotifier` is on the list for
// the same reason the controls are: it draws Wistia's own play and pause
// symbols over the video, which survives the control bar being gone.
// `playbackRateControl` and `qualityControl` are not, because both live inside
// the settings menu this already switches off.
const CHROME_OPTIONS: readonly WistiaPlayerAttribute[] = [
  'playPauseControl',
  'playBarControl',
  'volumeControl',
  'settingsControl',
  'fullscreenControl',
  'bigPlayButton',
  'playPauseNotifier'
];

export type WistiaAttachmentDeps = {
  readonly emit: EmitProviderState;
  readonly options: WistiaEmbedOptions;
  // The host's capabilities snapshot, for the state published on ready.
  readonly getCapabilities: () => PlayerCapabilities;
  readonly playback: Pick<WistiaPlayback, 'adopt' | 'handlers'>;
  readonly presentation: Pick<WistiaPresentation, 'handlers'>;
  // Drops the host's provider-state subscribers on destroy.
  readonly clearStateListeners: () => void;
};

// The attachment seam: the adapter's binding to its embed — the element and
// its option attributes, the player-bundle load, the `api-ready` handshake that hands
// over the handle, every seam's event wiring, teardown, and the retry that
// replaces one player with the next. Owns the attached/destroyed/started
// flags, the element and its handle, the measured media shape, and the start
// generation that makes a superseded player's events inert.
export type WistiaAttachment = {
  readonly attach: () => void;
  readonly load: () => Promise<void>;
  readonly destroy: () => void;
  readonly retry: () => Promise<CommandResult>;
  readonly subscribeDimensions: (
    listener: (dimensions: MediaDimensions | undefined) => void
  ) => () => void;
  // The handle while it will accept a command: undefined before `api-ready`,
  // and again after teardown or destroy.
  readonly getPlayer: () => WistiaPlayerApi | undefined;
  readonly isStale: IsStalePlayer;
};

export const createWistiaAttachment = (
  mount: WistiaMountElement,
  source: WistiaSource,
  {
    emit,
    options,
    getCapabilities,
    playback,
    presentation,
    clearStateListeners
  }: WistiaAttachmentDeps
): WistiaAttachment => {
  const dimensionListeners = new Set<
    (dimensions: MediaDimensions | undefined) => void
  >();
  let attached = false;
  let destroyed = false;
  let started = false;
  let generation = 0;
  let activeElement: WistiaPlayerElement | undefined;
  let activeApi: WistiaPlayerApi | undefined;
  let activeDimensions: MediaDimensions | undefined;
  let activeHandle: Promise<WistiaPlayerApi | undefined> | undefined;
  let releaseHandle: (() => void) | undefined;
  let unbindEvents: (() => void) | undefined;
  // Wistia's answer to whether this media is a live stream, and the last live
  // state published from it. Both are per-source and reset in `teardown`, so
  // the value one player left behind cannot suppress its replacement's first
  // report.
  let liveMedia = false;
  let liveState: PlayerLiveState = null;
  // The paused recompute below, while it is armed.
  let liveTimer: ReturnType<typeof setInterval> | undefined;

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
    dimensionListeners.forEach((listener) =>
      notifySafely(listener, dimensions)
    );
  };

  const clearDimensions = (): void => {
    if (activeDimensions === undefined) return;
    emitDimensions();
  };

  // Recomputes liveness and answers the patch fragment carrying it, or an empty
  // one when the value is the one already published. Recomputed rather than
  // fixed at load: the at-edge half moves with the playhead. Wistia exposes no
  // seekable window, so the seekable set is empty and the duration carries the
  // live edge; a duration that does not read as a finite number leaves the edge
  // unknown rather than feeding NaN through, which `deriveLiveState` reports as
  // at the edge. `atEdgeThreshold` is omitted so the shared tolerance applies.
  const liveFragment = (api: WistiaPlayerApi): ProviderStatePatch => {
    const duration = api.duration();
    const next = deriveLiveState({
      isLiveHint: liveMedia,
      duration,
      seekable: [],
      currentTime: api.time(),
      ...(Number.isFinite(duration) ? { liveEdge: duration } : {})
    });
    if (liveStateEqual(next, liveState)) return {};
    liveState = next;
    return { live: next };
  };

  const stopLiveEdgePoll = (): void => {
    if (liveTimer === undefined) return;
    clearInterval(liveTimer);
    liveTimer = undefined;
  };

  // Armed only where it can change something: the media has to be live, which
  // `liveState` answers — it is null until `liveFragment` has said otherwise,
  // and for a VOD it stays null — and paused, because `time-update` already
  // recomputes a playing one. `liveFragment`'s own equality guard is what keeps
  // a tick that finds the same value silent.
  const startLiveEdgePoll = (api: WistiaPlayerApi): void => {
    if (liveTimer !== undefined || liveState === null) return;
    liveTimer = setInterval(() => {
      const live = liveFragment(api);
      if ('live' in live) emit(live);
    }, LIVE_EDGE_POLL_MS);
  };

  const isStale = (
    thisGeneration: number,
    element?: WistiaPlayerElement
  ): boolean =>
    destroyed ||
    thisGeneration !== generation ||
    (element !== undefined && element !== activeElement);

  const buildElement = (thisGeneration: number): WistiaPlayerElement => {
    const element = mount.ownerDocument.createElement(
      WISTIA_PLAYER_TAG
    ) as WistiaPlayerElement;
    const setOption = (option: WistiaPlayerAttribute, value: string): void =>
      element.setAttribute(attributeName(option), value);

    setOption('mediaId', source.mediaId);
    setOption('doNotTrack', options.dnt === false ? 'false' : 'true');
    setOption(
      'controlsVisibleOnLoad',
      options.controls === true ? 'true' : 'false'
    );
    if (options.controls !== true) {
      CHROME_OPTIONS.forEach((option) => setOption(option, 'false'));
    }
    if (options.loop === true) setOption('endVideoBehavior', 'loop');
    if (mount.muted) setOption('muted', 'true');

    // A load hint and nothing more. `Attributes` declares `currentTime` — and
    // no `time` — but whether a fresh element treats it as a load offset is
    // not documented, so the playback seam's `api.time()` seek at ready stays
    // the authority. Writing it costs nothing and spares the viewer a visible
    // jump on the players that do honour it. The duration is not known yet,
    // which is why the boundary is resolved against `null` here and again
    // against the real duration at ready. There is no end counterpart to
    // write: Aurora has none, so the end boundary is adapter-enforced.
    const start = createTimeBoundary(options).start(null);
    if (start > 0) setOption('currentTime', String(start));

    // These four are presentation-only and each has no Wistia-side default to
    // preserve, so an omitted option sets no attribute at all rather than a
    // computed 'false' or empty string. A `playerColor` or `poster` that fails
    // its check is dropped onto that same path, and now also reported as a
    // notice (#235).
    //
    // `poster` is checked BEFORE `playerColor`, and that order used to be
    // load-bearing: the controller holds one `configuration` notice per attach
    // and filled it with `??=`, so the first notice emitted here was the only
    // one that ever reached `PlayerState.error` — and it is dropped with the
    // provider, so the second was never reported later either. Checking the
    // cosmetic colour first therefore suppressed this security-relevant refusal
    // every time, not sometimes (#332). The slot is now ranked by the severity
    // each notice carries, so the poster's refusal takes it from the colour's
    // whichever check runs first (#368). The order stays as it is because
    // neither attribute depends on the other and reading them worst-first still
    // matches what an operator most needs to hear.
    //
    // This check applies the shared allowlist (`isPermittedSourceUrl`,
    // `@playdeck/core`) rather than restating a rule of its own. That allowlist
    // is the library's rule — the same one source detection and every other
    // consumer-supplied URL prop apply (#219, #236): it permits `http:`,
    // `https:` and the scheme-less forms and refuses `data:` and
    // `javascript:`; `blob:` is refused here too, since it is permitted only
    // for a `video` source and no `type` is passed for a poster. The value
    // this code writes is byte-identical to the caller's own string, never a
    // reparsed one: nothing in this path constructs a `URL` and reads back
    // its `.href`, so what gets validated above is exactly what lands on
    // the attribute. The one exception is `resolveNetworkPath`'s
    // protocol-relative substitution, the same normalisation source
    // detection performs for a source URL (#219). This says nothing about
    // how a later consumer of the attribute — a browser or Wistia's own SDK
    // — resolves that string as a URL; that resolution is a property of the
    // shared allowlist's own design (#219), not of this path.
    if (options.poster !== undefined) {
      if (isPermittedSourceUrl(options.poster, undefined)) {
        setOption('poster', resolveNetworkPath(options.poster));
      } else {
        emit({ error: posterConfigurationNotice });
      }
    }
    if (options.playerColor !== undefined) {
      if (isHexColor(options.playerColor)) {
        setOption('playerColor', options.playerColor);
      } else {
        emit({ error: playerColorConfigurationNotice });
      }
    }
    if (options.swatch !== undefined) {
      setOption('swatch', options.swatch ? 'true' : 'false');
    }
    if (options.transparentLetterbox !== undefined) {
      setOption(
        'transparentLetterbox',
        options.transparentLetterbox ? 'true' : 'false'
      );
    }

    // The handshake is armed before the element joins the document: a player
    // whose media data is already cached can reach `api-ready` inside the
    // append, and this is the only listener that cannot be added later.
    let settle: (api: WistiaPlayerApi | undefined) => void = () => undefined;
    activeHandle = new Promise<WistiaPlayerApi | undefined>((resolve) => {
      settle = resolve;
    });
    const onApiReady = (): void => settle(readApiHandle(element));
    element.addEventListener(API_READY_EVENT, onApiReady, { once: true });

    // Armed here rather than in `wireEvents` for the same reason: the element
    // dispatches its media data inside the fetch that precedes the embed init
    // (`WistiaPlayer.tsx:2628`, then `:2643`, whose `api-ready` lands at
    // `:2946`), so by the time the handle exists the only dispatch has already
    // happened. It carries the same staleness guard the wired events get, so a
    // superseded player's parting media data cannot flip the live flag.
    const onLoadedMediaData = (event: Event): void => {
      if (isStale(thisGeneration, element)) return;
      liveMedia = isLiveMediaData((event as CustomEvent<unknown>).detail);
    };
    element.addEventListener(LOADED_MEDIA_DATA_EVENT, onLoadedMediaData);

    releaseHandle = () => {
      element.removeEventListener(API_READY_EVENT, onApiReady);
      element.removeEventListener(LOADED_MEDIA_DATA_EVENT, onLoadedMediaData);
      // Settles rather than rejects, so a load interrupted by destroy unwinds
      // through the same stale check as every other superseded start.
      settle(undefined);
    };

    activeElement = element;
    mount.appendChild(element);
    return element;
  };

  const teardown = (): void => {
    // First, and unconditionally: this is the one thing here that would go on
    // running by itself, and it holds the handle the lines below are about to
    // discard. Both callers have already moved the generation on, so a tick
    // that had already been scheduled would publish for a player on its way out.
    stopLiveEdgePoll();
    const element = activeElement;
    const api = activeApi;
    const release = releaseHandle;
    const unbind = unbindEvents;
    activeHandle = undefined;
    // Discarded before `remove()` runs, and the generation has already moved
    // on by the time either caller gets here — so the listeners still attached
    // until `unbind` below read Wistia's parting reports as stale rather than
    // publishing state for a player that is on its way out.
    activeElement = undefined;
    activeApi = undefined;
    releaseHandle = undefined;
    unbindEvents = undefined;
    // Liveness describes the media this player was showing, so it goes with it.
    // Holding it would suppress the replacement's first report.
    liveMedia = false;
    liveState = null;
    release?.();
    // A replacement may take a while to answer, or never answer, and until it
    // does a leftover ratio describes a video that is no longer there.
    clearDimensions();
    if (api) {
      try {
        api.remove();
      } catch {
        // Teardown must not escape the provider boundary.
      }
    }
    unbind?.();
    element?.remove();
  };

  const wireEvents = (
    element: WistiaPlayerElement,
    api: WistiaPlayerApi,
    thisGeneration: number
  ): void => {
    const bound: Array<() => void> = [];
    const on = (name: string, handler: (detail?: unknown) => void): void => {
      const listener = (event: Event): void => {
        if (isStale(thisGeneration, element)) return;
        handler((event as CustomEvent<unknown>).detail);
      };
      element.addEventListener(name, listener);
      bound.push(() => element.removeEventListener(name, listener));
    };

    const { handlers } = playback;
    // The paused recompute is handed over to `time-update` and taken back from
    // it here, so exactly one of the two is measuring the edge at any moment.
    on('play', (detail) => {
      stopLiveEdgePoll();
      handlers.onPlay(detail);
    });
    on('pause', (detail) => {
      handlers.onPause(detail);
      startLiveEdgePoll(api);
    });
    on('ended', (detail) => handlers.onEnded(api, detail));
    // The at-edge half of `live` is measured against the playhead, so it is
    // recomputed on every time report rather than fixed at load. The reading is
    // taken before the boundary handler runs: that handler can seek the player
    // back inside the `[startTime, endTime]` window, and the distance to the
    // live edge belongs to what Wistia reported, not to the correction.
    on('time-update', () => {
      const live = liveFragment(api);
      handlers.onTimeUpdate(api);
      if ('live' in live) emit(live);
    });
    // `seeking` is deliberately not bound, though the element does fire it.
    // Measured against the live player (`e2e/wistia-smoke.spec.ts`): one
    // unpaired `seeking` arrives during the initial load, and every seek after
    // that dispatches `seeked` about a millisecond BEFORE its `seeking`. Wiring
    // the pair as a round trip therefore leaves `seeking` pinned true for the
    // rest of the session. `seeked` alone reports the settled playhead, which
    // is the half of the pair Wistia's ordering makes trustworthy.
    on('seeked', (detail) => handlers.onSeeked(api, detail));
    on('volume-change', handlers.onVolumeChange);
    on('mute-change', handlers.onMuteChange);
    on('rate-change', handlers.onRateChange);
    on('loaded-metadata', () => {
      handlers.onLoadedMetadata(api);
      emitDimensions(api.videoWidth(), api.videoHeight());
    });
    on('enter-fullscreen', presentation.handlers.onEnterFullscreen);
    on('cancel-fullscreen', presentation.handlers.onCancelFullscreen);

    unbindEvents = () => bound.forEach((remove) => remove());
  };

  const start = async (thisGeneration: number): Promise<CommandResult> => {
    try {
      const element = buildElement(thisGeneration);
      const handle = activeHandle;
      await loadWistiaPlayer();
      // Teardown settles the handshake with nothing rather than leaving it
      // pending, so one check after it covers both awaits above. The deadline
      // covers the third way out: the element never answering at all.
      const api = await withDeadline(
        Promise.resolve(handle),
        API_READY_TIMEOUT_MS,
        () =>
          new Error(
            'The Wistia player did not become ready. Its media data or player engine could not be loaded.'
          )
      );
      if (isStale(thisGeneration, element)) return { ok: true };
      if (!api) {
        throw new Error(
          'The Wistia player reported ready without an API handle.'
        );
      }
      activeApi = api;
      wireEvents(element, api, thisGeneration);
      emitDimensions(api.videoWidth(), api.videoHeight());
      const duration = api.duration();
      const playbackPatch = playback.adopt(api, {
        duration: Number.isFinite(duration) && duration > 0 ? duration : null,
        muted: api.isMuted(),
        volume: api.volume(),
        playbackRate: api.playbackRate() ?? 1
      });
      emit(
        {
          lifecycle: 'ready',
          activation: 'ready',
          playback: toPlaybackState(api.state()),
          buffering: false,
          seeking: false,
          // The handle is the only command surface this adapter has, and it
          // does not exist before `api-ready` — so this is the first moment a
          // command lands rather than being dropped (#69).
          commandsReady: true,
          ...playbackPatch,
          // Folded into the ready patch rather than published after it: the
          // media data that answers it arrived before the handshake, so the
          // host learns liveness at the same moment as everything else.
          ...liveFragment(api),
          capabilities: getCapabilities()
        },
        providerEvent('ready', undefined)
      );
      // After the patch, so the fragment above is what seeds the value the
      // interval compares against. A player is paused at ready — `beforeplay`
      // for a media that has never run — and one that autoplays hands straight
      // back to `time-update` on its `play`.
      startLiveEdgePoll(api);
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

  return {
    // Nothing is built here, and nothing joins the document. Appending a
    // `<wistia-player>` upgrades it the moment `customElements` knows the tag —
    // which is true as soon as any other Wistia player on the page has loaded
    // the bundle — and an upgraded element fetches its media data straight
    // away. Under `loading="interaction"` that would be a network request the
    // host has not permitted yet, so the element is built in `load()` instead.
    attach: () => {
      if (attached || destroyed) return;
      attached = true;
    },
    load: async () => {
      if (destroyed || started) return;
      started = true;
      await start(generation);
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      ++generation;
      teardown();
      clearStateListeners();
      dimensionListeners.clear();
    },
    retry: async () => {
      if (destroyed) return { ok: false, reason: 'not-ready' };
      const thisGeneration = ++generation;
      teardown();
      started = true;
      return start(thisGeneration);
    },
    subscribeDimensions: (listener) => {
      dimensionListeners.add(listener);
      return () => dimensionListeners.delete(listener);
    },
    getPlayer: () => (destroyed ? undefined : activeApi),
    isStale: (player) => destroyed || player !== activeApi
  };
};
