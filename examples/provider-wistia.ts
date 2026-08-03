import { PlayerController } from '@reely/core';
import {
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
