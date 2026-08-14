import {
  isVimeoHash,
  isVimeoVideoId,
  type CommandResult,
  type PlayerCapabilities,
  type PlayerError,
  type ProviderAdapter,
  type ProviderEvent,
  type ProviderStateListener,
  type VimeoSource
} from '@reely/core';
import {
  available,
  providerEvent,
  type VimeoMountElement
} from './adapter-values.js';
import { createVimeoAttachment } from './attachment.js';
import { createVimeoBoundary } from './boundary.js';
import { createVimeoChromelessAvailability } from './chromeless-availability.js';
import { createVimeoPlayback } from './playback.js';
import { createVimeoPresentation } from './presentation.js';
import { createVimeoQualityLevels } from './quality-levels.js';
import { createVimeoTextTracks } from './text-tracks.js';

export type { VimeoMountElement } from './adapter-values.js';
export { loadVimeoSdk, resetVimeoSdkLoader } from './loader.js';
export type {
  VimeoSdkConstructor,
  VimeoSdkEventListener,
  VimeoSdkLoadOptions,
  VimeoSdkModule,
  VimeoSdkPlayer,
  VimeoSdkQuality,
  VimeoSdkTextTrack
} from './loader.js';

export type VimeoProviderOptions = {
  readonly controls?: boolean;
  readonly dnt?: boolean;
  /**
   * Restart the video when it ends. `Root`'s `loop` prop is folded into this
   * bag by `packages/react/src/root.tsx`'s `resolvedProviderOptions`, so
   * `PlayerProviderOptions` omits the key and this is not a second home for
   * the setting (ADR-0004).
   */
  readonly loop?: boolean;
  /**
   * Where playback begins, in seconds. Written to the embed url as a `#t=`
   * load hint and then seeked to once the player is ready, which is what
   * actually holds. A non-finite or non-positive value is no start.
   *
   * Like `loop`, `Root`'s `startTime` prop is folded into this bag by
   * `packages/react/src/root.tsx`, so `PlayerProviderOptions` omits the key
   * and this is not a second home for the setting (ADR-0004).
   */
  readonly startTime?: number;
  /**
   * Where playback ends, in seconds. Vimeo has no end mechanism of its own, so
   * this adapter enforces it: reaching the boundary publishes `ended`, or
   * restarts from `startTime` when `loop` is on. An end that is not finite, or
   * not above the sanitised start, is no end; one past the duration is clamped
   * to it.
   *
   * Folded in from `Root`'s `endTime` prop and omitted from
   * `PlayerProviderOptions` the same way `loop` and `startTime` are (ADR-0004).
   */
  readonly endTime?: number;
  readonly customControls?: boolean;
  /**
   * Stop the Vimeo SDK sending the embedding page's `window.location.href` —
   * path and query included — to the embed frame over `postMessage`. Off by
   * default, so the SDK behaves exactly as it always has unless this is set.
   *
   * **The effect is page-wide, not per-embed.** The SDK's own opt-out is a
   * `window` global, so switching this on silences that handshake for every
   * Vimeo embed on the page, including embeds Reely did not create.
   *
   * **It takes effect on the first Vimeo attach and holds for the life of the
   * page.** The SDK module is imported once and cached, and it reads the guard
   * while it evaluates, so an attach that finds the module already loaded
   * cannot change what the first one decided. Setting this on one player and
   * not another leaves the first attach in charge.
   *
   * A page that has already set the guard itself keeps its own value, in
   * either direction — Reely never overwrites it.
   */
  readonly suppressSeoMetadata?: boolean;
};

type VimeoCommand =
  | 'play'
  | 'pause'
  | 'seekTo'
  | 'seekBy'
  | 'mute'
  | 'unmute'
  | 'setVolume'
  | 'setPlaybackRate'
  | 'selectQuality'
  | 'selectTextTrack'
  | 'requestFullscreen'
  | 'exitFullscreen'
  | 'requestPictureInPicture'
  | 'exitPictureInPicture'
  | 'retry';

export type VimeoProviderAdapter = ProviderAdapter &
  Required<Pick<ProviderAdapter, VimeoCommand>> & {
    readonly provider: 'vimeo';
  };

// Every command this adapter never has a live handle for, no matter which one
// is asked: there is no player behind a rejected id, so every command answers
// the same as one issued before a real handle has arrived (`not-ready`,
// `attachment.ts`'s `retry` on a destroyed adapter).
const rejectedCommand = async (): Promise<CommandResult> => ({
  ok: false,
  reason: 'not-ready'
});

// Built instead of the normal composition when `source.videoId` fails
// `isVimeoVideoId`, or `source.hash` is present and fails `isVimeoHash`, so
// `createVimeoAttachment` (and the boundary/playback/presentation/quality/
// text-track seams under it) are never called on this path — no iframe, no
// SDK load, no oEmbed request, by construction rather than by care.
// `attach`/`load`/`retry` are permanent no-ops, `destroy` is idempotent, and
// every subscriber -- present or future -- is handed the same fixed `source`
// error immediately, so a late subscriber sees it too rather than missing it.
// `subscribeDimensions`, `subscribeCues` and `setCaptionRenderer` are given
// safe no-op implementations rather than omitted: the real Vimeo adapter
// always provides all three, so a rejected adapter keeps the same shape.
const createRejectedVimeoProvider = (): VimeoProviderAdapter => {
  const error: PlayerError = {
    category: 'source',
    fatal: true,
    recoverable: true,
    message: 'The Vimeo video id or privacy hash is not a supported format.'
  };

  return {
    provider: 'vimeo',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: (listener) => {
      listener(
        {
          lifecycle: 'error',
          activation: 'error',
          commandsReady: false,
          error
        },
        providerEvent('error', error)
      );
      return () => undefined;
    },
    subscribeDimensions: (listener) => {
      listener(undefined);
      return () => undefined;
    },
    subscribeCues: () => () => undefined,
    setCaptionRenderer: () => undefined,
    play: rejectedCommand,
    pause: rejectedCommand,
    seekTo: rejectedCommand,
    seekBy: rejectedCommand,
    mute: rejectedCommand,
    unmute: rejectedCommand,
    setVolume: rejectedCommand,
    setPlaybackRate: rejectedCommand,
    selectQuality: rejectedCommand,
    selectTextTrack: rejectedCommand,
    requestFullscreen: rejectedCommand,
    exitFullscreen: rejectedCommand,
    requestPictureInPicture: rejectedCommand,
    exitPictureInPicture: rejectedCommand,
    retry: rejectedCommand
  };
};

export const createVimeoProvider = (
  mount: VimeoMountElement,
  source: VimeoSource,
  options: VimeoProviderOptions = {}
): VimeoProviderAdapter => {
  if (
    !isVimeoVideoId(source.videoId) ||
    (source.hash !== undefined && !isVimeoHash(source.hash))
  ) {
    return createRejectedVimeoProvider();
  }

  const listeners = new Set<ProviderStateListener>();

  const emit = (
    patch: Parameters<ProviderStateListener>[0],
    event?: ProviderEvent
  ): void => listeners.forEach((listener) => listener(patch, event));

  const chromeless = createVimeoChromelessAvailability({ source, options });

  const boundary = createVimeoBoundary(options);

  const playback = createVimeoPlayback(mount, {
    emit,
    isStale: (player) => attachment.isStale(player),
    getPlayer: () => attachment.getPlayer(),
    getCapabilities: playerCapabilities,
    boundary
  });

  const qualityLevels = createVimeoQualityLevels({
    emit,
    getPlayer: () => attachment.getPlayer()
  });

  const presentation = createVimeoPresentation({
    emit,
    getPlayer: () => attachment.getPlayer(),
    getCapabilities: playerCapabilities
  });

  const textTracks = createVimeoTextTracks({
    emit,
    isStale: (player) => attachment.isStale(player),
    getPlayer: () => attachment.getPlayer(),
    getCurrentTime: playback.getCurrentTime,
    getCapabilities: playerCapabilities
  });

  // The capabilities this embed has, folding every seam that decides one
  // together. Recomputed on every publication: each answer changes with the
  // player and the account tier behind it, not with the adapter.
  function playerCapabilities(): PlayerCapabilities {
    return {
      seek: available,
      setVolume: playback.setVolumeAvailability(),
      setPlaybackRate: playback.setPlaybackRateAvailability(),
      selectQuality: qualityLevels.selectQualityAvailability(),
      selectTextTrack: textTracks.selectTextTrackAvailability(),
      fullscreen: available,
      pictureInPicture: presentation.pictureInPictureAvailability(),
      // The SDK exposes remote-playback methods, but this adapter wires no
      // command surface for them yet, so they are unavailable through Reely
      // rather than forever "unknown".
      airPlay: { status: 'unavailable', reason: 'provider' },
      customControls: chromeless.customControlsAvailability()
    };
  }

  const attachment = createVimeoAttachment(mount, source, {
    emit,
    options,
    getCapabilities: playerCapabilities,
    chromeless,
    playback,
    presentation,
    qualityLevels,
    textTracks,
    clearStateListeners: () => listeners.clear()
  });

  return {
    provider: 'vimeo',
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
    selectQuality: qualityLevels.selectQuality,
    selectTextTrack: textTracks.selectTextTrack,
    subscribeCues: textTracks.subscribeCues,
    setCaptionRenderer: textTracks.setCaptionRenderer,
    requestFullscreen: presentation.requestFullscreen,
    exitFullscreen: presentation.exitFullscreen,
    requestPictureInPicture: presentation.requestPictureInPicture,
    exitPictureInPicture: presentation.exitPictureInPicture,
    retry: attachment.retry
  };
};
