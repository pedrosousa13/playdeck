// @vitest-environment node

import { expect, test } from 'vitest';
import {
  PlayerController,
  type PlayerError,
  type ProviderAdapter,
  type ProviderStateListener
} from '../src/index';

const createProvider = (provider: ProviderAdapter['provider'] = 'native') => {
  let emit: ProviderStateListener | undefined;
  const adapter: ProviderAdapter = {
    provider,
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: (listener) => {
      emit = listener;
      return () => undefined;
    }
  };

  return {
    provider: adapter,
    emit: (...args: Parameters<ProviderStateListener>) => emit?.(...args)
  };
};

// Stands in for what a provider-side validation rejection publishes: non-fatal,
// `configuration`, and never recoverable by a retry (#235).
const hostNotice: PlayerError = {
  category: 'configuration',
  fatal: false,
  recoverable: false,
  message: 'The host option was rejected, so the default host was used.'
};

const posterNotice: PlayerError = {
  category: 'configuration',
  fatal: false,
  recoverable: false,
  message: 'The poster option was rejected, so no poster was applied.'
};

const fatalError: PlayerError = {
  category: 'decode',
  fatal: true,
  recoverable: false,
  message: 'The provider could not decode the media.'
};

const autoplayConflictMessage =
  'Muted autoplay conflicts with a controlled unmuted state.';

const flushCommands = () => new Promise((resolve) => setTimeout(resolve, 0));

test('publishes a configuration notice without moving the lifecycle', () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  const before = controller.getState();

  fake.emit({ error: hostNotice });

  expect(controller.getState()).toMatchObject({
    lifecycle: before.lifecycle,
    activation: before.activation,
    error: hostNotice
  });
  expect(controller.getState().lifecycle).not.toBe('error');
});

test('keeps the notice published through a later ready patch', () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);

  fake.emit({ error: hostNotice });
  fake.emit({ lifecycle: 'ready', activation: 'ready' });

  expect(controller.getState()).toMatchObject({
    lifecycle: 'ready',
    activation: 'ready',
    error: hostNotice
  });
});

test('lets a fatal error emitted after a notice take the slot', () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);

  fake.emit({ error: hostNotice });
  fake.emit({ lifecycle: 'error', activation: 'error', error: fatalError });

  expect(controller.getState()).toMatchObject({
    lifecycle: 'error',
    error: fatalError
  });

  fake.emit({ currentTime: 5 });

  expect(controller.getState().error).toMatchObject(fatalError);
});

test('does not let a notice displace a fatal error that already stands', () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);

  fake.emit({ lifecycle: 'error', activation: 'error', error: fatalError });
  fake.emit({ error: hostNotice });

  expect(controller.getState()).toMatchObject({
    lifecycle: 'error',
    activation: 'error',
    error: fatalError
  });
});

test('holds the first notice and ignores a later one', () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);

  fake.emit({ error: hostNotice });
  fake.emit({ error: posterNotice });

  expect(controller.getState().error).toMatchObject(hostNotice);

  fake.emit({ lifecycle: 'ready', activation: 'ready' });

  expect(controller.getState().error).toMatchObject(hostNotice);
});

test('outranks a held notice with the muted-autoplay conflict', () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);

  fake.emit({ error: hostNotice });
  controller.configureAutoplay('muted', { controlledMuted: false });

  expect(controller.getState()).toMatchObject({
    autoplay: 'failed',
    error: { category: 'configuration', message: autoplayConflictMessage }
  });

  controller.configureAutoplay('muted', { controlledMuted: true });

  expect(controller.getState()).toMatchObject({
    autoplay: 'idle',
    error: hostNotice
  });
});

test('keeps the notice through an autoplay change that raises no conflict', () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);

  fake.emit({ error: hostNotice });
  controller.configureAutoplay('audible');

  expect(controller.getState().error).toMatchObject(hostNotice);
});

test('drops the held notice when the provider changes or detaches', () => {
  const first = createProvider();
  const second = createProvider('vimeo');
  const controller = new PlayerController();
  controller.setProvider(first.provider);

  first.emit({ error: hostNotice });
  controller.setProvider(second.provider);

  expect(controller.getState().error).toBeNull();

  second.emit({ error: posterNotice });

  expect(controller.getState().error).toMatchObject(posterNotice);

  controller.setProvider(undefined);

  expect(controller.getState().error).toBeNull();
});

test('a notice neither settles the ready waiters nor withdraws commands', async () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  let settled: boolean | undefined;
  void controller.whenReady().then((ready) => (settled = ready));

  fake.emit({ error: hostNotice });
  await flushCommands();

  expect(settled).toBeUndefined();
  expect(controller.getState().commandsReady).toBe(false);

  fake.emit({ lifecycle: 'ready', activation: 'ready', commandsReady: true });
  await flushCommands();

  expect(settled).toBe(true);
  expect(controller.getState()).toMatchObject({
    commandsReady: true,
    error: hostNotice
  });
});
