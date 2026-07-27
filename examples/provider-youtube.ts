import { PlayerController } from '@reely/core';
import {
  PLAYBACK_CONFIRMATION_TIMEOUT_MS,
  createYouTubeProvider,
  loadYouTubeIframeApi
} from '@reely/provider-youtube';

declare const mount: HTMLElement;

const controller = new PlayerController();

// The embed defaults to youtube-nocookie.com; `host` opts back out of it.
controller.setProvider(createYouTubeProvider(mount, 'dQw4w9WgXcQ'));

// The iframe API is loaded for you. Call this directly only to warm it before
// a player mounts.
export const warm = (): Promise<unknown> => loadYouTubeIframeApi();

// How long a play command waits for YouTube to confirm playback started before
// it is reported as blocked, rather than resolving a promise that never lands.
export const confirmationTimeout = PLAYBACK_CONFIRMATION_TIMEOUT_MS; // 3000
