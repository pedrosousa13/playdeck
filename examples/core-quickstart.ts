import { PlayerController, detectSource } from '@reely/core';
import { createNativeProvider } from '@reely/provider-native';

declare const videoElement: HTMLVideoElement;

const source = detectSource('https://example.com/clip.mp4');
// -> { status: 'success', source: { type: 'video', sources: [...] } }

const controller = new PlayerController();
controller.setProvider(createNativeProvider(videoElement));

const unsubscribe = controller.subscribe((state) => {
  console.log(state.playback, state.currentTime, state.capabilities.seek);
});

export const start = async (): Promise<void> => {
  if (await controller.whenReady()) await controller.play();
};

export const stop = (): void => {
  unsubscribe();
  controller.setProvider(undefined);
};

export const detected = source;
