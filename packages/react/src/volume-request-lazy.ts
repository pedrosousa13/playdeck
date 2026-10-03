import type { PlayerController } from '@playdeck/core';
import type { VolumeRequest } from './volume-request.js';

// Wraps `createVolumeRequest` behind a dynamic `import()` of its own module
// -- the same split `@playdeck/core/media-session` already landed for
// `root.tsx`'s own mount effect -- so a page that never renders a
// volume-reading part never pays for `volume-request.ts`'s code. `Root`
// used to call `createVolumeRequest` straight from a `useState` initializer,
// which put it on every page regardless of whether `VolumeSlider` or the
// `Controls` shortcut layer's volume keys ever ran. `MuteButton` reaches
// neither this facade nor the controller through it -- it calls
// `controller.toggleMuted()` directly.
//
// Returned as an object of the exact same `VolumeRequest` shape, rather than
// an `undefined` a reader has to narrow, so `PlayerContextValue.volumeRequest`
// and its three consumers (`VolumeSlider`, and the `Controls` shortcut
// layer's `getRequested`/`request` calls) need no change at all -- the only
// thing this changes is when the module behind the facade loads.
//
// `subscribe` and `request` are the two methods real viewer traffic reaches
// -- `VolumeSlider`'s `useSyncExternalStore` subscription on mount, and
// either `VolumeSlider`'s `onChange` or the `Controls` layer's volume keys --
// so those are what start the import: the first of either is "the first
// time something that actually needs it asks for it." `getRequested` and
// `observe` never start it on their own. `observe` is `Root`'s own mount
// effect, called unconditionally on every mount regardless of which parts
// render; starting the import there would put the chunk back on every page,
// exactly the cost this split exists to remove.
//
// A gesture made before the chunk resolves is never lost: `request` records
// it as `pending` and notifies this facade's own listeners immediately, so a
// `VolumeSlider` thumb -- and the `Controls` layer's own base for the next
// press, read through `getRequested` -- shows it at once. Once the module
// resolves, a still-outstanding `pending` value is replayed through the real
// store's own `request`, which is what actually issues the `setVolume`
// command and starts `optimistic-request-volume.ts`'s coalescing chain --
// the private copy `volume-request.ts` imports, not the module `SeekSlider`
// shares with every page's eager graph (`optimistic-request.ts`'s own
// header says why the two are not the same file). The delay is only ever
// the chunk load, never a dropped or reordered gesture -- and a chunk that
// fails to load drops a still-`pending` gesture rather than hold it
// forever unreachable; see the `.catch()` below.
export const createLazyVolumeRequest = (
  controller: PlayerController
): VolumeRequest => {
  let real: VolumeRequest | undefined;
  let pending: number | undefined;
  let observing = false;
  let stopObserving: (() => void) | undefined;
  let started = false;
  // Mirrors the `live` flag `root.tsx`'s own media-session effect closes
  // over: false once `Root` has unmounted, so a resolution arriving after
  // that finds nothing left to hand its binding, its subscription or its
  // replayed command to. Reused from `observe()`'s own cleanup rather than
  // added as a second disposal method, because that cleanup already runs
  // exactly once per real `Root` mount -- `root.tsx`'s
  // `useEffect(() => volumeRequest.observe(), [volumeRequest])` depends only
  // on the facade itself, which is stable for `Root`'s whole lifetime, so
  // the effect's cleanup fires only when `Root` actually unmounts (or, in
  // development, when Strict Mode double-invokes the effect to simulate
  // one). Reset to `true` at the start of `observe()` rather than left
  // false forever, so that simulated remount -- the same component
  // instance, the same facade, mounting again -- finds the facade live
  // again rather than permanently disposed.
  let live = true;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    listeners.forEach((listener) => listener());
  };

  const start = (): void => {
    if (started) return;
    started = true;
    void import('./volume-request.js')
      .then(({ createVolumeRequest }) => {
        // Disposed while the chunk was loading: no binding to construct, no
        // subscription to wire up, no command to replay. `observe()`'s own
        // cleanup already released whatever this facade held at the moment
        // of disposal; there is nothing left here to release a second time.
        if (!live) return;
        real = createVolumeRequest(controller);
        // Bridges every future change on the real store straight to this
        // facade's own listeners. The facade object itself is what `Root`
        // hands out through context and never swaps, so a subscriber's
        // reference stays valid across the handoff -- there is no second
        // object to resubscribe to.
        real.subscribe(notify);
        if (observing) stopObserving = real.observe();
        if (pending !== undefined) {
          const volume = pending;
          pending = undefined;
          // Issues the command and notifies through the bridge above.
          real.request(volume);
        } else {
          // Nothing was asked for while this loaded, but a reader mid-render
          // (`VolumeSlider`'s `getSnapshot`) may be holding a snapshot taken
          // before `real` existed; this is what tells it to look again.
          notify();
        }
      })
      .catch(() => {
        // A chunk that fails to load leaves nothing behind to retry from:
        // `started` resets so the next `subscribe()` or `request()` tries
        // the import again, rather than leaving the facade permanently
        // stuck on its first, failed attempt. A `pending` gesture made
        // while this attempt was in flight is dropped rather than held for
        // a retry nothing has asked for yet -- held, it would show a value
        // the player was never actually asked to reach; released, a reader
        // falls back to whatever the controller itself reports, which is
        // the one value this facade can still vouch for.
        started = false;
        if (pending !== undefined) {
          pending = undefined;
          notify();
        }
      });
  };

  return {
    getRequested: () => (real ? real.getRequested() : (pending ?? null)),
    subscribe: (listener) => {
      start();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    request: (volume) => {
      start();
      if (real) {
        real.request(volume);
        return;
      }
      pending = volume;
      notify();
    },
    observe: () => {
      live = true;
      observing = true;
      if (real) stopObserving = real.observe();
      return () => {
        live = false;
        observing = false;
        stopObserving?.();
        stopObserving = undefined;
      };
    }
  };
};
