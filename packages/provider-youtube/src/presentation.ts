import type { Availability, CommandResult } from '@playdeck/core';
import {
  available,
  browserUnavailable,
  commandFailure,
  providerEvent,
  type EmitProviderState
} from './adapter-values.js';

export type YouTubePresentationDeps = {
  readonly emit: EmitProviderState;
  readonly isDestroyed: () => boolean;
  // Whether the player object exists yet: fullscreen has nothing to enter
  // before it does, and nothing to enter again after teardown.
  readonly hasPlayer: () => boolean;
  // The player's iframe, or undefined while there is none to read.
  readonly getIframe: () => HTMLIFrameElement | undefined;
};

// The presentation seam: fullscreen availability, the enter/exit commands and
// the document's fullscreen change. Holds no state of its own — the browser's
// own `fullscreenElement` is the record of what is presented, and this seam
// only decides whether that element is one of ours.
export type YouTubePresentation = {
  readonly fullscreenAvailability: () => Availability;
  readonly requestFullscreen: () => Promise<CommandResult>;
  readonly exitFullscreen: () => Promise<CommandResult>;
  readonly handlers: {
    readonly onFullscreenChange: (originalEvent: Event) => void;
  };
};

export const createYouTubePresentation = (
  mount: HTMLElement,
  { emit, isDestroyed, hasPlayer, getIframe }: YouTubePresentationDeps
): YouTubePresentation => {
  const ownerDocument = mount.ownerDocument;

  const fullscreenElementIsOurs = (): boolean => {
    const fullscreenElement = ownerDocument.fullscreenElement;
    if (!fullscreenElement) return false;
    const iframe = getIframe();
    return (
      fullscreenElement === iframe ||
      fullscreenElement === mount ||
      mount.contains(fullscreenElement)
    );
  };

  return {
    fullscreenAvailability: () => {
      const iframe = getIframe();
      return typeof iframe?.requestFullscreen === 'function'
        ? available
        : browserUnavailable;
    },
    requestFullscreen: async () => {
      if (isDestroyed() || !hasPlayer()) {
        return { ok: false, reason: 'not-ready' };
      }
      // Fullscreen must wrap the whole iframe: YouTube policy requires the
      // provider chrome to stay visible and interactive.
      const target = getIframe() ?? mount;
      if (typeof target.requestFullscreen !== 'function') {
        return { ok: false, reason: 'unsupported' };
      }
      try {
        await target.requestFullscreen();
        return { ok: true };
      } catch (cause) {
        return commandFailure(cause);
      }
    },
    exitFullscreen: async () => {
      if (!fullscreenElementIsOurs()) return { ok: true };
      if (typeof ownerDocument.exitFullscreen !== 'function') {
        return { ok: false, reason: 'unsupported' };
      }
      try {
        await ownerDocument.exitFullscreen();
        return { ok: true };
      } catch (cause) {
        return commandFailure(cause);
      }
    },
    handlers: {
      onFullscreenChange: (originalEvent) => {
        if (isDestroyed()) return;
        const fullscreen = fullscreenElementIsOurs();
        emit(
          { fullscreen },
          providerEvent('fullscreenchange', { fullscreen }, originalEvent)
        );
      }
    }
  };
};
