import { PlayerController } from '@reely/core';
import {
  createVimeoProvider,
  loadVimeoSdk,
  resetVimeoSdkLoader
} from '@reely/provider-vimeo';
import type { VimeoMountElement } from '@reely/provider-vimeo';

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
