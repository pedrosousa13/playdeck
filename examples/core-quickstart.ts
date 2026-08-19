import { PlayerController, detectSource } from '@playdeck/core';
import { createNativeProvider } from '@playdeck/provider-native';

declare const videoElement: HTMLVideoElement;

// Resolves a URL into an explicit source, or explains why it cannot — nothing
// is handed to a provider to fail later.
const source = detectSource('https://example.com/clip.mp4');
if (source.status === 'failure') throw new Error(source.guidance);

const controller = new PlayerController();
controller.setProvider(createNativeProvider(videoElement));

const unsubscribe = controller.subscribe((state) => {
  console.log(state.playback, state.currentTime, state.capabilities.seek);
});

// Commands are answered, never queued: `whenReady` is how you find out when
// one will land, rather than issuing it and hoping.
export const start = async (): Promise<void> => {
  if (await controller.whenReady()) await controller.play();
};

export const stop = (): void => {
  unsubscribe();
  controller.setProvider(undefined);
};
