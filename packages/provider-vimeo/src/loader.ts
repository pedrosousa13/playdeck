export type VimeoSdkTextTrack = {
  readonly language: string;
  readonly kind: string;
  readonly label: string;
  readonly mode: 'showing' | 'hidden' | 'disabled';
};

// `auto` arrives as a member of this list, with `active` marking the entry the
// player is honouring — so under auto the specific rungs are all `false` and
// the one actually rendering is not identified. Measured on the live SDK (#82).
export type VimeoSdkQuality = {
  readonly id: string;
  readonly label: string;
  readonly active: boolean;
};

// What the SDK reports for a chapter: where it begins, what it is called, and
// its 1-based position. No end time — the library derives that (`Chapter` in
// `@reely/core`), which is why `index` is not published: the position in the
// derived collection already carries it.
export type VimeoSdkChapter = {
  readonly startTime: number;
  readonly title: string;
  readonly index: number;
};

export type VimeoSdkEventListener = (data?: unknown) => void;

export type VimeoSdkPlayer = {
  ready: () => Promise<void>;
  destroy: () => Promise<void>;
  on: (event: string, listener: VimeoSdkEventListener) => void;
  off: (event: string, listener?: VimeoSdkEventListener) => void;
  play: () => Promise<unknown>;
  pause: () => Promise<unknown>;
  setCurrentTime: (seconds: number) => Promise<unknown>;
  getCurrentTime: () => Promise<number>;
  getDuration: () => Promise<number>;
  // Real, possibly disjoint ranges as [start, end] pairs. The `progress` event
  // only reports the edge of the range holding the playhead (#91).
  getBuffered: () => Promise<ReadonlyArray<readonly number[]>>;
  getMuted: () => Promise<boolean>;
  setMuted: (muted: boolean) => Promise<unknown>;
  getVolume: () => Promise<number>;
  setVolume: (volume: number) => Promise<unknown>;
  getPlaybackRate: () => Promise<number>;
  setPlaybackRate: (rate: number) => Promise<unknown>;
  // The media's own pixel size, not the iframe's. Before playback begins the
  // SDK reports the highest rendition available, which is the same shape the
  // ratio describes. The `resize` event carries the pair again on every change
  // as `{ videoWidth, videoHeight }`.
  getVideoWidth: () => Promise<number>;
  getVideoHeight: () => Promise<number>;
  getQualities: () => Promise<ReadonlyArray<VimeoSdkQuality>>;
  // An id the player never offered never settles at all — the SDK neither
  // resolves nor rejects it (#82), so every call has to be resolved against the
  // published list first.
  setQuality: (id: string) => Promise<unknown>;
  // The whole chapter list, read once the player is ready. The companion
  // `chapterchange` event is what keeps it current — there is no polling.
  getChapters: () => Promise<ReadonlyArray<VimeoSdkChapter>>;
  getTextTracks: () => Promise<ReadonlyArray<VimeoSdkTextTrack>>;
  // `showing: false` makes Vimeo fire `cuechange` without drawing the cues
  // with its own in-iframe renderer, which is what lets Reely own caption
  // rendering. Verified against the real chromeless embed: with `false` the
  // paused frame is pixel-identical to having no track enabled.
  enableTextTrack: (
    language: string,
    kind?: string,
    showing?: boolean
  ) => Promise<unknown>;
  disableTextTrack: () => Promise<unknown>;
  requestFullscreen: () => Promise<unknown>;
  exitFullscreen: () => Promise<unknown>;
  getFullscreen: () => Promise<boolean>;
  requestPictureInPicture: () => Promise<unknown>;
  exitPictureInPicture: () => Promise<unknown>;
  getPictureInPicture: () => Promise<boolean>;
};

export type VimeoSdkConstructor = new (
  element: HTMLIFrameElement
) => VimeoSdkPlayer;

export type VimeoSdkModule = { readonly default: VimeoSdkConstructor };

const importVimeoSdk = (): Promise<VimeoSdkModule> =>
  import('@vimeo/player') as unknown as Promise<VimeoSdkModule>;

// The SDK's own opt-out for the SEO-metadata handshake, and the only place
// library source names it — so an SDK bump has one line to re-check here, plus
// the tests that spell it out (`test/loader.test.ts`,
// `e2e/vimeo-seo-metadata.spec.ts`). At module evaluation the SDK runs
// `initAppendVideoMetadata()`, which returns early when this global is already
// truthy and otherwise installs a `window` `message` listener that answers a
// recognised embed's `ready` event by sending it `window.location.href`
// (`@vimeo/player@2.30.4/dist/player.js:993-1016`, reached from `:2827`).
// Undocumented vendor surface, version-bound to the pinned `2.30.4` — re-check
// both the name and the module-scope call site on an SDK version bump.
const SEO_METADATA_GUARD = 'VimeoSeoMetadataAppended';

// Suppression is one-way: this switches the guard on, and never off. A page
// that already carries the global — set by consumer code, or by another copy
// of the SDK — keeps whatever value it has, in either direction, so Reely
// cannot undo a suppression somebody else asked for or force one they refused.
const suppressSeoMetadata = (): void => {
  const globals = window as unknown as Record<string, unknown>;
  if (SEO_METADATA_GUARD in globals) return;
  globals[SEO_METADATA_GUARD] = true;
};

export type VimeoSdkLoadOptions = {
  /**
   * Set the SDK's SEO-metadata guard before the module is imported, so its
   * `window.location.href` handshake never installs. Only the load that
   * actually imports the SDK can do this — see `loadVimeoSdk`.
   */
  readonly suppressSeoMetadata?: boolean;
};

let cachedSdk: Promise<VimeoSdkConstructor> | undefined;

/**
 * The SDK, imported once per page and cached. `suppressSeoMetadata` is honoured
 * by the call that performs the import and by no other: the SDK reads its guard
 * at module evaluation, so a later call arriving at the cached module cannot
 * change what that evaluation already decided.
 */
export const loadVimeoSdk = (
  importSdk: () => Promise<VimeoSdkModule> = importVimeoSdk,
  options: VimeoSdkLoadOptions = {}
): Promise<VimeoSdkConstructor> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(
      new Error('The Vimeo SDK requires a browser document.')
    );
  }
  if (cachedSdk) return cachedSdk;
  // Before the import, deliberately: the guard is read while the module
  // evaluates, and `importSdk` is what evaluates it.
  if (options.suppressSeoMetadata === true) suppressSeoMetadata();
  const pending: Promise<VimeoSdkConstructor> = Promise.resolve()
    .then(importSdk)
    .then(
      (module) => module.default,
      (cause: unknown) => {
        if (cachedSdk === pending) cachedSdk = undefined;
        throw cause;
      }
    );
  cachedSdk = pending;
  return pending;
};

export const resetVimeoSdkLoader = (): void => {
  cachedSdk = undefined;
};
