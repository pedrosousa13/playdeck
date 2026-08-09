// The player bundle is fetched from Wistia's own origin at runtime, and
// `@wistia/wistia-player` is not a dependency of this package (#225): that
// package is a shell around the same CDN, and it declares build tooling among
// its runtime dependencies, so installing it dragged webpack into consumer
// installs for a bundle fetched over the network regardless.
//
// So every type this adapter reads off Wistia's declarations is restated below
// rather than imported, and each is this package's own published surface now.
// All of them were taken from 0.7.12; keeping them current is a manual
// re-check, because the vendor package is no longer installed to compare
// against.

// Wistia's own state vocabulary, distinct from core's `PlaybackState`:
// `beforeplay` has no counterpart there and folds into `paused`.
export type WistiaPlayerState = 'beforeplay' | 'ended' | 'paused' | 'playing';

// The fifteen members of the handle this adapter drives, out of the ninety-odd
// Wistia's `PublicApi` declares over a transitive graph this package has no
// other use for. Signatures are copied rather than simplified, overloads
// included: `time` and `volume` answer a number when read and the handle when
// written, and `playbackRate` really can answer `undefined`.
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

// The one field of Wistia's fifty-odd-field `MediaData` this adapter reads: the
// only question it asks is whether the media is a live stream. Unexported, so
// `WistiaLoadedMediaDataDetail` stays the single published way in.
type WistiaMediaData = {
  mediaType?: 'ab-test' | 'Audio' | 'LiveStream' | 'Video';
};

// The payloads of the three declared events this adapter reads. Naming each
// detail lets a handler cite Wistia's own field names instead of matching a
// string nobody checks. Fields are mutable, as Wistia declares them: adding
// `readonly` would be a narrowing rather than a copy.
export type WistiaApiReadyDetail = { mediaId: string };
export type WistiaMuteChangeDetail = { isMuted: boolean };
// Carries the media data the element fetched, which is where Wistia answers
// whether the media is a live stream.
export type WistiaLoadedMediaDataDetail = { mediaData: WistiaMediaData };

export const WISTIA_PLAYER_TAG = 'wistia-player';

// The event the element fires once its handle is in place. Named
// `API_READY_EVENT` in Aurora's `utilities/eventConstants`, restated here
// because this package imports nothing from Wistia.
export const API_READY_EVENT = 'api-ready';

// Every embed-option name the element accepts, restated from `keyof Attributes`
// — the names only, not their value types, which would drag in `Gradient` and
// `AllowedQualities` for no reader here. A union rather than hand-written
// kebab-case strings, so `attachment.ts`'s `attributeName` conversion has
// something to check against. A name Wistia adds is one this package will
// refuse to set until it is added here too.
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

// How long the bundle is given to register `<wistia-player>`. The script's own
// `error` event cannot carry this alone: a response that is not the bundle — a
// captive portal, an inspecting proxy, a truncated body — fires `load` instead,
// and an adopted element can be past both events already.
//
// Separate from `attachment.ts`'s `API_READY_TIMEOUT_MS` because it covers a
// different wait, and the two run in sequence: a black-holed network takes up
// to thirty seconds to report an error. Same fifteen seconds, same reason — a
// "that is never coming" backstop, not a performance budget.
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

  let injectionFailed = false;
  const load = new Promise<CustomElementConstructor>((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(
      `script[src="${scriptSrc}"]`
    );
    const createdScript = script === null;
    // Whether this loader watched `load` fire, which only sharpens the deadline
    // message. Not a rejection on its own: the bundle may register the element
    // after its own async work. False for a script adopted once it had already
    // loaded — unknowable from the element — so the other message below does
    // not claim the script never loaded.
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

    // Ownership is decided the same way, and for the same reasons, as
    // `packages/provider-youtube/src/loader.ts`'s `fail`: a superseded attempt
    // owns neither the memo nor the element, so it clears and detaches nothing,
    // and an adopted element is never this loader's to remove. See that file
    // for the full reasoning rather than a copy of it that can drift.
    const fail = (error: Error): void => {
      const current = sharedLoad === load;
      if (current) sharedLoad = undefined;
      cleanup();
      if (current && createdScript) script?.remove();
      reject(error);
    };

    void customElements
      .whenDefined(WISTIA_PLAYER_TAG)
      .then((registration: CustomElementConstructor) => {
        cleanup();
        resolve(registration);
      });

    try {
      if (!script) script = injectScript(scriptSrc);
      // Attached after the injection: browsers only ever fire script events
      // asynchronously, and this keeps deterministic DOM test doubles from
      // settling the load synchronously while it is being wired up.
      script.addEventListener('load', onScriptLoad);
      script.addEventListener('error', onScriptError);
    } catch (cause) {
      // `fail` cannot serve this one: it decides ownership by comparing against
      // a memo that is assigned only once this executor returns, so it would
      // leave the deadline armed and let the rejected promise be memoised
      // anyway. Nothing has awaited yet either, so there is no ownership to
      // establish — the attempt is unambiguously alone.
      injectionFailed = true;
      cleanup();
      reject(cause as Error);
    }
  });
  // Not memoised when the injector threw. A `WistiaScriptInjector` is consumer
  // code, and remembering its rejection would make every caller for the next
  // fifteen seconds re-await a load that has already failed.
  if (!injectionFailed) sharedLoad = load;
  return load;
};

export const resetWistiaPlayerLoader = (): void => {
  sharedLoad = undefined;
};
