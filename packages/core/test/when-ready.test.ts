import { expect, test, vi } from 'vitest';
import {
  PlayerController,
  type CommandResult,
  type PlayerError,
  type ProviderAdapter,
  type ProviderStateListener
} from '../src/index';

const ok = async (): Promise<CommandResult> => ({ ok: true });

/**
 * An adapter shaped like the SDK-backed providers rather than like the native
 * one: its command guards stay shut until `load()` has run, because that is
 * where YouTube and Vimeo create the underlying player. Attaching the adapter
 * is not the moment commands start working, and a signal that settles on
 * assignment is wrong for three of the four shipped providers.
 */
const createSdkAdapter = () => {
  const listeners = new Set<ProviderStateListener>();
  let loaded = false;
  const guarded = vi.fn(async (): Promise<CommandResult> =>
    loaded ? { ok: true } : { ok: false, reason: 'not-ready' }
  );
  const adapter: ProviderAdapter = {
    provider: 'youtube',
    attach: () => {},
    load: () => {
      loaded = true;
    },
    destroy: () => {},
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    play: ok,
    pause: ok,
    setPlaybackRate: guarded
  };
  const emitReady = () =>
    listeners.forEach((listener) =>
      listener({ lifecycle: 'ready', activation: 'ready' })
    );
  return { adapter, guarded, emitReady };
};

const recoverable: PlayerError = {
  category: 'unsupported',
  fatal: false,
  recoverable: true,
  message: 'No source yet.'
};

const terminal: PlayerError = {
  category: 'source',
  fatal: true,
  recoverable: false,
  message: 'No provider could play this source.'
};

// Commands issued before the player is ready are refused with `not-ready`, and
// nothing queues them. `whenReady` is the signal that makes that refusal
// something a consumer can program against rather than discover.

test('a command issued the moment it resolves is actually accepted', async () => {
  const controller = new PlayerController();
  const { adapter, guarded, emitReady } = createSdkAdapter();

  const applied = controller
    .whenReady()
    .then(() => controller.setPlaybackRate(0.25));

  controller.setProvider(adapter);
  emitReady();

  // The whole contract in one assertion: no `not-ready` on the other side.
  await expect(applied).resolves.toEqual({ ok: true });
  expect(guarded).toHaveBeenCalledTimes(1);
});

test('does not resolve merely because an adapter was assigned', async () => {
  const controller = new PlayerController();
  const { adapter } = createSdkAdapter();
  let settled = false;
  void controller.whenReady().then(() => (settled = true));

  controller.setProvider(adapter);
  await Promise.resolve();
  await Promise.resolve();

  // Assignment is not readiness: the SDK players are built in `load()`.
  expect(settled).toBe(false);
});

test('resolves immediately when the player is already ready', async () => {
  const controller = new PlayerController();
  const { adapter, emitReady } = createSdkAdapter();
  controller.setProvider(adapter);
  emitReady();

  await expect(controller.whenReady()).resolves.toEqual({ ok: true });
});

test('resolves with the failure when the player fails terminally', async () => {
  const controller = new PlayerController();
  const ready = controller.whenReady();

  controller.setActivation({ activation: 'error', error: terminal });

  // Never left pending on a player that will never become ready.
  await expect(ready).resolves.toEqual({
    ok: false,
    reason: 'provider-error',
    error: terminal
  });
});

test('ignores a recoverable error and resolves when the player recovers', async () => {
  const controller = new PlayerController();
  const { adapter, emitReady } = createSdkAdapter();
  let settled: CommandResult | undefined;
  const ready = controller.whenReady().then((r) => (settled = r));

  // The ordinary `source={data?.url ?? ''}` shape: the React layer reports an
  // error activation for a source that has not arrived yet, and it heals on
  // the next render. Reporting that as a permanent failure would make the
  // documented `if (ready.ok)` pattern silently skip the preference.
  controller.setActivation({ activation: 'error', error: recoverable });
  await Promise.resolve();
  expect(settled).toBeUndefined();

  controller.setProvider(adapter);
  emitReady();

  await expect(ready).resolves.toEqual({ ok: true });
});

test('resolves immediately when the player has already failed terminally', async () => {
  const controller = new PlayerController();
  controller.setActivation({ activation: 'error', error: terminal });

  await expect(controller.whenReady()).resolves.toMatchObject({ ok: false });
});

test('a later attempt still resolves waiters created after a failure', async () => {
  const controller = new PlayerController();
  controller.setActivation({ activation: 'error', error: terminal });
  await controller.whenReady();

  controller.setActivation({ activation: 'eligible' });
  const { adapter, emitReady } = createSdkAdapter();
  const ready = controller.whenReady();
  controller.setProvider(adapter);
  emitReady();

  await expect(ready).resolves.toEqual({ ok: true });
});

test('settles pending waiters when the provider is detached', async () => {
  const controller = new PlayerController();
  const { adapter } = createSdkAdapter();
  controller.setProvider(adapter);
  const ready = controller.whenReady();

  // React unmount detaches the provider. A waiter left pending here holds its
  // closure and never runs, which is what the docs promise never happens.
  controller.setProvider(undefined);

  await expect(ready).resolves.toEqual({ ok: false, reason: 'not-ready' });
});

test('every pending waiter resolves, not just the first', async () => {
  const controller = new PlayerController();
  const { adapter, emitReady } = createSdkAdapter();
  const first = controller.whenReady();
  const second = controller.whenReady();

  controller.setProvider(adapter);
  emitReady();

  await expect(Promise.all([first, second])).resolves.toEqual([
    { ok: true },
    { ok: true }
  ]);
});

test('keeps its answer once given, across later transitions', async () => {
  const controller = new PlayerController();
  const { adapter, emitReady } = createSdkAdapter();
  const seen: CommandResult[] = [];
  const ready = controller.whenReady().then((r) => {
    seen.push(r);
    return r;
  });

  controller.setProvider(adapter);
  emitReady();
  await ready;

  // Detach and come back. A waiter is answered once; the churn afterwards must
  // not reach it again, and a caller asking now sees the current state rather
  // than the old answer.
  controller.setProvider(undefined);
  const afterDetach = controller.whenReady();
  const second = createSdkAdapter();
  controller.setProvider(second.adapter);
  second.emitReady();

  expect(seen).toEqual([{ ok: true }]);
  await expect(afterDetach).resolves.toEqual({ ok: true });
});
