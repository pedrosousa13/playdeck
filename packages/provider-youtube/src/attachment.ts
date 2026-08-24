import type { CommandResult, PlayerCapabilities } from '@playdeck/core';
import {
  loadFailure,
  preReadyCapabilities,
  providerEvent,
  type EmitProviderState
} from './adapter-values.js';
import type { YouTubeBoundary } from './boundary.js';
import type { YouTubeIframeApi, YouTubePlayer } from './loader.js';
import type { YouTubePlayback } from './playback.js';
import type { YouTubePresentation } from './presentation.js';
import type { YouTubeTextTracks } from './text-tracks.js';
import type { YouTubeTimeUpdates } from './time-updates.js';

// The player vars the adapter sets. They reach the embed as query parameters
// on the iframe's own url rather than as constructor options: the iframe API
// reads neither `videoId` nor `playerVars` when it is handed a frame that
// already exists.
type YouTubePlayerVars = Readonly<Record<string, string | number>>;

// How long the player is given to answer the constructor with `onReady` before
// the attach is reported as failed (#327).
//
// Distinct from two deadlines that already exist and do not cover this.
// `API_READY_TIMEOUT_MS` (`loader.ts`) bounds the iframe API *script*
// initialising, and `PLAYBACK_CONFIRMATION_TIMEOUT_MS` (`playback.ts`) bounds a
// play command. Neither fires when the script loaded, the constructor ran, and
// the frame then never posted back — which is the ordinary shape of a blocked
// embed: a page CSP without `frame-src www.youtube-nocookie.com`, an extension
// or DNS blocking the frame, or a captive portal. Without this the adapter sits
// in `loading` for ever with `error: null`, so neither `ErrorDisplay` nor
// `ActivationButton` engages -- both gate on `activation === 'error'` -- and
// every `whenReady()` call adds a promise that never settles.
//
// Fifteen seconds, matching Wistia's `API_READY_TIMEOUT_MS` and chosen the same
// way: a "that is never coming" backstop rather than a performance budget, so
// a slow connection is never reported as a failure.
export const PLAYER_READY_TIMEOUT_MS = 15_000;

// The url the pre-built iframe carries into the document. `host` is already one
// of the two allowlisted origins (`index.ts`'s `resolveHost`) and `videoId` has
// already passed `isYouTubeVideoId`, so neither can move this url off YouTube;
// both are still written through the URL API rather than concatenated into it.
const youTubeEmbedUrl = (
  host: string,
  videoId: string,
  playerVars: YouTubePlayerVars
): string => {
  const url = new URL('/embed/', host);
  url.pathname = `${url.pathname}${encodeURIComponent(videoId)}`;
  // The API drives this frame over postMessage, and the embed only listens for
  // that when its own url asks it to. The `<div>` path had the API write this
  // var itself; on this one it is ours to write, and the player never becomes
  // ready without it.
  url.searchParams.set('enablejsapi', '1');
  for (const [key, value] of Object.entries(playerVars)) {
    url.searchParams.set(key, String(value));
  }
  return url.href;
};

export type YouTubeAttachmentDeps = {
  readonly emit: EmitProviderState;
  // Unset and `false` both mean chromeless; see `YouTubeProviderOptions`'s own
  // doc comment for why this mirrors Vimeo's polarity.
  readonly controls: boolean | undefined;
  // Unset and `false` both mean play once; see `YouTubeProviderOptions`.
  readonly loop: boolean | undefined;
  readonly host: string;
  // The [startTime, endTime] window: it supplies the `start` player var and
  // positions the playhead once the player is ready.
  readonly boundary: Pick<
    YouTubeBoundary,
    'applyInitialPosition' | 'reset' | 'startPlayerVar'
  >;
  readonly loadIframeApi: () => Promise<YouTubeIframeApi>;
  // The host's ready capabilities snapshot, for the state published on ready.
  readonly getCapabilities: () => PlayerCapabilities;
  readonly playback: Pick<
    YouTubePlayback,
    'settlePendingPlays' | 'adoptVolume' | 'handlers'
  >;
  readonly presentation: Pick<YouTubePresentation, 'handlers'>;
  readonly textTracks: Pick<YouTubeTextTracks, 'discover' | 'reset'>;
  readonly timeUpdates: Pick<YouTubeTimeUpdates, 'adoptCurrentTime' | 'reset'>;
  // Drops the host's provider-state subscribers on destroy.
  readonly clearStateListeners: () => void;
};

// The attachment seam: the adapter's binding to its iframe player — attach,
// the iframe API load, player construction with every seam's event wiring,
// teardown, and the retry that replaces one player with the next. Owns the
// attached/destroyed/ready flags, the player and the iframe it was built on,
// and the start generation that makes a superseded player's events inert.
// Exposes the player guards every other seam depends on.
export type YouTubeAttachment = {
  readonly attach: () => void;
  readonly load: () => Promise<void>;
  readonly destroy: () => void;
  readonly retry: () => Promise<CommandResult>;
  readonly isDestroyed: () => boolean;
  // The player as soon as it is constructed, ready or not.
  readonly getPlayer: () => YouTubePlayer | undefined;
  // The player once it will accept a command: the iframe API drops calls made
  // before onReady (#69), so a command before then is not-ready, not lost.
  readonly getReadyPlayer: () => YouTubePlayer | undefined;
  // The player's iframe. `getIframe()` throws once the player is torn down,
  // which is not an error any caller can act on.
  readonly getIframe: () => HTMLIFrameElement | undefined;
};

export const createYouTubeAttachment = (
  mount: HTMLElement,
  videoId: string,
  {
    emit,
    controls,
    loop,
    host,
    boundary,
    loadIframeApi,
    getCapabilities,
    playback,
    presentation,
    textTracks,
    timeUpdates,
    clearStateListeners
  }: YouTubeAttachmentDeps
): YouTubeAttachment => {
  const ownerDocument = mount.ownerDocument;
  const { onFullscreenChange } = presentation.handlers;
  let attached = false;
  let destroyed = false;
  let loadRequested = false;
  let ready = false;
  let generation = 0;
  let player: YouTubePlayer | undefined;
  let playerTarget: HTMLIFrameElement | undefined;
  let readyDeadline: ReturnType<typeof setTimeout> | undefined;

  // Cleared the moment the player answers, so a normal attach leaves nothing
  // pending and a ready player can never be knocked into an error state by its
  // own backstop firing late.
  const clearReadyDeadline = (): void => {
    if (readyDeadline === undefined) return;
    clearTimeout(readyDeadline);
    readyDeadline = undefined;
  };

  const getIframe = (): HTMLIFrameElement | undefined => {
    try {
      return player?.getIframe() ?? undefined;
    } catch {
      return undefined;
    }
  };

  const emitReadyState = (): void => {
    const current = player;
    if (!current) return;
    const duration = current.getDuration();
    // No command has run yet, so these reads are the player's own state.
    const { muted, volume } = playback.adoptVolume(current);
    // The first moment the player will accept a seek, and the first moment its
    // duration is known — so it is where the start boundary is applied. The
    // `start` player var only saved loading from zero; it is whole-second, so
    // this seek is the authority. With no start boundary the player's own
    // position stands.
    const currentTime =
      boundary.applyInitialPosition(current) ??
      timeUpdates.adoptCurrentTime(current);
    emit(
      {
        lifecycle: 'ready',
        activation: 'ready',
        // The iframe API drops calls made before onReady, so this is the first
        // moment a command lands (#69).
        commandsReady: true,
        currentTime,
        // Whole-second, and knowingly so: the exact duration arrives later and
        // is republished by the PLAYING branch of `onPlayerStateChange`, whose
        // comment carries the measurement behind both publishes.
        duration: Number.isFinite(duration) && duration > 0 ? duration : null,
        muted,
        volume,
        playbackRate: current.getPlaybackRate(),
        capabilities: getCapabilities()
      },
      providerEvent('ready', undefined)
    );
  };

  const teardownPlayer = (): void => {
    clearReadyDeadline();
    playback.settlePendingPlays({ ok: false, reason: 'not-ready' });
    // A retry recreates the player, so cached caption state must not leak
    // into the new session's capabilities before its own onApiChange fires.
    // Neither must a buffer anchor: the new player has loaded nothing.
    timeUpdates.reset();
    // Nor a boundary latch: the replacement player has been positioned by
    // nothing, and any loop restart still deferred is for a player that is
    // about to stop existing.
    boundary.reset();
    ready = false;
    textTracks.reset();
    const current = player;
    player = undefined;
    if (current) {
      try {
        current.destroy();
      } catch {
        // Teardown must not escape the provider boundary.
      }
    }
    playerTarget?.remove();
    playerTarget = undefined;
  };

  const start = async (forGeneration: number): Promise<void> => {
    const api = await loadIframeApi();
    if (destroyed || forGeneration !== generation) return;
    // Google recommends declaring the embedding origin when the JS API is
    // active so the player can validate postMessage targets.
    const embedOrigin = ownerDocument.defaultView?.location?.origin;
    // No `sandbox` here, and that is a decision rather than an omission: the
    // iframe API's postMessage bridge is origin-pinned in both directions, so
    // it needs `allow-scripts allow-same-origin`, and a sandbox carrying both
    // is close to none (#321). The reasoning, and what would reopen it, are in
    // docs/third-party-requests.md, under "The YouTube sandbox bargain".
    const target = ownerDocument.createElement('iframe');
    target.src = youTubeEmbedUrl(host, videoId, {
      autoplay: 0,
      // Deliberately Vimeo's polarity (`provider-vimeo/src/attachment.ts:72`):
      // unset and `false` both mean chromeless.
      controls: controls === true ? 1 : 0,
      // `loop` alone is a documented no-op on a single-video embed: YouTube
      // loops a playlist, so the one video has to name itself as its own
      // single-entry playlist for the loop var to mean anything. The two
      // vars are set together or not at all.
      loop: loop === true ? 1 : 0,
      ...(loop === true ? { playlist: videoId } : {}),
      // A load hint, so the embed does not load from zero and seek away
      // visibly. No `end` counterpart: it is whole-second too, its
      // interaction with the loop + playlist pair above is undocumented, and
      // it is not known to publish the state change the adapter needs — so
      // the end boundary is enforced from the poll instead (#214).
      ...(boundary.startPlayerVar === undefined
        ? {}
        : { start: boundary.startPlayerVar }),
      playsinline: 1,
      rel: 0,
      ...(embedOrigin ? { origin: embedOrigin } : {})
    });
    // The `Referer` leaves with this frame's first request, so the policy has
    // to be here before the element is, which is why the frame is built here
    // rather than left to the API. Vimeo's embed already declares the same one
    // (`provider-vimeo/src/attachment.ts:272`).
    target.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    // The rest is the attribute set the iframe API writes onto the frame it
    // builds on the `<div>` path, restated verbatim so this frame is granted
    // neither more nor less than that one was. Narrowing the `allow` list is a
    // separate decision with its own capability consequences (#221).
    target.setAttribute(
      'allow',
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
    );
    target.setAttribute('allowfullscreen', '');
    // The API replaces this with the video's own title once the player is
    // ready, on this path as on the other one; until then it is the frame's
    // accessible name.
    target.setAttribute('title', 'YouTube video player');
    target.setAttribute('width', '100%');
    target.setAttribute('height', '100%');
    // The API's own frame carries `frameBorder="0"`; this is that, spelled the
    // way the Vimeo embed spells it (`provider-vimeo/src/attachment.ts:277`).
    target.style.border = '0';
    mount.appendChild(target);
    playerTarget = target;
    // Handed a frame that already exists, the API adopts it instead of building
    // one: it takes the embed's origin from this `src` and leaves the url's
    // query alone, so `host`, `videoId` and the player vars above are carried
    // by the url and are not repeated here. Only the events are the
    // constructor's to wire.
    // Armed after the constructor rather than before `loadIframeApi`: the
    // script load has its own deadline, and starting this one there would
    // charge a slow CDN against the player's budget.
    readyDeadline = setTimeout(() => {
      readyDeadline = undefined;
      if (destroyed || forGeneration !== generation || ready) return;
      emit({
        lifecycle: 'error',
        activation: 'error',
        error: {
          category: 'provider',
          fatal: false,
          // The embed can come back on a retry -- a CSP is deploy-time, but a
          // blocked frame is often an extension or a captive portal.
          recoverable: true,
          message:
            'The YouTube player did not become ready. Its embed may be blocked by the page CSP, an extension or the network.'
        }
      });
    }, PLAYER_READY_TIMEOUT_MS);

    player = new api.Player(target, {
      events: {
        onReady: () => {
          clearReadyDeadline();
          if (destroyed || forGeneration !== generation) return;
          ready = true;
          // The captions module's own discovery signal (onApiChange) is
          // undocumented and not guaranteed to fire on its own, so proactively
          // load it as a safety net; unverified against a real player (see
          // issue #11).
          if (typeof player?.loadModule === 'function') {
            try {
              player.loadModule('captions');
            } catch {
              // Best-effort; must not block emitting ready state.
            }
          }
          emitReadyState();
        },
        onStateChange: ({ data }) => {
          if (destroyed || forGeneration !== generation) return;
          playback.handlers.onPlayerStateChange(data);
        },
        onError: ({ data }) => {
          if (destroyed || forGeneration !== generation) return;
          playback.handlers.onPlayerError(data);
        },
        onPlaybackRateChange: ({ data }) => {
          if (destroyed || forGeneration !== generation) return;
          emit(
            { playbackRate: data },
            providerEvent('ratechange', { playbackRate: data })
          );
        },
        onApiChange: () => {
          if (destroyed || forGeneration !== generation) return;
          textTracks.discover();
        }
      }
    });
  };

  return {
    attach: () => {
      if (attached || destroyed) return;
      attached = true;
      ownerDocument.addEventListener('fullscreenchange', onFullscreenChange);
      emit({
        lifecycle: 'loading',
        activation: 'loading-provider',
        capabilities: preReadyCapabilities()
      });
    },
    load: async () => {
      if (destroyed || loadRequested) return;
      loadRequested = true;
      await start(generation);
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      generation += 1;
      teardownPlayer();
      if (attached) {
        ownerDocument.removeEventListener(
          'fullscreenchange',
          onFullscreenChange
        );
      }
      clearStateListeners();
    },
    retry: async () => {
      if (destroyed) return { ok: false, reason: 'not-ready' };
      const forGeneration = ++generation;
      teardownPlayer();
      loadRequested = true;
      try {
        await start(forGeneration);
        return { ok: true };
      } catch (cause) {
        if (destroyed || forGeneration !== generation) {
          return { ok: false, reason: 'not-ready' };
        }
        return loadFailure(cause);
      }
    },
    isDestroyed: () => destroyed,
    getPlayer: () => player,
    getReadyPlayer: () => (destroyed || !ready ? undefined : player),
    getIframe
  };
};
