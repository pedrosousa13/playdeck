import {
  isPermittedSourceUrl,
  resolveNetworkPath
} from './source-detection.js';
import type { PlaybackState } from './types.js';

import type { PlayerController } from './player-controller.js';

// Media Session ownership arbitration.
//
// The Media Session API exposes exactly ONE `navigator.mediaSession` per
// document. When a page hosts several Playdeck roots they must share that single
// surface, so a coordinator arbitrates it: the most-recently-*playing* root
// owns the metadata and action handlers. A root releases ownership when another
// root starts playing, on teardown, or on unmount — and it NEVER clears
// handlers it does not currently own.
//
// This does NOT prevent simultaneous playback: two roots can play at once, and
// only the lock-screen/hardware-key surface follows the most recent one.
// Enforcing a single active player (exclusive playback groups) is a separate,
// deferred concern.

export type MediaSessionArtwork = {
  readonly src: string;
  readonly sizes?: string;
  readonly type?: string;
};

// Explicit metadata supplied by the consumer. Playdeck never scrapes this from the
// media source; a caller passes exactly what the lock screen should show.
export type MediaMetadataInput = {
  readonly title?: string;
  readonly artist?: string;
  readonly album?: string;
  readonly artwork?: ReadonlyArray<MediaSessionArtwork>;
};

export type MediaSessionPositionState = {
  readonly duration?: number;
  readonly position?: number;
  readonly playbackRate?: number;
};

type MediaSessionActionDetails = {
  readonly seekTime?: number;
  readonly seekOffset?: number;
};

type MediaSessionActionHandler =
  ((details: MediaSessionActionDetails) => void) | null;

// The subset of `navigator.mediaSession` the coordinator touches. Modeled as a
// structural type so it can be driven by a real MediaSession or a fake in tests.
//
// `action` is the exact set the coordinator registers, not `string`: the DOM's
// `setActionHandler` only accepts its own `MediaSessionAction` union, so a
// `string` parameter made this type unsatisfiable by the very object it models
// — every caller needed `as unknown as MediaSessionLike`. Narrowing it makes a
// real `navigator.mediaSession` assignable, and a fake still only has to
// implement these five. Asserted by test/media-session.test.ts.
export type MediaSessionLike = {
  metadata: unknown;
  playbackState?: string;
  setActionHandler: (
    action: 'play' | 'pause' | 'seekto' | 'seekforward' | 'seekbackward',
    handler: MediaSessionActionHandler
  ) => void;
  setPositionState?: (state?: MediaSessionPositionState) => void;
};

export type MediaSessionActions = {
  readonly play: () => void;
  readonly pause: () => void;
  readonly seekTo: (time: number) => void;
  readonly seekBy: (offset: number) => void;
};

export type MediaSessionRootConfig = {
  readonly actions: MediaSessionActions;
  readonly metadata?: MediaMetadataInput | null;
};

export type MediaSessionRoot = {
  // Claim ownership and mark the shared surface as playing.
  readonly notifyPlaying: () => void;
  // Mark the shared surface as paused, keeping ownership.
  readonly notifyPaused: () => void;
  // Replace this root's metadata; writes through only while it owns the surface.
  readonly setMetadata: (metadata: MediaMetadataInput | null) => void;
  // Report scrubber position; writes through only while it owns the surface.
  readonly setPositionState: (state: MediaSessionPositionState | null) => void;
  // Release ownership (teardown / unmount / source change). Clears the shared
  // surface only if this root currently owns it.
  readonly release: () => void;
};

export type MediaSessionCoordinator = {
  readonly register: (config: MediaSessionRootConfig) => MediaSessionRoot;
  // Current owner, exposed for inspection and tests.
  readonly owner: () => MediaSessionRoot | null;
};

export type MediaSessionBinding = {
  readonly setMetadata: (metadata: MediaMetadataInput | null) => void;
  readonly release: () => void;
};

const DEFAULT_SEEK_OFFSET = 10;

const MEDIA_SESSION_ACTIONS = [
  'play',
  'pause',
  'seekto',
  'seekforward',
  'seekbackward'
] as const;

const globalMediaMetadata = ():
  (new (init: MediaMetadataInput) => unknown) | undefined => {
  const scope = globalThis as {
    MediaMetadata?: new (init: MediaMetadataInput) => unknown;
  };
  return typeof scope.MediaMetadata === 'function'
    ? scope.MediaMetadata
    : undefined;
};

// An artwork entry whose `src` the shared allowlist refuses is dropped
// rather than carried into either `MediaMetadata` path below: one bad entry
// must not cost the caller its other artwork sizes, and this is the one URL
// prop of the four #236 covers that never had a provider-side check to hide
// behind (#219, #236). `type: undefined` refuses `blob:` here, the same as
// every other consumer-supplied prop the allowlist governs. A surviving
// entry's `src` is written through `resolveNetworkPath`, so a
// protocol-relative artwork URL resolves the same way a source URL does; its
// `sizes` and `type` are copied verbatim.
//
// `art.src` is typed `string`, but `MediaSessionArtwork` binds only a caller
// that is type-checked -- a cast, a spread or untyped CMS data can hand this
// a non-string or an absent `src`, and `isPermittedSourceUrl` calls
// `.match` on its argument, which throws on anything else. The `typeof`
// guard below treats that case as a rejection like any other, consistent
// with every other consumer-supplied URL prop the allowlist governs:
// rejection never throws, and the entry is simply omitted (#236).
const permittedArtwork = (
  artwork: MediaMetadataInput['artwork']
): MediaSessionArtwork[] =>
  artwork
    ? artwork.flatMap((art) =>
        typeof art.src === 'string' && isPermittedSourceUrl(art.src, undefined)
          ? [{ ...art, src: resolveNetworkPath(art.src) }]
          : []
      )
    : [];

const toMediaMetadata = (metadata: MediaMetadataInput): unknown => {
  const Ctor = globalMediaMetadata();
  const init = {
    ...metadata,
    artwork: permittedArtwork(metadata.artwork)
  };
  if (!Ctor) return init;
  try {
    return new Ctor(init);
  } catch {
    return init;
  }
};

// Internal on purpose: a second coordinator over the same MediaSession would
// hand out roots that do not know about each other's ownership, which is the
// exact thing the one-per-document rule exists to prevent.
// `getMediaSessionCoordinator` is how a caller gets one.
const createMediaSessionCoordinator = (
  session: MediaSessionLike
): MediaSessionCoordinator => {
  let owner: MediaSessionRoot | null = null;

  const applyMetadata = (metadata: MediaMetadataInput | null): void => {
    session.metadata = metadata ? toMediaMetadata(metadata) : null;
  };

  const clearSurface = (): void => {
    for (const action of MEDIA_SESSION_ACTIONS) {
      session.setActionHandler(action, null);
    }
    session.metadata = null;
    session.playbackState = 'none';
    if (typeof session.setPositionState === 'function') {
      session.setPositionState(undefined);
    }
  };

  const wireHandlers = (actions: MediaSessionActions): void => {
    session.setActionHandler('play', () => actions.play());
    session.setActionHandler('pause', () => actions.pause());
    session.setActionHandler('seekto', (details) => {
      if (typeof details.seekTime === 'number')
        actions.seekTo(details.seekTime);
    });
    session.setActionHandler('seekforward', (details) =>
      actions.seekBy(details.seekOffset ?? DEFAULT_SEEK_OFFSET)
    );
    session.setActionHandler('seekbackward', (details) =>
      actions.seekBy(-(details.seekOffset ?? DEFAULT_SEEK_OFFSET))
    );
  };

  const register = (config: MediaSessionRootConfig): MediaSessionRoot => {
    let metadata = config.metadata ?? null;
    let released = false;
    const owns = (): boolean => owner === root && !released;

    const root: MediaSessionRoot = {
      notifyPlaying: () => {
        if (released) return;
        owner = root;
        wireHandlers(config.actions);
        applyMetadata(metadata);
        session.playbackState = 'playing';
      },
      notifyPaused: () => {
        if (!owns()) return;
        session.playbackState = 'paused';
      },
      setMetadata: (next) => {
        metadata = next;
        if (owns()) applyMetadata(next);
      },
      setPositionState: (state) => {
        if (!owns() || typeof session.setPositionState !== 'function') return;
        session.setPositionState(state ?? undefined);
      },
      release: () => {
        if (released) return;
        released = true;
        // Only clear the shared surface if this root is the current owner;
        // releasing a root that already lost ownership must not disturb the
        // new owner's handlers.
        if (owner === root) {
          clearSurface();
          owner = null;
        }
      }
    };
    return root;
  };

  return {
    register,
    owner: () => owner
  };
};

// One coordinator per document, keyed by the MediaSession object identity. This
// is what enforces the "single navigator.mediaSession per document" rule when
// several roots resolve the coordinator independently.
const coordinators = new WeakMap<MediaSessionLike, MediaSessionCoordinator>();

export const getMediaSessionCoordinator = (
  session: MediaSessionLike
): MediaSessionCoordinator => {
  const existing = coordinators.get(session);
  if (existing) return existing;
  const created = createMediaSessionCoordinator(session);
  coordinators.set(session, created);
  return created;
};

// Binds a controller's confirmed playback to a coordinator root: the root
// claims ownership when the controller starts playing, keeps ownership while
// paused, and routes lock-screen actions back to the controller. React calls
// `release()` from its effect cleanup, so a source change or unmount tears the
// binding down (and clears the surface only when this root still owns it).
export const bindMediaSession = (
  controller: PlayerController,
  coordinator: MediaSessionCoordinator,
  options: { readonly metadata?: MediaMetadataInput | null } = {}
): MediaSessionBinding => {
  const root = coordinator.register({
    metadata: options.metadata ?? null,
    actions: {
      play: () => void controller.play(),
      pause: () => void controller.pause(),
      seekTo: (time) => void controller.seekTo(time),
      seekBy: (offset) => void controller.seekBy(offset)
    }
  });

  let lastPlayback: PlaybackState | undefined;
  let positionCleared = false;

  const unsubscribe = controller.subscribe((state) => {
    if (state.playback !== lastPlayback) {
      lastPlayback = state.playback;
      if (state.playback === 'playing') root.notifyPlaying();
      else root.notifyPaused();
    }
    if (state.duration !== null && Number.isFinite(state.duration)) {
      // Clamped, not passed through: the Media Session spec makes a position
      // outside [0, duration] a TypeError, and WebKit settles `currentTime` a
      // fraction PAST `duration` once a clip ends (measured 1.000131 against a
      // duration of 1). Reporting the raw pair threw on ordinary end of
      // playback (#95).
      root.setPositionState({
        duration: state.duration,
        position: Math.min(Math.max(state.currentTime, 0), state.duration),
        playbackRate: state.playbackRate
      });
      positionCleared = false;
    } else if (!positionCleared) {
      // Live/unknown duration: clear the stale finite position once (not every
      // tick) so the lock screen doesn't keep the last VOD position pinned.
      root.setPositionState(null);
      positionCleared = true;
    }
  });

  return {
    setMetadata: (metadata) => root.setMetadata(metadata),
    release: () => {
      unsubscribe();
      root.release();
    }
  };
};
