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

// How long the API is given to call `onYouTubeIframeAPIReady` before the load
// is reported as failed. The script's own `error` event is not enough to lean
// on: a response that arrives 200 OK but is not the API — a captive portal, an
// inspecting proxy, a region block serving HTML — fires `load`, so the callback
// never runs and nothing else would ever settle the promise. A script element
// this loader adopted rather than created can be past both events already.
//
// Fifteen seconds, the same number as Wistia's `API_READY_TIMEOUT_MS` and for
// the same reason: a "that is never coming" backstop, not a performance budget.
// A second, differently tuned deadline for the same class of wait would only
// make the two providers drift.
export const API_READY_TIMEOUT_MS = 15_000;

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

    const deadline = setTimeout(() => {
      fail(
        new Error(
          `The YouTube iframe API script loaded but did not initialize within ${API_READY_TIMEOUT_MS} ms.`
        )
      );
    }, API_READY_TIMEOUT_MS);

    const cleanup = (): void => {
      clearTimeout(deadline);
      script?.removeEventListener('error', onScriptError);
      if (target.onYouTubeIframeAPIReady === onApiReady) {
        target.onYouTubeIframeAPIReady = previousCallback;
      }
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

export const resetYouTubeIframeApiLoader = (): void => {
  sharedLoad = undefined;
};
