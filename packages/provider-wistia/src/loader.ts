// Wistia's player bundle is fetched from Wistia's own origin at runtime, and
// `@wistia/wistia-player` is not a dependency of this package. It never was a
// runtime one in substance — the npm package is a shell that fetches its
// engine, embed configuration and media data from the same CDN anyway — but it
// declares `dotenv-webpack` among its own `dependencies`, which declares a
// non-optional `webpack` peer, so every consumer that auto-installs peers took
// webpack and its whole tree for a bundle that was going to be fetched over the
// network regardless. The YouTube provider's loader has always worked this way.
//
// The consequence is this file: every type this adapter reads off Wistia's
// declarations is restated below rather than imported. The shapes are this
// package's own published surface now, so they are named and documented as
// such, and they are only what this adapter actually drives.

// Wistia's own state vocabulary, distinct from core's `PlaybackState`:
// `beforeplay` has no counterpart there and folds into `paused`. Restated from
// `PlayerState` in `@wistia/wistia-player@0.7.12`.
export type WistiaPlayerState = 'beforeplay' | 'ended' | 'paused' | 'playing';

// The members of the handle this adapter drives, restated from Wistia's
// `PublicApi` at 0.7.12. That interface declares about ninety members over a
// transitive graph — `Impl`, `Mux`, `Popover`, plugin and control registries,
// `EmbedOptions` — none of which this adapter touches; naming the fifteen it
// does drive is what lets a test double stand in for the handle without
// carrying Wistia's whole declaration set into this package's types.
//
// Signatures are copied rather than simplified, overloads included: `time` and
// `volume` answer a number when read and the handle when written, and
// `playbackRate` really can answer `undefined`. A member Wistia renames or
// re-signs is now a silent divergence rather than a compile error, so this
// block is a manual re-check against the vendor's declarations when the CDN
// bundle moves on.
export type WistiaPlayerApi = {
  play: () => WistiaPlayerApi;
  pause: () => WistiaPlayerApi;
  mute: () => WistiaPlayerApi;
  unmute: () => void;
  playbackRate: (newRate?: number) => number | undefined;
  duration: () => number;
  state: () => WistiaPlayerState;
  isMuted: () => boolean;
  requestFullscreen: () => void;
  cancelFullscreen: () => void;
  videoWidth: () => number;
  videoHeight: () => number;
  remove: (opts?: object) => void;
  time(): number;
  time(newTime: number, options?: { lazy: boolean }): WistiaPlayerApi;
  volume(): number;
  volume(newVolume: number): WistiaPlayerApi;
};

// The one field of Wistia's `MediaData` this adapter reads. Deliberately not
// the whole declaration: `MediaData` has fifty-odd optional fields, and the
// only question this adapter asks of it is whether the media is a live stream.
// Not exported — `WistiaLoadedMediaDataDetail` below is the published way in,
// and widening this is what publishing it would invite.
type WistiaMediaData = {
  mediaType?: 'ab-test' | 'Audio' | 'LiveStream' | 'Video';
};

// The payloads of the three declared events this adapter reads, restated from
// Wistia's `events.d.ts` at 0.7.12. Naming the detail separately is what lets a
// handler cite Wistia's own field names instead of matching a string nobody
// checks. Mutable fields, as Wistia declares them: a restatement that added
// `readonly` would be a narrowing rather than a copy.
export type WistiaApiReadyDetail = { mediaId: string };
export type WistiaMuteChangeDetail = { isMuted: boolean };
// Carries the media data the element fetched, which is where Wistia answers
// whether the media is a live stream.
export type WistiaLoadedMediaDataDetail = { mediaData: WistiaMediaData };

export const WISTIA_PLAYER_TAG = 'wistia-player';

// The event the element fires once its handle is in place. Named
// `API_READY_EVENT` in the SDK's `utilities/eventConstants`, restated here
// because this package imports nothing from Wistia.
export const API_READY_EVENT = 'api-ready';

// Every embed-option name the element accepts, restated from `keyof Attributes`
// in `@wistia/wistia-player@0.7.12` — the names only, not their value types,
// which would drag in `Gradient` and `AllowedQualities` for no reader here.
// Deriving the union rather than writing kebab-case strings by hand is what
// makes `attachment.ts`'s `attributeName` conversion a checked one.
//
// This list is now a manual re-check against Wistia's declarations: nothing in
// this repo compares it against the vendor's, because the vendor is no longer
// installed. A name Wistia adds is a name this package will refuse to set until
// someone adds it here.
//
// `mediaId` and `swatch` are added by hand because `Attributes` omits both.
// `mediaId` is the element's own required attribute, declared on the
// `WistiaPlayer` class instead. `swatch` is declared there too as a real
// property with a getter and a setter (`WistiaPlayer.d.ts:877-888`) and listed
// in the element's own JSX attribute list (`:1157`) — marked "Internal use
// only", which is not the same as absent, so this widens the type rather than
// casting around it.
export type WistiaPlayerAttribute =
  | 'aspect'
  | 'aspectRatio'
  | 'autoplay'
  | 'bigPlayButton'
  | 'bigPlayButtonBorderRadius'
  | 'contrastIcons'
  | 'controlBarBorderRadius'
  | 'controlsVisibleOnLoad'
  | 'copyLinkAndThumbnail'
  | 'currentTime'
  | 'doNotTrack'
  | 'email'
  | 'endVideoBehavior'
  | 'fitStrategy'
  | 'floatingControlBar'
  | 'fullscreenControl'
  | 'mediaId'
  | 'muted'
  | 'opaqueControls'
  | 'playBarControl'
  | 'playPauseControl'
  | 'playPauseNotifier'
  | 'playbackRate'
  | 'playbackRateControl'
  | 'playerBorderRadius'
  | 'playerColor'
  | 'playerColorGradient'
  | 'playlistLinks'
  | 'playlistLoop'
  | 'popoverContent'
  | 'poster'
  | 'preload'
  | 'qualityControl'
  | 'qualityMax'
  | 'qualityMin'
  | 'resumable'
  | 'rotateToFullscreen'
  | 'roundedPlayer'
  | 'seo'
  | 'settingsControl'
  | 'silentAutoplay'
  | 'statsUrl'
  | 'swatch'
  | 'transparentLetterbox'
  | 'videoQuality'
  | 'volume'
  | 'volumeControl';

// The element the adapter mounts. Typed structurally rather than as Wistia's
// `WistiaPlayer` class: that class is declared but never exported as a value,
// and the three handle properties below live on `WistiaContainerHTMLElement`,
// which `WistiaPlayer` does not extend.
export type WistiaPlayerElement = HTMLElement & {
  // `'removed'` is the sentinel Wistia leaves behind after `remove()`, so a
  // handle has to be tested for it rather than only for null.
  readonly api?: WistiaPlayerApi | 'removed' | null;
  readonly wistiaApi?: WistiaPlayerApi | 'removed' | null;
  readonly deprecatedApiDoNotUse?: WistiaPlayerApi | 'removed' | null;
};

// 0.7.12's `<wistia-player>` implements only `deprecatedApiDoNotUse`; `api`
// and `wistiaApi` are declared on `WistiaContainerHTMLElement` and carry the
// handle for Wistia's older, non-custom-element containers. The deprecated
// name is read last so that a release which promotes one of the other two
// takes over without a change here.
export const readApiHandle = (
  element: WistiaPlayerElement
): WistiaPlayerApi | undefined => {
  const handle =
    element.api ?? element.wistiaApi ?? element.deprecatedApiDoNotUse;
  return handle && handle !== 'removed' ? handle : undefined;
};

// Wistia's own published entry point for the Aurora element
// (https://docs.wistia.com/docs/player-quick-start). Not
// `assets/external/E-v1.js`, which is the legacy pre-Aurora embed shim and a
// different thing entirely.
const scriptSrc = 'https://fast.wistia.com/player.js';

/**
 * Puts the player bundle in the document and answers the element it used, so
 * the loader can bind its own `error` listener to it. Replace it to serve the
 * bundle from your own origin; the loader still owns the deadline, the shared
 * promise and the registration it waits for.
 */
export type WistiaScriptInjector = (src: string) => HTMLScriptElement;

// How long the bundle is given to register `<wistia-player>` before the load is
// reported as failed. The script's own `error` event is not enough to lean on:
// a response that arrives 200 OK but is not the bundle — a captive portal, an
// inspecting proxy, a region block serving HTML, a truncated body — fires
// `load`, so no `error` ever comes and nothing else would settle the promise. A
// script element this loader adopted rather than created can be past both
// events already.
//
// Fifteen seconds, the same number as `attachment.ts`'s `API_READY_TIMEOUT_MS`
// and for the same reason: a "that is never coming" backstop, not a performance
// budget. It is a separate constant rather than that one reused, because the
// two cover different waits — this one a script fetch, that one the element's
// media-data handshake — and they run in sequence, so a player behind a
// black-holed network can take up to thirty seconds to report an error. That is
// the cost of neither wait cutting a slow connection short.
export const SCRIPT_LOAD_TIMEOUT_MS = 15_000;

let sharedLoad: Promise<CustomElementConstructor> | undefined;

const injectWistiaScript: WistiaScriptInjector = (src) => {
  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  (document.head ?? document.documentElement).appendChild(script);
  return script;
};

/**
 * Resolves the `<wistia-player>` registration, loading Wistia's bundle from
 * `fast.wistia.com` once per document if nothing has registered the element
 * yet. Resolves a registration rather than a class the bundle exports: the
 * bundle runs `customElements.define` for its side effect and exports nothing
 * this adapter could construct.
 */
export const loadWistiaPlayer = (
  injectScript: WistiaScriptInjector = injectWistiaScript
): Promise<CustomElementConstructor> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(
      new Error('The Wistia player requires a browser document.')
    );
  }
  if (sharedLoad) return sharedLoad;

  // A consumer who registered the element by other means — their own script
  // tag, a bundled copy of the package — is answered from the registry, so
  // nothing is fetched and nothing is registered twice.
  const registered = customElements.get(WISTIA_PLAYER_TAG);
  if (registered) {
    sharedLoad = Promise.resolve(registered);
    return sharedLoad;
  }

  const load = new Promise<CustomElementConstructor>((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(
      `script[src="${scriptSrc}"]`
    );
    const createdScript = script === null;
    // Whether this loader watched the script's own `load` event fire. A
    // response that arrived and registered nothing is a different failure from
    // one that never arrived, and the reported error is the only place that
    // distinction is visible. Not a rejection on its own: the bundle is free to
    // register the element after its own async work, and rejecting at `load`
    // would report a working player as broken. It stays false for a script
    // adopted after it had already loaded — unknowable from the element — which
    // is why the other message below does not claim the script never loaded.
    let loaded = false;

    const onScriptLoad = (): void => {
      loaded = true;
    };

    const onScriptError = (): void => {
      fail(new Error('The Wistia player script failed to load.'));
    };

    const deadline = setTimeout(() => {
      fail(
        new Error(
          loaded
            ? 'The Wistia player bundle loaded without registering <wistia-player>.'
            : `The Wistia player script did not register <wistia-player> within ${SCRIPT_LOAD_TIMEOUT_MS} ms.`
        )
      );
    }, SCRIPT_LOAD_TIMEOUT_MS);

    const cleanup = (): void => {
      clearTimeout(deadline);
      script?.removeEventListener('load', onScriptLoad);
      script?.removeEventListener('error', onScriptError);
    };

    const fail = (error: Error): void => {
      // Whether this attempt is still the one the memo points at. A superseded
      // attempt — one a reset, or a failure before it, has already replaced —
      // owns neither the memo nor the document any more, and its deadline can
      // still expire long after the attempt that took over adopted the very
      // script element it injected.
      const current = sharedLoad === load;
      if (current) sharedLoad = undefined;
      cleanup();
      // Removed only when this attempt both created the element and still owns
      // it: a node another consumer put in the document is not this loader's to
      // take out, and neither is one a later attempt is now waiting on. So a
      // deadline that expires on an adopted element leaves it in place, and the
      // next attempt adopts it again under its own deadline — which is what
      // keeps that path a bounded rejection rather than a hang.
      if (current && createdScript) script?.remove();
      reject(error);
    };

    void customElements
      .whenDefined(WISTIA_PLAYER_TAG)
      .then((registration: CustomElementConstructor) => {
        cleanup();
        resolve(registration);
      });

    if (!script) script = injectScript(scriptSrc);
    // Attached after the injection: browsers only ever fire script events
    // asynchronously, and this keeps deterministic DOM test doubles from
    // settling the load synchronously while it is being wired up.
    script.addEventListener('load', onScriptLoad);
    script.addEventListener('error', onScriptError);
  });
  sharedLoad = load;
  return load;
};

export const resetWistiaPlayerLoader = (): void => {
  sharedLoad = undefined;
};
