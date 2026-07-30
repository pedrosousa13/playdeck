import type {
  Availability,
  CommandResult,
  PlayerCapabilities
} from '@reely/core';
import {
  available,
  HAVE_METADATA,
  notReady,
  policyBlocked,
  policyDisallowed,
  providerEvent,
  runCommand,
  unsupported,
  type EmitProviderState
} from './media-helpers.js';

type WebKitPresentationMode = 'inline' | 'picture-in-picture' | 'fullscreen';

type WebKitHTMLVideoElement = HTMLVideoElement & {
  readonly webkitSupportsFullscreen?: boolean;
  readonly webkitDisplayingFullscreen?: boolean;
  readonly webkitEnterFullscreen?: () => void;
  readonly webkitExitFullscreen?: () => void;
  readonly webkitSupportsPresentationMode?: (
    mode: WebKitPresentationMode
  ) => boolean;
  readonly webkitSetPresentationMode?: (mode: WebKitPresentationMode) => void;
  readonly webkitPresentationMode?: WebKitPresentationMode;
  readonly webkitShowPlaybackTargetPicker?: () => void;
  // Present-but-unused: AirPlay is fire-and-forget today. Surfacing an active
  // wireless-route flag needs a new observable state field (a route-change
  // subscription + PlayerState surface), which is a feature, not hardening —
  // deferred rather than added here. The `webkitcurrentplaybacktargetiswireless
  // changed` event would drive it.
  readonly webkitCurrentPlaybackTargetIsWireless?: boolean;
  readonly disableRemotePlayback?: boolean;
};

export type NativePresentationDeps = {
  readonly emit: EmitProviderState;
  // Recomputes the host's full `PlayerCapabilities` snapshot; the AirPlay
  // route-availability event needs it because presentation availability is
  // only one facet of the host's overall capabilities.
  readonly getCapabilities: () => PlayerCapabilities;
};

// The presentation seam: fullscreen, picture-in-picture, and AirPlay —
// availability probes, request/exit commands, and the WebKit-specific paths
// (webkitEnterFullscreen, presentation-mode events, AirPlay target
// availability). The AirPlay route flag is the only mutable state and lives
// here; the host wires `handlers` to the element/document and folds the
// availability probes into its capabilities snapshot.
export type NativePresentation = {
  readonly fullscreenAvailability: () => Availability;
  readonly pictureInPictureAvailability: () => Availability;
  readonly airPlayAvailability: () => Availability;
  readonly requestFullscreen: () => Promise<CommandResult>;
  readonly exitFullscreen: () => Promise<CommandResult>;
  readonly requestPictureInPicture: () => Promise<CommandResult>;
  readonly exitPictureInPicture: () => Promise<CommandResult>;
  readonly showAirPlayPicker: () => Promise<CommandResult>;
  readonly handlers: {
    readonly onFullscreenChange: (originalEvent: Event) => void;
    readonly onPictureInPictureChange: (originalEvent: Event) => void;
    readonly onWebKitFullscreenChange: (originalEvent: Event) => void;
    readonly onWebKitPresentationModeChange: (originalEvent: Event) => void;
    readonly onAirPlayTargetAvailabilityChange: (event: Event) => void;
  };
};

export const createNativePresentation = (
  media: HTMLVideoElement,
  { emit, getCapabilities }: NativePresentationDeps
): NativePresentation => {
  const ownerDocument = media.ownerDocument;
  const webkitMedia: WebKitHTMLVideoElement = media;

  const fullscreenAvailability = (): Availability => {
    if (typeof media.requestFullscreen === 'function') {
      return ownerDocument.fullscreenEnabled === false
        ? policyDisallowed
        : available;
    }
    if (typeof webkitMedia.webkitEnterFullscreen === 'function') {
      if (webkitMedia.webkitSupportsFullscreen === true) return available;
      return media.readyState >= HAVE_METADATA ? unsupported : notReady;
    }
    return unsupported;
  };

  const supportsWebKitPictureInPicture = (): boolean =>
    typeof webkitMedia.webkitSetPresentationMode === 'function' &&
    typeof webkitMedia.webkitSupportsPresentationMode === 'function' &&
    webkitMedia.webkitSupportsPresentationMode('picture-in-picture') === true;

  const pictureInPictureAvailability = (): Availability => {
    if (media.disablePictureInPicture === true) return policyDisallowed;
    if (typeof media.requestPictureInPicture === 'function') {
      return ownerDocument.pictureInPictureEnabled === false
        ? policyDisallowed
        : available;
    }
    return supportsWebKitPictureInPicture() ? available : unsupported;
  };

  // WebKit is the only engine exposing a native AirPlay route picker. Blink and
  // Gecko have no equivalent, so AirPlay reports unavailable there.
  const airPlayDisallowed = (): boolean =>
    media.getAttribute('x-webkit-airplay') === 'deny' ||
    webkitMedia.disableRemotePlayback === true;

  // Whether WebKit has told us a playback target exists. Starts false: Apple's
  // guidance is to show an AirPlay control only once the availability event
  // reports a route, and every native Apple player behaves that way, so an
  // always-present button reads as broken rather than as a feature (#71).
  //
  // `unavailable`, not `unknown`, for the pre-event window. `unknown` promises
  // a verdict is coming, and on a machine that never sees a receiver the event
  // never fires — which is exactly the trap `selectQuality` used to be in
  // (see the capabilities comment in index.ts): a consumer gating UI on it
  // waits forever. This says what is true right now and flips the moment that
  // stops being true.
  let airPlayRouteAvailable = false;
  const airPlayNoRoute: Availability = {
    status: 'unavailable',
    reason: 'provider'
  };

  const airPlayAvailability = (): Availability => {
    if (typeof webkitMedia.webkitShowPlaybackTargetPicker !== 'function') {
      return unsupported;
    }
    if (airPlayDisallowed()) return policyDisallowed;
    return airPlayRouteAvailable ? available : airPlayNoRoute;
  };

  const onAirPlayTargetAvailabilityChange = (event: Event): void => {
    const next =
      (event as { readonly availability?: string }).availability ===
      'available';
    // WebKit re-announces on route changes that leave availability unchanged;
    // recomputing capabilities on each would push an identical patch to every
    // subscriber and wake every capability-gated control for nothing.
    if (next === airPlayRouteAvailable) return;
    airPlayRouteAvailable = next;
    emit({ capabilities: getCapabilities() });
  };

  const onFullscreenChange = (originalEvent: Event): void =>
    emit(
      { fullscreen: ownerDocument.fullscreenElement === media },
      providerEvent('fullscreenchange', originalEvent, {
        fullscreen: ownerDocument.fullscreenElement === media
      })
    );
  const onPictureInPictureChange = (originalEvent: Event): void =>
    emit(
      { pictureInPicture: ownerDocument.pictureInPictureElement === media },
      providerEvent('pictureinpicturechange', originalEvent, {
        pictureInPicture: ownerDocument.pictureInPictureElement === media
      })
    );
  const onWebKitFullscreenChange = (originalEvent: Event): void => {
    const fullscreen = originalEvent.type === 'webkitbeginfullscreen';
    emit(
      { fullscreen },
      providerEvent('fullscreenchange', originalEvent, { fullscreen })
    );
  };
  // Only picture-in-picture state is derived here; fullscreen presentation
  // mode transitions rely on webkitbeginfullscreen/webkitendfullscreen,
  // which Safari fires alongside this event.
  const onWebKitPresentationModeChange = (originalEvent: Event): void => {
    const pictureInPicture =
      webkitMedia.webkitPresentationMode === 'picture-in-picture';
    emit(
      { pictureInPicture },
      providerEvent('pictureinpicturechange', originalEvent, {
        pictureInPicture
      })
    );
  };

  return {
    fullscreenAvailability,
    pictureInPictureAvailability,
    airPlayAvailability,
    requestFullscreen: async () => {
      if (typeof media.requestFullscreen === 'function') {
        if (ownerDocument.fullscreenEnabled === false) {
          return policyBlocked(
            'Fullscreen is disallowed by the document permissions policy.'
          );
        }
        return runCommand(() => media.requestFullscreen());
      }
      const enterWebKitFullscreen = webkitMedia.webkitEnterFullscreen;
      if (typeof enterWebKitFullscreen !== 'function')
        return { ok: false, reason: 'unsupported' };
      if (webkitMedia.webkitSupportsFullscreen !== true) {
        return media.readyState >= HAVE_METADATA
          ? { ok: false, reason: 'unsupported' }
          : { ok: false, reason: 'not-ready' };
      }
      return runCommand(() => enterWebKitFullscreen.call(media));
    },
    exitFullscreen: async () => {
      // Standard fullscreen first: Blink still ships the legacy WebKit video
      // fullscreen properties, so webkitDisplayingFullscreen is also true
      // after a standard requestFullscreen there.
      if (ownerDocument.fullscreenElement === media) {
        if (!ownerDocument.exitFullscreen)
          return { ok: false, reason: 'unsupported' };
        return runCommand(() => ownerDocument.exitFullscreen());
      }
      if (webkitMedia.webkitDisplayingFullscreen === true) {
        const exitWebKitFullscreen = webkitMedia.webkitExitFullscreen;
        if (typeof exitWebKitFullscreen !== 'function')
          return { ok: false, reason: 'unsupported' };
        return runCommand(() => exitWebKitFullscreen.call(media));
      }
      return { ok: true };
    },
    requestPictureInPicture: async () => {
      if (media.disablePictureInPicture === true) {
        return policyBlocked(
          'Picture-in-picture is disabled on this media element.'
        );
      }
      if (typeof media.requestPictureInPicture === 'function') {
        if (ownerDocument.pictureInPictureEnabled === false) {
          return policyBlocked(
            'Picture-in-picture is disallowed by the document permissions policy.'
          );
        }
        return runCommand(() => media.requestPictureInPicture());
      }
      const setPresentationMode = webkitMedia.webkitSetPresentationMode;
      if (
        typeof setPresentationMode !== 'function' ||
        !supportsWebKitPictureInPicture()
      ) {
        return { ok: false, reason: 'unsupported' };
      }
      return runCommand(() =>
        setPresentationMode.call(media, 'picture-in-picture')
      );
    },
    exitPictureInPicture: async () => {
      const setPresentationMode = webkitMedia.webkitSetPresentationMode;
      if (
        webkitMedia.webkitPresentationMode === 'picture-in-picture' &&
        typeof setPresentationMode === 'function'
      ) {
        return runCommand(() => setPresentationMode.call(media, 'inline'));
      }
      if (ownerDocument.pictureInPictureElement !== media) return { ok: true };
      if (!ownerDocument.exitPictureInPicture)
        return { ok: false, reason: 'unsupported' };
      return runCommand(() => ownerDocument.exitPictureInPicture());
    },
    showAirPlayPicker: async () => {
      const showPicker = webkitMedia.webkitShowPlaybackTargetPicker;
      if (typeof showPicker !== 'function') {
        return { ok: false, reason: 'unsupported' };
      }
      if (airPlayDisallowed()) {
        return policyBlocked('AirPlay is disabled on this media element.');
      }
      return runCommand(() => showPicker.call(media));
    },
    handlers: {
      onFullscreenChange,
      onPictureInPictureChange,
      onWebKitFullscreenChange,
      onWebKitPresentationModeChange,
      onAirPlayTargetAvailabilityChange
    }
  };
};
