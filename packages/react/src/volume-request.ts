import type { PlayerController, PlayerState } from '@reely/core';
import {
  createCommandChain,
  requestAnswered,
  ECHO_DEADLINE_MS
} from './optimistic-request.js';

// The volume the user last asked for, held until the media element publishes a
// volume that answers it, and the command traffic that asks for it coalesced.
// `optimistic-request.ts` explains why any of that is needed; this is the
// volume binding onto it.
//
// It is player-scoped rather than kept in a control, because two siblings
// consume the same request and neither can read the other's React state:
// `VolumeSlider` renders it, and the `Controls` shortcut layer compounds its
// next value on it (the arrow keys never reach the input at all — ADR-0005 has
// the layer own them — so a layer reading published state instead computes the
// same target twice, and the second press of a pair is silently no-op). The
// shortcut layer also runs while no volume control is mounted at all, so
// nothing a control renders can be what holds or releases the request. That is
// the shape `lastSelectedTextTrackId` already takes for the same reason, after
// two controls each keeping their own copy disagreed (#58).
//
// Being a store rather than React state is what makes the other half of the
// policy a hazard: a store is not subject to React's rollback of a discarded
// render, so a value released by mutating one during a render React throws away
// is released once, in an attempt that never commits, and the control and the
// store then disagree forever. Nothing here is called during render. Every
// mutation below runs from an event handler, from the player subscription, or
// from a timer.

// How far the published volume may sit from the requested one and still count
// as the player having answered for it.
//
// Bounded on both sides. It is strictly below the 0.05 an arrow press moves
// (`controls.tsx`), because a wider one would read the volume from *before* a
// single press as an answer to it and revert the thumb as soon as the command
// settled — the same reasoning `SEEK_ECHO_TOLERANCE_SECONDS` is written
// against. And it is above the coarsest quantisation a provider imposes:
// YouTube's IFrame API takes volume as an integer 0-100, so it rounds to 0.01,
// and a tolerance below that would leave a rounded echo failing to answer the
// request that caused it.
//
// The lower bound is stated against that 0.05, which is also `VolumeSlider`'s
// default `step`, and `step` is a documented escape hatch. What a consumer
// `step` still governs is pointer scrubbing: the arrows are the layer's own
// fixed 0.05 and never the input's, because ADR-0005 has the layer own
// `ArrowUp`/`ArrowDown` inside `Player.Controls` and prevent the default before
// the input steps. So a `step` below this tolerance moves the request less than
// the tolerance on a single scrubbed increment, and the volume from before it
// reads as already-arrived and reverts the thumb once the command settles.
// Deriving the tolerance from the effective step would cost more machinery than
// a fine-grained volume step is worth.
const VOLUME_ECHO_TOLERANCE = 0.02;

export type VolumeRequest = {
  // The volume the user last asked for, or `null` while published state is what
  // the control should show.
  //
  // One function for two callers deliberately. It is `useSyncExternalStore`'s
  // snapshot for `VolumeSlider` — a number or a null, never a fresh object, so
  // a snapshot is stable by value and cannot loop the store. And it is the
  // non-reactive read the shortcut layer compounds on inside its key handler,
  // which needs the value as of the keypress rather than as of the last
  // commit: `request` below mutates it synchronously, so a press compounds on
  // whatever the press before it asked for however React scheduled its
  // renders.
  readonly getRequested: () => number | null;
  readonly subscribe: (listener: () => void) => () => void;
  // Ask for `volume`. Muting is a separate command and stays the caller's:
  // this only ever moves the volume.
  readonly request: (volume: number) => void;
  // Start reconciling from the player, and return the teardown — so `Root`
  // drives it from an effect, like any other subscription.
  readonly observe: () => () => void;
};

export const createVolumeRequest = (
  controller: PlayerController
): VolumeRequest => {
  let requested: number | null = null;
  // Read the moment a change arrives rather than a render later, for the same
  // reason the chain keeps its own `inFlight`: a drag's change events all land
  // in the same tick, before anything has re-rendered.
  let settling = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let provider = controller.getState().provider;
  const listeners = new Set<() => void>();

  const release = (): void => {
    if (deadline !== undefined) {
      clearTimeout(deadline);
      deadline = undefined;
    }
    if (requested === null) return;
    requested = null;
    listeners.forEach((listener) => listener());
  };

  // The published volume as the control renders it. Reconciling against the
  // raw `volume` instead would answer a request made while muted with a value
  // the user cannot see: they asked for half volume, the thumb would be showing
  // it, and the player would still be reporting a silent zero.
  const publishedVolume = (state: PlayerState): number =>
    state.muted ? 0 : state.volume;

  const reconcile = (state: PlayerState): void => {
    if (requested === null) return;
    if (
      requestAnswered({
        published: publishedVolume(state),
        requested,
        settling,
        tolerance: VOLUME_ECHO_TOLERANCE
      })
    ) {
      release();
    }
  };

  const chain = createCommandChain<number>({
    // `setVolume` never rejects: the controller catches a throwing adapter into
    // an `ok: false` result. `Root` makes exactly one controller and keeps it
    // for its lifetime, so the one captured here stays this player's.
    command: (volume) => controller.setVolume(volume),
    onDrained: (ok) => {
      settling = false;
      // A failed command has nothing coming to answer for it.
      if (!ok) {
        release();
        return;
      }
      // A player can publish the volume it was asked for *before* it resolves
      // the command that asked, and `requestAnswered` holds the chain first, so
      // that value answered nothing on the way in. The drain is the only moment
      // left at which it can be recognised.
      reconcile(controller.getState());
      // Armed at the drain, and deliberately not re-armed by a moving published
      // volume: a player that reports volume on its own schedule would push the
      // deadline out forever.
      //
      // Nothing cancels it on teardown either, and that asymmetry with the seek
      // binding is the point rather than an oversight. Seek's timer is
      // re-derived from `[requested, settling]` on every commit, so it has to
      // be cleaned up; this one is armed once, here, and owned by the release
      // paths. Clearing it when `observe()` is torn down — which StrictMode's
      // double-invoke does on every mount in development — would leave a held
      // request with no backstop left to release it, which is the strand the
      // deadline exists to prevent, relocated into the store.
      //
      // A timer outliving the player is harmless: `release` disarms before its
      // `requested === null` guard, so one can only outlive a request that has
      // already gone; React drops `VolumeSlider`'s subscription during unmount,
      // so `listeners` is empty by the time it fires; and nothing here is
      // module-scoped, so it mutates a closure nothing can reach.
      if (requested !== null) {
        deadline = setTimeout(release, ECHO_DEADLINE_MS);
      }
    }
  });

  return {
    getRequested: () => requested,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    request: (volume) => {
      requested = volume;
      settling = true;
      if (deadline !== undefined) {
        clearTimeout(deadline);
        deadline = undefined;
      }
      chain.send(volume);
      listeners.forEach((listener) => listener());
    },
    observe: () =>
      controller.subscribe((state) => {
        if (state.provider !== provider) {
          provider = state.provider;
          // The media the request was aimed at has gone, and the replacement
          // can never answer for it: abandon whatever is still queued, and hand
          // the control back to the player that is loaded now. A kind and not
          // the adapter, so a source swap within one kind does not show up
          // here; the deadline is what releases the request in that case.
          chain.invalidate();
          release();
          return;
        }
        reconcile(state);
      })
  };
};
