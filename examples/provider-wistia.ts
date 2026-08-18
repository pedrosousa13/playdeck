import { PlayerController } from '@playdeck/core';
import {
  API_READY_TIMEOUT_MS,
  createWistiaProvider,
  loadWistiaPlayer,
  resetWistiaPlayerLoader,
  SCRIPT_LOAD_TIMEOUT_MS
} from '@playdeck/provider-wistia';
import type {
  WistiaMountElement,
  WistiaScriptInjector
} from '@playdeck/provider-wistia';

declare const mount: WistiaMountElement;

const controller = new PlayerController();

// `mediaId` is Wistia's hashed id, which `detectSource` reads out of any of
// Wistia's URL forms. `dnt` asks Wistia not to track the session.
controller.setProvider(
  createWistiaProvider(
    mount,
    { type: 'wistia', mediaId: 'oifkgmxnkb' },
    { controls: false, dnt: true, loop: false }
  )
);

// Wistia's bundle is fetched from `https://fast.wistia.com/player.js` on the
// first attach, once per page, and registers the `<wistia-player>` element.
export const warm = (): Promise<unknown> => loadWistiaPlayer();

// Serve that bundle from your own origin by replacing the injector. The loader
// still owns the shared promise, the deadline and the registration it waits
// for — this only decides where the script comes from.
const fromOwnOrigin: WistiaScriptInjector = () => {
  const script = document.createElement('script');
  script.src = '/vendor/wistia-player.js';
  script.async = true;
  document.head.appendChild(script);
  return script;
};

export const warmFromOwnOrigin = (): Promise<unknown> =>
  loadWistiaPlayer(fromOwnOrigin);

// Drops the cached registration — for tests that need a clean load, not for
// app code.
export const reset = (): void => resetWistiaPlayerLoader();

// How long the player is given to hand over its API before the attach reports
// a recoverable error. Aurora fires no failure event of its own, so without
// this an unreachable media would leave the player loading for ever.
export const apiReadyTimeout = API_READY_TIMEOUT_MS; // 15000

// The separate backstop on the script fetch that precedes that handshake. The
// two run in sequence, so a black-holed network reports an error in up to
// thirty seconds rather than fifteen.
export const scriptLoadTimeout = SCRIPT_LOAD_TIMEOUT_MS; // 15000
