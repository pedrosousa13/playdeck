import type {
  CommandResult,
  MediaDimensions,
  PlayerCapabilities,
  PlayerError,
  WistiaSource
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

// Wistia names its embed options in camelCase and reads them off kebab-case
// attributes, so the two spellings are one conversion rather than a table to
// keep in step. `WistiaPlayerAttribute` is derived from the SDK's own
// `Attributes`, which is what makes a renamed option fail to compile here.
const attributeName = (option: WistiaPlayerAttribute): string =>
  option.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

// The embed options this adapter expresses, read when the element is built
// rather than snapshotted at construction.
export type WistiaEmbedOptions = {
  readonly controls?: boolean;
  readonly dnt?: boolean;
  readonly loop?: boolean;
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
    on('seeking', (detail) => handlers.onSeeking(api, detail));
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
      const element = activeElement ?? buildElement();
      const handle = activeHandle;
      await loadWistiaPlayer();
      // Teardown settles the handshake with nothing rather than leaving it
      // pending, so one check after it covers both awaits above.
      const api = await handle;
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
    attach: () => {
      if (attached || destroyed) return;
      attached = true;
      buildElement();
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
