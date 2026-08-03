import type {
  Attributes,
  PlayerState,
  PublicApi
} from '@wistia/wistia-player/dist/types/types/player-api-types.js';
import type {
  API_READY_EVENT_TYPE,
  MUTE_CHANGE_EVENT_TYPE
} from '@wistia/wistia-player/dist/types/types/events.js';

// Wistia's package has no `exports` map and points `types` at the element
// class alone, so the handle, attribute and event declarations are reachable
// only by their path inside `dist/types`. They are imported once, here, and
// everything else in this package reads them through this module.
//
// Only what this adapter drives is imported, and only what it drives is
// re-exported. Wistia also declares replace, colour, impl-creation and
// media-data types; publishing those would put a `playerConfig` surface this
// package does not wire into its public API ahead of the issue that wires it.
export type { PublicApi };

// The payloads of the two declared events this adapter reads. Naming the
// detail separately is what lets a handler cite Wistia's own field names
// instead of matching a string nobody checks.
export type WistiaApiReadyDetail = API_READY_EVENT_TYPE['detail'];
export type WistiaMuteChangeDetail = MUTE_CHANGE_EVENT_TYPE['detail'];

export const WISTIA_PLAYER_TAG = 'wistia-player';

// The event the element fires once its handle is in place. Named
// `API_READY_EVENT` in the SDK's `utilities/eventConstants`, which ships no
// runtime entry point this package can import, so the string is restated.
export const API_READY_EVENT = 'api-ready';

// Wistia's own state vocabulary, distinct from core's `PlaybackState`:
// `beforeplay` has no counterpart there and folds into `paused`.
export type WistiaPlayerState = PlayerState;

// The members of the handle this adapter drives. `PublicApi` declares about
// ninety; naming the fifteen used here is what lets a test double stand in for
// the handle without restating Wistia's whole surface, while still failing to
// compile if Wistia renames one of them.
export type WistiaPlayerApi = Pick<
  PublicApi,
  | 'play'
  | 'pause'
  | 'time'
  | 'mute'
  | 'unmute'
  | 'volume'
  | 'playbackRate'
  | 'duration'
  | 'state'
  | 'isMuted'
  | 'requestFullscreen'
  | 'cancelFullscreen'
  | 'videoWidth'
  | 'videoHeight'
  | 'remove'
>;

// The embed options this adapter expresses as attributes. `media-id` is the
// element's own required attribute, declared on the `WistiaPlayer` class
// rather than in `Attributes`, so it is named separately. Every other name
// this adapter sets has to be a key Wistia declares, which is the point of
// deriving the union rather than writing the kebab-case strings by hand.
export type WistiaPlayerAttribute = keyof Attributes | 'mediaId';

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

const importWistiaPlayer = (): Promise<unknown> =>
  import('@wistia/wistia-player');

let cachedRegistration: Promise<CustomElementConstructor> | undefined;

// Resolves the `<wistia-player>` registration rather than a class the module
// exports: importing Wistia's bundle runs `customElements.define` for its side
// effect and exports nothing this adapter can construct. Awaiting
// `whenDefined` after the import is what makes a consumer who already loaded
// the element elsewhere resolve immediately instead of registering it twice.
export const loadWistiaPlayer = (
  importSdk: () => Promise<unknown> = importWistiaPlayer
): Promise<CustomElementConstructor> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(
      new Error('The Wistia player requires a browser document.')
    );
  }
  if (cachedRegistration) return cachedRegistration;
  const pending: Promise<CustomElementConstructor> = Promise.resolve()
    .then(importSdk)
    .then(async () => {
      await customElements.whenDefined(WISTIA_PLAYER_TAG);
      const registration = customElements.get(WISTIA_PLAYER_TAG);
      if (!registration) {
        throw new Error(
          'The Wistia bundle loaded without registering <wistia-player>.'
        );
      }
      return registration;
    })
    .catch((cause: unknown) => {
      if (cachedRegistration === pending) cachedRegistration = undefined;
      throw cause;
    });
  cachedRegistration = pending;
  return pending;
};

export const resetWistiaPlayerLoader = (): void => {
  cachedRegistration = undefined;
};
