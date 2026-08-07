import type {
  Availability,
  PlayerCapabilities,
  ProviderAdapter,
  ProviderEvent,
  ProviderStateListener,
  WistiaSource
} from '@reely/core';
import { available, type WistiaMountElement } from './adapter-values.js';
import { createWistiaAttachment } from './attachment.js';
import { createWistiaBoundary } from './boundary.js';
import { createWistiaPlayback } from './playback.js';
import { createWistiaPresentation } from './presentation.js';

export type { WistiaMountElement } from './adapter-values.js';
export { API_READY_TIMEOUT_MS } from './attachment.js';
export { loadWistiaPlayer, resetWistiaPlayerLoader } from './loader.js';
// Every type the loader declares, with no gap: `dist/index.d.ts` is the only
// surface `package.json`'s `exports` map offers, so a type left out of this
// block is a type no consumer can import however the README describes it.
// `test/exports.contract.test.ts` is what keeps the two in step.
export type {
  PublicApi,
  WistiaApiReadyDetail,
  WistiaMuteChangeDetail,
  WistiaPlayerApi,
  WistiaPlayerAttribute,
  WistiaPlayerElement,
  WistiaPlayerState
} from './loader.js';

export type WistiaProviderOptions = {
  readonly controls?: boolean;
  readonly dnt?: boolean;
  /**
   * Stop playback at this offset and publish `ended` there, rather than at the
   * media's own end. Aurora has no end mechanism to hand this to, so the
   * adapter enforces it from Wistia's `time-update` reports — the same posture
   * the native provider takes. An end that is not finite, or not above the
   * sanitised `startTime`, is no end; one past the duration is clamped to it.
   * Documented like `loop` below: this is where the setting is implemented,
   * `Root` folds its own prop in, and `PlayerProviderOptions` omits the key so
   * the two cannot both be written (ADR-0004).
   */
  readonly endTime?: number;
  /**
   * Restart the video when it ends, by setting `endVideoBehavior`
   * (`attachment.ts:243`, `if (options.loop === true)`). This is where the
   * setting is implemented, not where a `Player.Root` consumer writes it:
   * `Root`'s `loop` prop is folded into this bag by
   * `packages/react/src/root.tsx`'s `resolvedProviderOptions`, and
   * `PlayerProviderOptions` omits the key so the two cannot both be written
   * (ADR-0004). SIDEPRO-210 made that so; before it, this key was the only
   * way to loop a Wistia embed. It remains reachable by calling
   * `createWistiaProvider` directly.
   */
  readonly loop?: boolean;
  readonly playerColor?: string;
  readonly swatch?: boolean;
  readonly poster?: string;
  /**
   * Begin playback at this offset. Written onto the element as the
   * `current-time` attribute for the load, and seeked to on the handle once
   * the player is ready — the attribute is a hint, the seek is the authority.
   * A start that is not finite, or not above zero, is no start. With `loop`,
   * the restart returns here rather than to zero. Same ADR-0004 posture as
   * `endTime` above.
   */
  readonly startTime?: number;
  readonly transparentLetterbox?: boolean;
};

type WistiaCommand =
  | 'play'
  | 'pause'
  | 'seekTo'
  | 'seekBy'
  | 'mute'
  | 'unmute'
  | 'setVolume'
  | 'setPlaybackRate'
  | 'requestFullscreen'
  | 'exitFullscreen'
  | 'retry';

export type WistiaProviderAdapter = ProviderAdapter &
  Required<Pick<ProviderAdapter, WistiaCommand>> & {
    readonly provider: 'wistia';
  };

// What this adapter does not drive at all, for either of two reasons. Aurora
// has a `videoQuality()` coarse setter and a captions API, but neither is wired
// here, so `selectQuality` and `selectTextTrack` report unavailable rather than
// staying forever "unknown". `pictureInPicture` and `airPlay` have no surface
// to wire at all: `PublicApi` declares no member for either.
const outOfScope: Availability = { status: 'unavailable', reason: 'provider' };

export const createWistiaProvider = (
  mount: WistiaMountElement,
  source: WistiaSource,
  options: WistiaProviderOptions = {}
): WistiaProviderAdapter => {
  const listeners = new Set<ProviderStateListener>();

  const emit = (
    patch: Parameters<ProviderStateListener>[0],
    event?: ProviderEvent
  ): void => listeners.forEach((listener) => listener(patch, event));

  // Resolved once, from the raw options, and consulted by the playback seam on
  // every time report, seek and restart.
  const boundary = createWistiaBoundary(options);

  const playback = createWistiaPlayback(mount, {
    emit,
    isStale: (player) => attachment.isStale(player),
    getPlayer: () => attachment.getPlayer(),
    getCapabilities: playerCapabilities,
    boundary
  });

  const presentation = createWistiaPresentation({
    emit,
    getPlayer: () => attachment.getPlayer()
  });

  // The capabilities this player has, folding in the one seam that decides
  // any of them. Recomputed on every publication: the two the playback seam
  // owns change with the device the player is on, not with the adapter.
  function playerCapabilities(): PlayerCapabilities {
    return {
      // `PublicApi.time(seconds)` seeks.
      seek: available,
      setVolume: playback.setVolumeAvailability(),
      setPlaybackRate: playback.setPlaybackRateAvailability(),
      selectQuality: outOfScope,
      selectTextTrack: outOfScope,
      // `PublicApi.requestFullscreen()` / `cancelFullscreen()`.
      fullscreen: available,
      pictureInPicture: outOfScope,
      airPlay: outOfScope,
      // Chromeless is a plain set of embed attributes, declared in Wistia's own
      // `Attributes` and gated by no account tier.
      customControls: available
    };
  }

  const attachment = createWistiaAttachment(mount, source, {
    emit,
    options,
    getCapabilities: playerCapabilities,
    playback,
    presentation,
    clearStateListeners: () => listeners.clear()
  });

  return {
    provider: 'wistia',
    attach: attachment.attach,
    load: attachment.load,
    destroy: attachment.destroy,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeDimensions: attachment.subscribeDimensions,
    play: playback.play,
    pause: playback.pause,
    seekTo: playback.seekTo,
    seekBy: playback.seekBy,
    mute: playback.mute,
    unmute: playback.unmute,
    setVolume: playback.setVolume,
    setPlaybackRate: playback.setPlaybackRate,
    requestFullscreen: presentation.requestFullscreen,
    exitFullscreen: presentation.exitFullscreen,
    retry: attachment.retry
  };
};
