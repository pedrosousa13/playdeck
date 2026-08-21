// @vitest-environment node

import { expect, test, vi } from 'vitest';
import {
  PlayerController,
  type CommandResult,
  type ProviderAdapter,
  type ProviderStateListener,
  type ProviderStatePatch
} from '../src/index';

type FakeProviderOptions = {
  readonly play?: () => Promise<CommandResult>;
};

const createProvider = (options: FakeProviderOptions = {}) => {
  let emit: ProviderStateListener | undefined;
  const calls: string[] = [];
  const provider: ProviderAdapter = {
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: (listener) => {
      emit = listener;
      return () => undefined;
    },
    play: async () => {
      calls.push('play');
      return options.play?.() ?? { ok: true };
    },
    pause: async () => ({ ok: true }),
    mute: async () => {
      calls.push('mute');
      return { ok: true };
    }
  };

  return {
    calls,
    provider,
    emit: (...args: Parameters<ProviderStateListener>) => emit?.(...args)
  };
};

const deferred = <Value>() => {
  let resolve: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((next) => (resolve = next));
  return { promise, resolve: (value: Value) => resolve?.(value) };
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

// The four transitions the clearing rule names as leaving a refusal standing —
// a pause, a seek, a stall and an error — each emitted as the patch a provider
// reports it with, because a rule stated in those terms is only pinned by a
// test that emits them (#361).
test.each<[string, ProviderStatePatch]>([
  ['a pause', { playback: 'paused' }],
  ['a seek', { seeking: true, currentTime: 4 }],
  ['a stall', { buffering: true }],
  [
    'an error',
    {
      lifecycle: 'error',
      error: {
        category: 'decode',
        fatal: true,
        recoverable: false,
        message: 'The media failed to decode.'
      }
    }
  ]
])(
  'keeps the refusal standing through %s, which is not something playing',
  async (_transition, patch) => {
    const fake = createProvider({ play: async () => blocked() });
    const controller = new PlayerController();
    controller.setProvider(fake.provider);
    await controller.play();

    fake.emit(patch);

    expect(controller.getState().refusedPlay).toEqual({
      origin: 'api',
      reason: 'blocked'
    });
  }
);

test('keeps the refusal cleared when the viewer pauses a play that started', async () => {
  const fake = createProvider({ play: async () => blocked() });
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  await controller.play();
  fake.emit({ playback: 'playing' }, playEvent);

  fake.emit({ playback: 'paused' });

  expect(controller.getState().refusedPlay).toBeNull();
});

// The out-of-order settlement: two play commands overlap, the later one starts
// playback, and the earlier one only then reports that it was refused. The
// field says the LAST play command was refused and nothing has played since,
// and both halves of that are false for the command settling here.
test('drops a refusal from a play command a later play outlived', async () => {
  const first = deferred<CommandResult>();
  let plays = 0;
  const fake = createProvider({
    play: () => (++plays === 1 ? first.promise : Promise.resolve({ ok: true }))
  });
  const controller = new PlayerController();
  controller.setProvider(fake.provider);

  const refused = controller.play();
  await controller.play();
  fake.emit({ playback: 'playing' }, playEvent);
  fake.emit({ playback: 'paused' });
  first.resolve(blocked());
  await refused;

  expect(controller.getState().refusedPlay).toBeNull();
});

// The same invariant with a single command: nothing superseded it, but playback
// was confirmed while it was still in flight — the viewer worked the provider's
// own controls — so a refusal it reports afterwards is not the last word.
test('drops a refusal from a play command playback outran', async () => {
  const pending = deferred<CommandResult>();
  const fake = createProvider({ play: () => pending.promise });
  const controller = new PlayerController();
  controller.setProvider(fake.provider);

  const refused = controller.play();
  fake.emit({ playback: 'playing' }, playEvent);
  fake.emit({ playback: 'paused' });
  pending.resolve(blocked());
  await refused;

  expect(controller.getState().refusedPlay).toBeNull();
});

// #361 decided this deliberately: see the comment on the guard in
// `#playWithOrigin`.
test('holds no refusal while playback is confirmed playing', async () => {
  const fake = createProvider({ play: async () => blocked() });
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  fake.emit({ playback: 'playing' }, playEvent);

  await controller.play();

  expect(controller.getState().refusedPlay).toBeNull();
});

// And decides it in the guard rather than by publishing a refusal and having
// the clearing rule take it away again: a snapshot nothing can be read from is
// still a snapshot every subscriber is woken for.
test('publishes no snapshot for a refusal it does not hold', async () => {
  const fake = createProvider({ play: async () => blocked() });
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  fake.emit({ playback: 'playing' }, playEvent);
  // `subscribe` hands the current snapshot over on the spot, so the one call
  // this expects is that handshake, and any second one is a publication.
  const seen = vi.fn();
  controller.subscribe(seen);

  await controller.play();

  expect(seen).toHaveBeenCalledTimes(1);
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

  await vi.waitFor(() => expect(fake.calls).toEqual(['play']));
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
  // The chain is play, mute, play, so waiting on the retry reaching the
  // provider is what makes the patch below land on a started retry rather than
  // on whichever step a bare flush happened to leave in flight.
  await vi.waitFor(() => expect(fake.calls).toEqual(['play', 'mute', 'play']));

  fake.emit({ playback: 'playing' }, playEvent);

  expect(controller.getState()).toMatchObject({
    autoplay: 'started',
    autoplayRecovered: true,
    refusedPlay: null
  });
});
