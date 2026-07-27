export type VimeoSdkTextTrack = {
  readonly language: string;
  readonly kind: string;
  readonly label: string;
  readonly mode: 'showing' | 'hidden' | 'disabled';
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

let cachedSdk: Promise<VimeoSdkConstructor> | undefined;

export const loadVimeoSdk = (
  importSdk: () => Promise<VimeoSdkModule> = importVimeoSdk
): Promise<VimeoSdkConstructor> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(
      new Error('The Vimeo SDK requires a browser document.')
    );
  }
  if (cachedSdk) return cachedSdk;
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
