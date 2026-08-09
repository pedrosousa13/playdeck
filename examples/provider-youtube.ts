import { PlayerController } from '@reely/core';
import {
  API_READY_TIMEOUT_MS,
  PLAYBACK_CONFIRMATION_TIMEOUT_MS,
  createYouTubeProvider,
  loadYouTubeIframeApi,
  resetYouTubeIframeApiLoader
} from '@reely/provider-youtube';

declare const mount: HTMLElement;

const controller = new PlayerController();

// The embed defaults to youtube-nocookie.com; `host` opts back out of it.
controller.setProvider(createYouTubeProvider(mount, 'dQw4w9WgXcQ'));

// The iframe API is loaded for you. Call this directly only to warm it before
// a player mounts.
export const warm = (): Promise<unknown> => loadYouTubeIframeApi();

// Drops the memo of the API load — for tests that need a clean load, not for
// app code.
export const reset = (): void => resetYouTubeIframeApiLoader();

// How long the script is given to hand over the API before the load is
// reported as failed. A response that is 200 OK but is not the API fires no
// error event, so without this every player on the page would wait for ever.
export const apiReadyTimeout = API_READY_TIMEOUT_MS; // 15000

// How long a play command waits for YouTube to confirm playback started before
// it is reported as blocked, rather than resolving a promise that never lands.
export const confirmationTimeout = PLAYBACK_CONFIRMATION_TIMEOUT_MS; // 3000
