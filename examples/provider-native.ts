import { PlayerController } from '@playdeck/core';
import { createNativeProvider } from '@playdeck/provider-native';

declare const videoElement: HTMLVideoElement;

const controller = new PlayerController();

// Plays anything the element itself can play — MP4, WebM, and HLS on Safari,
// where the browser has its own HLS support.
controller.setProvider(
  createNativeProvider(videoElement, {
    loop: true,
    // A clip out of a longer file: playback is clamped to this window.
    startTime: 30,
    endTime: 45
  })
);

export const play = (): Promise<unknown> => controller.play();
