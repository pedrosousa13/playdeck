// @vitest-environment node

import { expect, test } from 'vitest';
import {
  PlayerController,
  type CommandResult,
  type ProviderAdapter,
  type ProviderStateListener
} from '../src/index';

type FakeProviderOptions = {
  readonly play?: () => Promise<CommandResult>;
};

const createProvider = (options: FakeProviderOptions = {}) => {
  let emit: ProviderStateListener | undefined;
  const provider: ProviderAdapter = {
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: (listener) => {
      emit = listener;
      return () => undefined;
    },
    play: async () => options.play?.() ?? { ok: true },
    pause: async () => ({ ok: true }),
    mute: async () => ({ ok: true })
  };

  return {
    provider,
    emit: (...args: Parameters<ProviderStateListener>) => emit?.(...args)
  };
};

// The shape `provider-native` builds for a `NotAllowedError`, so these tests
// refuse the way a browser refuses rather than the way a fake finds convenient.
const blocked = (): CommandResult => ({
  ok: false,
  reason: 'blocked',
  error: {
    category: 'policy',
    fatal: false,
    recoverable: true,
    message: 'Playback was blocked.'
  }
});

const readyEvent = {
  type: 'ready',
  detail: undefined,
  origin: 'provider'
} as const;

const playEvent = {
  type: 'play',
  detail: undefined,
  origin: 'provider'
} as const;

const flushCommands = () => new Promise((resolve) => setTimeout(resolve, 0));

test('publishes a refused play command with the origin that issued it', async () => {
  const fake = createProvider({ play: async () => blocked() });
  const controller = new PlayerController();
  controller.setProvider(fake.provider);

  await controller.play();

  expect(controller.getState().refusedPlay).toEqual({
    origin: 'api',
    reason: 'blocked'
  });
});

test('leaves playback, autoplay and the error slot where a refused play found them', async () => {
  const fake = createProvider({ play: async () => blocked() });
  const controller = new PlayerController();
  controller.setProvider(fake.provider);

  const result = await controller.play();

  expect(result).toEqual(blocked());
  expect(controller.getState()).toMatchObject({
    playback: 'paused',
    autoplay: 'idle',
    error: null
  });
});

test('names why a play was refused, so a fault is not read as a policy refusal', async () => {
  const fake = createProvider({
    play: async () => ({ ok: false, reason: 'provider-error' })
  });
  const controller = new PlayerController();
  controller.setProvider(fake.provider);

  await controller.play();

  expect(controller.getState().refusedPlay).toEqual({
    origin: 'api',
    reason: 'provider-error'
  });
});

test('clears the refusal once a provider patch confirms playback', async () => {
  const fake = createProvider({ play: async () => blocked() });
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  await controller.play();

  fake.emit({ playback: 'playing' }, playEvent);

  expect(controller.getState().refusedPlay).toBeNull();
});

test('keeps the refusal standing while nothing has played since', async () => {
  const fake = createProvider({ play: async () => blocked() });
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  await controller.play();

  fake.emit({ buffering: true });
  fake.emit({ currentTime: 4 });

  expect(controller.getState().refusedPlay).toEqual({
    origin: 'api',
    reason: 'blocked'
  });
});

test('clears the refusal when the provider is replaced', async () => {
  const fake = createProvider({ play: async () => blocked() });
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  await controller.play();

  controller.setProvider(createProvider().provider);

  expect(controller.getState().refusedPlay).toBeNull();
});

test('clears the refusal when the provider detaches', async () => {
  const fake = createProvider({ play: async () => blocked() });
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  await controller.play();

  controller.setProvider(undefined);

  expect(controller.getState().refusedPlay).toBeNull();
  // The detached state has to stay the initial one, which is what
  // `source.test.ts` pins for every other field on it.
  fake.emit({ currentTime: 9 });
  expect(controller.getState().refusedPlay).toBeNull();
});

test('ignores a refusal a provider writes into its own patch', () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);

  fake.emit({ refusedPlay: { origin: 'user', reason: 'blocked' } });

  expect(controller.getState().refusedPlay).toBeNull();
});

test('publishes a refused autoplay attempt as the autoplay origin refusing', async () => {
  const fake = createProvider({ play: async () => blocked() });
  const controller = new PlayerController();
  controller.configureAutoplay('audible');
  controller.setProvider(fake.provider);
  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);

  await flushCommands();

  expect(controller.getState()).toMatchObject({
    autoplay: 'blocked',
    refusedPlay: { origin: 'autoplay', reason: 'blocked' }
  });
});

test('clears the refused audible attempt once the muted retry plays', async () => {
  let attempts = 0;
  const fake = createProvider({
    play: async () => (++attempts === 1 ? blocked() : { ok: true })
  });
  const controller = new PlayerController();
  controller.configureAutoplay('audible-then-muted');
  controller.setProvider(fake.provider);
  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
  await flushCommands();

  fake.emit({ playback: 'playing' }, playEvent);

  expect(controller.getState()).toMatchObject({
    autoplay: 'started',
    autoplayRecovered: true,
    refusedPlay: null
  });
});
