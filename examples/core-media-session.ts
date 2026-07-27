import {
  PlayerController,
  bindMediaSession,
  getMediaSessionCoordinator
} from '@reely/core';

declare const controller: PlayerController;

// One coordinator per MediaSession. Two players on the same page arbitrate
// lock-screen ownership through it instead of overwriting each other.
const coordinator = getMediaSessionCoordinator(navigator.mediaSession);

// Binds this controller's *confirmed* playback to the coordinator, and routes
// the lock screen's play/pause/seek actions back to it.
const binding = bindMediaSession(controller, coordinator, {
  metadata: { title: 'Big Buck Bunny', artist: 'Blender Foundation' }
});

export const rename = (): void => binding.setMetadata({ title: 'Sintel' });

// Release when the player unmounts: ownership passes to whichever player is
// still playing.
export const release = (): void => binding.release();
