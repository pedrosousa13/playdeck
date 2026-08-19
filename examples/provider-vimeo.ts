import { PlayerController } from '@playdeck/core';
import {
  createVimeoProvider,
  loadVimeoSdk,
  PLAYER_READY_TIMEOUT_MS,
  resetVimeoSdkLoader
} from '@playdeck/provider-vimeo';
import type { VimeoMountElement } from '@playdeck/provider-vimeo';

declare const mount: VimeoMountElement;

const controller = new PlayerController();

// `hash` is the privacy hash of an unlisted video, which `detectSource` keeps
// when it recognises one in the URL. `dnt` asks Vimeo not to track the session.
controller.setProvider(
  createVimeoProvider(
    mount,
    { type: 'vimeo', videoId: '76979871', hash: '8272103f6e' },
    { controls: false, dnt: true }
  )
);

// The SDK is loaded on demand and cached across players. Pass your own importer
// to serve it from somewhere other than the default module.
export const warm = (): Promise<unknown> => loadVimeoSdk();

// Drops the cached SDK — for tests that need a clean load, not for app code.
export const reset = (): void => resetVimeoSdkLoader();

// How long `player.ready()` is given before the attach reports a recoverable
// error. Command readiness is declared earlier, at player construction, because
// the SDK queues calls it receives before its own ready resolves — but that is
// not a bound, and without this a frame blocked by the page CSP, an extension
// or the network leaves the player loading for ever with no error to render
// (#327).
export const playerReadyTimeout = PLAYER_READY_TIMEOUT_MS; // 15000
