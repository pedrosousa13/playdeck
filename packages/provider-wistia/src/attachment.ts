import {
  createTimeBoundary,
  type CommandResult,
  type MediaDimensions,
  type PlayerCapabilities,
  type PlayerError,
  type WistiaSource
} from '@reely/core';
import {
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
// keep in step. `WistiaPlayerAttribute` is derived from the SDK's own
// `Attributes`, which is what makes a renamed option fail to compile here.
const attributeName = (option: WistiaPlayerAttribute): string =>
  option.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

// `playerColor` and `poster` are documented as a hex colour and an image URL
// but reach the provider as bare strings, so each is checked here — the one
// place an option becomes an attribute, which covers every consumer of the
// package rather than only those coming through `Player.Root`. A value that
// fails its check sets no attribute, the same element state as omitting the
// option, and the drop is silent: one bad presentation option must not fail
// playback.
//
// Every hex form CSS Color 4 spells: three, four, six, or eight digits, with
// or without the hash — the four- and eight-digit forms carry an alpha channel.
// The hash is optional because Wistia's own examples write `playerColor` bare,
// and the attribute is handed to the player as given.
const isHexColor = (value: string): boolean =>
  /^#?(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);

// `https:` only. `http:` would downgrade the page, `data:` carries the image
// itself into an attribute Reely writes, and a relative or malformed value
// does not parse without a base — none of which this provider passes on.
//
// The prefix test is what the parse alone does not give: `new URL()` resolves
// `https:poster.png` to `https://poster.png/` and trims surrounding
// whitespace, so a scheme-prefixed relative or padded value parses as `https:`
// while the string written to the attribute is neither. Requiring the value
// itself to start `https://` keeps the two in step, and the caller's own
// string still reaches the element unaltered.
const isHttpsUrl = (value: string): boolean => {
  if (!/^https:\/\//i.test(value)) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
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
// its option attributes, the SDK load, the `api-ready` handshake that hands
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

  const isStale = (
    thisGeneration: number,
    element?: WistiaPlayerElement
  ): boolean =>
    destroyed ||
    thisGeneration !== generation ||
    (element !== undefined && element !== activeElement);

  const buildElement = (): WistiaPlayerElement => {
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
    // its check is dropped onto that same path.
    if (options.playerColor !== undefined && isHexColor(options.playerColor)) {
      setOption('playerColor', options.playerColor);
    }
    if (options.swatch !== undefined) {
      setOption('swatch', options.swatch ? 'true' : 'false');
    }
    if (options.poster !== undefined && isHttpsUrl(options.poster)) {
      setOption('poster', options.poster);
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
    releaseHandle = () => {
      element.removeEventListener(API_READY_EVENT, onApiReady);
      // Settles rather than rejects, so a load interrupted by destroy unwinds
      // through the same stale check as every other superseded start.
      settle(undefined);
    };

    activeElement = element;
    mount.appendChild(element);
    return element;
  };

  const teardown = (): void => {
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
    on('play', handlers.onPlay);
    on('pause', handlers.onPause);
    on('ended', (detail) => handlers.onEnded(api, detail));
    on('time-update', () => handlers.onTimeUpdate(api));
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
      const element = buildElement();
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
          capabilities: getCapabilities()
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
