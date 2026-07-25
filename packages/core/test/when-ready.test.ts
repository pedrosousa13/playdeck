import { expect, test, vi } from 'vitest';
import {
  PlayerController,
  type CommandResult,
  type PlayerError,
  type ProviderAdapter
} from '../src/index';

const ok = async (): Promise<CommandResult> => ({ ok: true });

const createAdapter = (): ProviderAdapter => ({
  provider: 'native',
  attach: () => {},
  load: () => {},
  destroy: () => {},
  subscribe: () => () => {},
  play: ok,
  pause: ok,
  setPlaybackRate: vi.fn(ok)
});

const failure: PlayerError = {
  category: 'source',
  fatal: true,
  recoverable: false,
  message: 'No provider could play this source.'
};

// Commands issued before a provider attaches are refused with `not-ready`, and
// nothing queues them. `whenReady` is the signal that makes that refusal
// something a consumer can program against rather than discover.

test('resolves once a provider is attached', async () => {
  const controller = new PlayerController();
  let settled: CommandResult | undefined;
  const ready = controller.whenReady().then((result) => (settled = result));

  controller.setActivation({ activation: 'loading-provider' });
  await Promise.resolve();
  expect(settled).toBeUndefined();

  controller.setProvider(createAdapter());

  await expect(ready).resolves.toEqual({ ok: true });
});

test('resolves immediately when a provider is already attached', async () => {
  const controller = new PlayerController();
  controller.setProvider(createAdapter());

  await expect(controller.whenReady()).resolves.toEqual({ ok: true });
});

test('a command issued after it resolves is accepted', async () => {
  const controller = new PlayerController();
  const adapter = createAdapter();
  const ready = controller.whenReady();
  controller.setProvider(adapter);

  await ready;

  // The whole point of the signal: this is the first moment the caller can
  // issue a command without being told `not-ready`.
  await expect(controller.setPlaybackRate(0.25)).resolves.toEqual({ ok: true });
  expect(adapter.setPlaybackRate).toHaveBeenCalledWith(0.25);
});

test('resolves with the failure when the player errors before attaching', async () => {
  const controller = new PlayerController();
  const ready = controller.whenReady();

  controller.setActivation({ activation: 'error', error: failure });

  // Never left pending on a player that will never become ready — a promise
  // that hangs forever is worse than one that reports the failure.
  await expect(ready).resolves.toEqual({
    ok: false,
    reason: 'provider-error',
    error: failure
  });
});

test('resolves immediately when the player has already errored', async () => {
  const controller = new PlayerController();
  controller.setActivation({ activation: 'error', error: failure });

  await expect(controller.whenReady()).resolves.toMatchObject({ ok: false });
});

test('a later attach still resolves waiters created after an error', async () => {
  const controller = new PlayerController();
  controller.setActivation({ activation: 'error', error: failure });
  await controller.whenReady();

  // Retry path: the player recovers, and a fresh waiter tracks the new attempt
  // rather than replaying the stale failure.
  controller.setActivation({ activation: 'eligible' });
  const ready = controller.whenReady();
  controller.setProvider(createAdapter());

  await expect(ready).resolves.toEqual({ ok: true });
});

test('every pending waiter resolves, not just the first', async () => {
  const controller = new PlayerController();
  const first = controller.whenReady();
  const second = controller.whenReady();

  controller.setProvider(createAdapter());

  await expect(Promise.all([first, second])).resolves.toEqual([
    { ok: true },
    { ok: true }
  ]);
});
