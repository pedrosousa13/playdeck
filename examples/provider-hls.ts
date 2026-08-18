import { PlayerController } from '@playdeck/core';
import { createHlsProvider } from '@playdeck/provider-hls';

declare const videoElement: HTMLVideoElement;

const controller = new PlayerController();

// hls.js is a dependency but is imported dynamically, so it only reaches the
// network when the hls.js engine is actually the one selected.
controller.setProvider(
  createHlsProvider(videoElement, { type: 'hls', src: '/master.m3u8' })
);

export const play = (): Promise<unknown> => controller.play();
