import type {
  Availability,
  CommandResult,
  PlayerCapabilities,
  PlayerRemotePlaybackState
} from '@playdeck/core';
import {
  available,
  runCommand,
  unsupported,
  type EmitProviderState
} from './adapter-values.js';

export type NativeRemotePlaybackDeps = {
  readonly emit: EmitProviderState;
  // Recomputes the host's full `PlayerCapabilities` snapshot; the
  // availability-watch callback needs it for the same reason the AirPlay
  // route-availability event does (`presentation.ts`'s `NativePresentationDeps`).
  readonly getCapabilities: () => PlayerCapabilities;
};

// The Remote Playback API seam: the availability probe
// (`remote.watchAvailability`), the `showRemotePlaybackPicker` command
// (`remote.prompt()`), and the connection-state events
// (`connecting`/`connect`/`disconnect`) `remote` itself fires. Kept out of
// `presentation.ts` because its availability watch is promise-based rather
// than a plain event pair, and its events fire on `media.remote` rather than
// on the element or its document.
export type NativeRemotePlayback = {
  readonly remotePlaybackAvailability: () => Availability;
  readonly remotePlaybackState: () => PlayerRemotePlaybackState;
  readonly showRemotePlaybackPicker: () => Promise<CommandResult>;
  readonly attachListeners: () => void;
  readonly destroy: () => void;
};

// Present-but-with-no-route, the same shape `presentation.ts`'s
// `airPlayNoRoute` is: `unavailable` rather than `unknown`, because the watch
// answers "no" immediately and stays "no" on a machine that never sees a
// receiver -- `unknown` promises a verdict is still coming, and this one
// answers what is true right now.
const remotePlaybackNoDevice: Availability = {
  status: 'unavailable',
  reason: 'provider'
};

export const createNativeRemotePlayback = (
  media: HTMLVideoElement,
  { emit, getCapabilities }: NativeRemotePlaybackDeps
): NativeRemotePlayback => {
  // Whether `watchAvailability`'s callback has last reported a device. Starts
  // false for the same reason `presentation.ts`'s `airPlayRouteAvailable`
  // does: the pre-callback window is a real "no" rather than a "not yet
  // known" a consumer would wait forever on -- a machine that never sees a
  // receiver never gets a callback to correct it.
  let deviceAvailable = false;
  let watchId: number | undefined;

  const remotePlaybackAvailability = (): Availability => {
    if (typeof media.remote?.watchAvailability !== 'function') {
      return unsupported;
    }
    return deviceAvailable ? available : remotePlaybackNoDevice;
  };

  // `null` both while the capability has not resolved to `available` and once
  // it has settled back on `unavailable` -- the capability is what tells
  // those two apart, the same pairing `providerPoster`/`providerPosterUrl`
  // already are. Reflects `remote.state` directly once `available`.
  const remotePlaybackState = (): PlayerRemotePlaybackState =>
    remotePlaybackAvailability().status === 'available'
      ? (media.remote?.state ?? null)
      : null;

  const onAvailabilityChange = (next: boolean): void => {
    // The API re-announces on route changes that leave availability
    // unchanged; recomputing capabilities on each would push an identical
    // patch to every subscriber and wake every capability-gated control for
    // nothing (mirrors `presentation.ts`'s `onAirPlayTargetAvailabilityChange`).
    if (next === deviceAvailable) return;
    deviceAvailable = next;
    emit({
      capabilities: getCapabilities(),
      remotePlayback: remotePlaybackState()
    });
  };

  const onConnectionStateChange = (): void => {
    emit({ remotePlayback: remotePlaybackState() });
  };

  return {
    remotePlaybackAvailability,
    remotePlaybackState,
    showRemotePlaybackPicker: async () => {
      const remote = media.remote;
      if (typeof remote?.prompt !== 'function') {
        return { ok: false, reason: 'unsupported' };
      }
      return runCommand(() => remote.prompt());
    },
    attachListeners: () => {
      const remote = media.remote;
      if (typeof remote?.watchAvailability !== 'function') return;
      remote.addEventListener('connecting', onConnectionStateChange);
      remote.addEventListener('connect', onConnectionStateChange);
      remote.addEventListener('disconnect', onConnectionStateChange);
      remote
        .watchAvailability(onAvailabilityChange)
        .then((id) => {
          watchId = id;
        })
        .catch(() => {
          // `disableRemotePlayback` rejects the watch outright; the
          // capability is already reporting `unavailable` and stays there.
        });
    },
    destroy: () => {
      const remote = media.remote;
      remote?.removeEventListener('connecting', onConnectionStateChange);
      remote?.removeEventListener('connect', onConnectionStateChange);
      remote?.removeEventListener('disconnect', onConnectionStateChange);
      if (watchId !== undefined) {
        void remote?.cancelWatchAvailability(watchId).catch(() => undefined);
      }
    }
  };
};
