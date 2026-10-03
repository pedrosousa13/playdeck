// @vitest-environment node
// Exercises `createLazyVolumeRequest` directly, with the module it dynamically
// imports mocked behind a promise this file arms by hand -- the same
// controllable-promise idea `optimistic-request.test.ts` uses for a command
// still in flight, applied here to a chunk still loading. A real, unmocked
// dynamic import resolves in however many microtask ticks the bundler and
// Node settle on, which is both unspecified and, for a module already in
// the local graph, often one tick -- too fast to reliably observe the
// "before it resolves" window these tests are about.
//
// Armed with `vi.doMock`/`vi.doUnmock`, the non-hoisted pair, rather than a
// hoisted `vi.mock` factory reading mutable state: a hoisted factory is
// evaluated once and its result cached for the rest of the file, confirmed
// directly while writing these tests -- a hoisted factory logging each call
// printed exactly once across six tests that each re-armed the state it
// read, `vi.resetModules()` notwithstanding. `vi.doMock`/`vi.doUnmock` do
// force a fresh resolution; armed once per attempt, immediately before the
// gesture that starts it, so the facade's own `import()` call picks up
// whichever one is current.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type {
  CommandResult,
  PlayerController,
  PlayerState
} from '@playdeck/core';
import { createLazyVolumeRequest } from '../src/volume-request-lazy';

const VOLUME_REQUEST_PATH = '../src/volume-request.js';

// Arms the next attempt to resolve to the real module, so what runs once it
// resolves is the real `createVolumeRequest`, unmocked
// `optimistic-request-volume.ts` chain included.
const armSuccess = async (): Promise<void> => {
  const actual = await vi.importActual(VOLUME_REQUEST_PATH);
  vi.doUnmock(VOLUME_REQUEST_PATH);
  vi.resetModules();
  vi.doMock(VOLUME_REQUEST_PATH, () => actual);
};

// Arms the next attempt to reject, standing in for a chunk that fails to
// load.
const armFailure = (): void => {
  vi.doUnmock(VOLUME_REQUEST_PATH);
  vi.resetModules();
  vi.doMock(VOLUME_REQUEST_PATH, () =>
    Promise.reject(new Error('chunk failed to load'))
  );
};

// Waits for the currently armed attempt to settle. Awaiting the import
// target directly, rather than only counting ticks, is what makes this
// reliable: a fixed number of timer turns was tried first and measured
// flaky (about one run in four), since how many turns Vitest's own
// module-mock machinery needs on top of the plain microtask a real
// bundler's `import()` would take is not fixed. The two extra ticks after
// it are for the facade's own `.then()`/`.catch()` continuation, queued
// after the import settles rather than before.
const waitForImport = async (): Promise<void> => {
  await import(VOLUME_REQUEST_PATH).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

// The narrow slice of `PlayerController` `volume-request.ts` actually reads:
// `getState().provider` at construction, `setVolume` as the command the
// chain sends, and `subscribe` as what `observe()` wires up.
const createFakeController = (
  initial: Partial<PlayerState> = {}
): PlayerController => {
  const state = {
    provider: null,
    muted: false,
    volume: 0.5,
    ...initial
  } as PlayerState;
  return {
    getState: () => state,
    setVolume: vi.fn((): Promise<CommandResult> =>
      Promise.resolve({ ok: true })
    ),
    subscribe: vi.fn(() => () => {})
  } as unknown as PlayerController;
};

beforeEach(async () => {
  await armSuccess();
});

afterEach(() => {
  vi.doUnmock(VOLUME_REQUEST_PATH);
});

describe('createLazyVolumeRequest', () => {
  // The case the issue's own acceptance criteria names: a volume-reading
  // part can mount and unmount before the chunk the facade imports has
  // resolved at all.
  //
  // Demonstrated red: with the `observing` guard in `volume-request-lazy.ts`
  // removed (`if (observing) stopObserving = real.observe();` replaced with
  // an unconditional `stopObserving = real.observe();`), this printed:
  //
  //   AssertionError: expected "vi.fn()" to not be called at all, but
  //   actually been called 1 times
  //
  // -- `controller.subscribe` was reached after `observe()`'s own cleanup
  // had already run, which is the leaked subscription this test exists to
  // catch. Restoring the guard returned it to green.
  test('mounting and unmounting before the import resolves leaks no subscription and throws nothing', async () => {
    const controller = createFakeController();
    const lazy = createLazyVolumeRequest(controller);

    const unsubscribe = lazy.subscribe(() => {});
    const stopObserving = lazy.observe();
    // Torn down immediately -- before the chunk below ever resolves, which
    // is the race this test is for.
    unsubscribe();
    stopObserving();

    await waitForImport();

    expect(controller.subscribe).not.toHaveBeenCalled();
    expect(() => lazy.getRequested()).not.toThrow();
  });

  // The other half of the issue's constraint: a gesture made before the
  // chunk resolves must still take effect, not be dropped.
  //
  // Demonstrated red: with the pending replay in `volume-request-lazy.ts`
  // removed (the `if (pending !== undefined) { ...; real.request(volume); }`
  // branch replaced with an unconditional `notify()`, discarding `pending`),
  // this printed:
  //
  //   AssertionError: expected "vi.fn()" to be called with arguments:
  //   [ 0.42 ] (Number of calls: 0)
  //
  // -- the request made before resolution never reached the controller once
  // the module loaded. Restoring the replay returned it to green.
  test('a volume request made before the import resolves still reaches the controller once it does', async () => {
    const controller = createFakeController();
    const lazy = createLazyVolumeRequest(controller);
    const stopObserving = lazy.observe();

    lazy.request(0.42);
    // Shown at once, before the chunk has had any chance to resolve.
    expect(lazy.getRequested()).toBe(0.42);
    expect(controller.setVolume).not.toHaveBeenCalled();

    await waitForImport();

    expect(controller.setVolume).toHaveBeenCalledWith(0.42);
    stopObserving();
  });

  // A second gesture, after the first has already been replayed, exercises
  // the ordinary path once `real` exists -- a guard that the facade keeps
  // forwarding rather than only replaying once.
  test('a second request after the import resolves reaches the controller directly', async () => {
    const controller = createFakeController();
    const lazy = createLazyVolumeRequest(controller);
    const stopObserving = lazy.observe();

    lazy.request(0.3);
    await waitForImport();
    expect(controller.setVolume).toHaveBeenCalledWith(0.3);

    lazy.request(0.9);
    expect(controller.setVolume).toHaveBeenCalledWith(0.9);

    stopObserving();
  });

  // A chunk that fails to load must not strand the control showing a value
  // the player was never actually asked to reach.
  //
  // Demonstrated red: with the `.catch()` in `volume-request-lazy.ts`
  // reverted to its original empty body (no `started = false`, no `pending`
  // reset), this printed:
  //
  //   AssertionError: expected 0.9 to be null // Object.is equality
  //
  // -- `getRequested()` kept showing the optimistic value forever, with no
  // command ever reaching the controller to justify it. Restoring the reset
  // returned it to green.
  test('a rejected import drops the pending request, so getRequested falls back once it settles', async () => {
    armFailure();
    const controller = createFakeController();
    const lazy = createLazyVolumeRequest(controller);
    const stopObserving = lazy.observe();

    lazy.request(0.9);
    expect(lazy.getRequested()).toBe(0.9);

    await waitForImport();

    expect(lazy.getRequested()).toBe(null);
    expect(controller.setVolume).not.toHaveBeenCalled();

    stopObserving();
  });

  // The other half of the failure case: a later gesture must not find the
  // facade permanently stuck on its first, failed attempt.
  //
  // Demonstrated red: with only `started = false;` removed from
  // `volume-request-lazy.ts`'s `.catch()` (the `pending` reset left in
  // place, so the first assertion below still passes), this printed:
  //
  //   AssertionError: expected "vi.fn()" to be called with arguments:
  //   [ 0.6 ]
  //
  //   Number of calls: 0
  //
  // -- the retry's own `request(0.6)` found `started` already `true` and
  // never imported anything a second time, so the gesture was recorded as
  // `pending` and then never replayed. Restoring the reset returned it to
  // green.
  test('retries the import on the next gesture after a rejection, and the retry reaches the controller', async () => {
    armFailure();
    const controller = createFakeController();
    const lazy = createLazyVolumeRequest(controller);
    const stopObserving = lazy.observe();

    lazy.request(0.3);
    await waitForImport();
    expect(lazy.getRequested()).toBe(null);

    // The chunk is "reloaded" for the retry.
    await armSuccess();
    lazy.request(0.6);
    expect(lazy.getRequested()).toBe(0.6);
    await waitForImport();

    expect(controller.setVolume).toHaveBeenCalledWith(0.6);
    stopObserving();
  });

  // `Root` can unmount while the chunk is still loading -- `observe()`'s
  // cleanup already covers the subscription half of that (the test above
  // this file started with), but a `pending` gesture is a second thing a
  // late resolution could still act on. Disposal must drop that too.
  //
  // Demonstrated red: with the `if (!live) return;` guard removed from
  // `volume-request-lazy.ts`'s `.then()` callback, this printed:
  //
  //   AssertionError: expected "vi.fn()" to not be called at all, but
  //   actually been called 1 times
  //
  //   Received:
  //     1st vi.fn() call:
  //       Array [
  //         0.7,
  //       ]
  //
  // -- a resolution arriving after disposal replayed the pending request
  // into a controller nothing was watching any more. Restoring the guard
  // returned it to green.
  test('disposal before the import resolves drops a pending request: no command, no subscription', async () => {
    const controller = createFakeController();
    const lazy = createLazyVolumeRequest(controller);
    const stopObserving = lazy.observe();

    lazy.request(0.7);
    expect(lazy.getRequested()).toBe(0.7);

    // `Root` unmounts before the chunk resolves.
    stopObserving();

    await waitForImport();

    expect(controller.setVolume).not.toHaveBeenCalled();
    expect(controller.subscribe).not.toHaveBeenCalled();
  });
});
