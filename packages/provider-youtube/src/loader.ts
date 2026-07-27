export type YouTubePlayerEventHandlers = {
  onReady?: (event: { target: YouTubePlayer }) => void;
  onStateChange?: (event: { data: number; target: YouTubePlayer }) => void;
  onError?: (event: { data: number; target: YouTubePlayer }) => void;
  onPlaybackRateChange?: (event: {
    data: number;
    target: YouTubePlayer;
  }) => void;
  // Fires when a player module -- including the unofficial "captions"
  // module -- becomes available or changes availability.
  onApiChange?: (event: { target: YouTubePlayer }) => void;
};

export type YouTubePlayerOptions = {
  readonly host?: string;
  readonly videoId?: string;
  readonly width?: string;
  readonly height?: string;
  readonly playerVars?: Readonly<Record<string, string | number>>;
  readonly events?: YouTubePlayerEventHandlers;
};

export type YouTubePlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  setVolume: (volume: number) => void;
  getVolume: () => number;
  getDuration: () => number;
  getCurrentTime: () => number;
  // Despite the name, this is the end of the buffered range holding the
  // playhead, over duration — not how much of the video is loaded (#91).
  getVideoLoadedFraction: () => number;
  getPlaybackRate: () => number;
  setPlaybackRate: (rate: number) => void;
  getPlayerState: () => number;
  getIframe: () => HTMLIFrameElement;
  destroy: () => void;
  // Unofficial "module" API used by the captions/cc module. Undocumented by
  // Google; behavior below follows community-observed conventions and is
  // unverified against a real player (see issue #11).
  loadModule: (module: string) => void;
  unloadModule?: (module: string) => void;
  getOptions?: (module: string) => string[];
  getOption: (module: string, option: string) => unknown;
  setOption: (module: string, option: string, value: unknown) => void;
};

export type YouTubePlayerConstructor = new (
  element: HTMLElement,
  options: YouTubePlayerOptions
) => YouTubePlayer;

export type YouTubeIframeApi = {
  readonly Player: YouTubePlayerConstructor;
  readonly PlayerState?: Readonly<Record<string, number>>;
};

type YouTubeWindow = Window & {
  YT?: YouTubeIframeApi;
  onYouTubeIframeAPIReady?: () => void;
};

const scriptSrc = 'https://www.youtube.com/iframe_api';

let sharedLoad: Promise<YouTubeIframeApi> | undefined;

const apiFromWindow = (target: YouTubeWindow): YouTubeIframeApi | undefined =>
  typeof target.YT?.Player === 'function' ? target.YT : undefined;

export const loadYouTubeIframeApi = (): Promise<YouTubeIframeApi> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(
      new Error('The YouTube iframe API requires a browser environment.')
    );
  }
  if (sharedLoad) return sharedLoad;

  const target = window as YouTubeWindow;
  const readyApi = apiFromWindow(target);
  if (readyApi) {
    sharedLoad = Promise.resolve(readyApi);
    return sharedLoad;
  }

  const load = new Promise<YouTubeIframeApi>((resolve, reject) => {
    const previousCallback = target.onYouTubeIframeAPIReady;
    let script = document.querySelector<HTMLScriptElement>(
      `script[src="${scriptSrc}"]`
    );
    const createdScript = script === null;

    const onScriptError = (): void => {
      fail(new Error('The YouTube iframe API script failed to load.'));
    };

    const cleanup = (): void => {
      script?.removeEventListener('error', onScriptError);
      if (target.onYouTubeIframeAPIReady === onApiReady) {
        target.onYouTubeIframeAPIReady = previousCallback;
      }
    };

    const fail = (error: Error): void => {
      if (sharedLoad === load) sharedLoad = undefined;
      cleanup();
      if (createdScript) script?.remove();
      reject(error);
    };

    const onApiReady = (): void => {
      previousCallback?.();
      const api = apiFromWindow(target);
      if (!api) {
        fail(new Error('The YouTube iframe API script did not initialize.'));
        return;
      }
      cleanup();
      resolve(api);
    };

    target.onYouTubeIframeAPIReady = onApiReady;
    if (!script) {
      script = document.createElement('script');
      script.src = scriptSrc;
      script.async = true;
      (document.head ?? document.documentElement).appendChild(script);
    }
    // Attached after the append: browsers only ever fire script errors
    // asynchronously, and this keeps deterministic DOM test doubles from
    // failing the load synchronously while it is being wired up.
    script.addEventListener('error', onScriptError);
  });
  sharedLoad = load;
  return load;
};
