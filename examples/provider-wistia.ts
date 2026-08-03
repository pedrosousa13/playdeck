import { PlayerController } from '@reely/core';
import {
  API_READY_TIMEOUT_MS,
  createWistiaProvider,
  loadWistiaPlayer,
  resetWistiaPlayerLoader
} from '@reely/provider-wistia';
import type { WistiaMountElement } from '@reely/provider-wistia';

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

// The player element is loaded on demand and registered once per page. Pass
// your own importer to serve it from somewhere other than the default module.
export const warm = (): Promise<unknown> => loadWistiaPlayer();

// Drops the cached registration — for tests that need a clean load, not for
// app code.
export const reset = (): void => resetWistiaPlayerLoader();

// How long the player is given to hand over its API before the attach reports
// a recoverable error. Aurora fires no failure event of its own, so without
// this an unreachable media would leave the player loading for ever.
export const apiReadyTimeout = API_READY_TIMEOUT_MS; // 15000
