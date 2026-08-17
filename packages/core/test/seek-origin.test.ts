// @vitest-environment node

import { expect, test } from 'vitest';
import {
  PlayerController,
  type CommandResult,
  type PlayerError,
  type PlayerEventOrigin,
  type ProviderAdapter,
  type ProviderStateListener
} from '../src/index';

type FakeProviderOptions = {
  readonly provider?: ProviderAdapter['provider'];
  readonly seek?: () => Promise<CommandResult>;
};

const createProvider = (options: FakeProviderOptions = {}) => {
  let emit: ProviderStateListener | undefined;
  const calls: string[] = [];
  const provider: ProviderAdapter = {
    provider: options.provider ?? 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: (listener) => {
      emit = listener;
      return () => undefined;
    },
    play: async () => ({ ok: true }),
    pause: async () => ({ ok: true }),
    seekTo: async (time) => {
      calls.push(`seekTo:${time}`);
      return options.seek?.() ?? { ok: true };
    },
    seekBy: async (offset) => {
      calls.push(`seekBy:${offset}`);
      return options.seek?.() ?? { ok: true };
    }
  };

  return {
    calls,
    provider,
    emit: (...args: Parameters<ProviderStateListener>) => emit?.(...args)
  };
};

const seekingEvent = (currentTime: number) =>
  ({ type: 'seeking', detail: { currentTime }, origin: 'provider' }) as const;

const seekedEvent = (currentTime: number) =>
  ({ type: 'seeked', detail: { currentTime }, origin: 'provider' }) as const;

const playEvent = {
  type: 'play',
  detail: undefined,
  origin: 'provider'
} as const;

const mediaError: PlayerError = {
  category: 'decode',
  fatal: true,
  recoverable: false,
  message: 'decode failed'
};

const recordSeekOrigins = (controller: PlayerController) => {
  const origins: PlayerEventOrigin[] = [];
  controller.on('seeking', (event) => origins.push(event.origin));
  controller.on('seeked', (event) => origins.push(event.origin));
  return origins;
};

// A provider that reports both halves of a seek, which is what the native and
// Vimeo adapters do.
const reportSeek = (
  fake: ReturnType<typeof createProvider>,
  time: number
): void => {
  fake.emit({ seeking: true }, seekingEvent(time));
  fake.emit({ seeking: false, currentTime: time }, seekedEvent(time));
};

test('labels a requested seek with the origin the command carried', async () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  const origins = recordSeekOrigins(controller);

  await controller.seekToWithOrigin(30, 'user');
  reportSeek(fake, 30);

  expect(origins).toEqual(['user', 'user']);
});

test('labels an untagged seek command as api', async () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  const origins = recordSeekOrigins(controller);

  await controller.seekTo(30);
  reportSeek(fake, 30);

  expect(origins).toEqual(['api', 'api']);
});

test('labels a requested relative seek with the origin the command carried', async () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  const origins = recordSeekOrigins(controller);

  await controller.seekByWithOrigin(-10, 'user');
  reportSeek(fake, 20);

  expect(origins).toEqual(['user', 'user']);
});

test('labels an untagged relative seek command as api', async () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  const origins = recordSeekOrigins(controller);

  await controller.seekBy(10);
  reportSeek(fake, 40);

  expect(origins).toEqual(['api', 'api']);
});

// The Wistia shape: `seeking` is never published, and only the settled half of
// the seek reaches the controller.
test('labels a requested seek reported only once it has settled', async () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  const origins = recordSeekOrigins(controller);

  await controller.seekToWithOrigin(30, 'user');
  fake.emit({ seeking: false, currentTime: 30 }, seekedEvent(30));

  expect(origins).toEqual(['user']);
});

test('leaves a seek the library did not request as provider', () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  const origins = recordSeekOrigins(controller);

  reportSeek(fake, 30);

  expect(origins).toEqual(['provider', 'provider']);
});

test('does not label a second seek with a consumed origin', async () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  const origins = recordSeekOrigins(controller);

  await controller.seekToWithOrigin(30, 'user');
  reportSeek(fake, 30);
  reportSeek(fake, 45);

  expect(origins).toEqual(['user', 'user', 'provider', 'provider']);
});

test('clears the pending seek origin when the seek command fails', async () => {
  const fake = createProvider({
    seek: async () => ({ ok: false, reason: 'provider-error' })
  });
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  const origins = recordSeekOrigins(controller);

  await controller.seekToWithOrigin(30, 'user');
  reportSeek(fake, 12);

  expect(origins).toEqual(['provider', 'provider']);
});

test('does not carry a pending seek origin across provider replacement', async () => {
  const first = createProvider({ provider: 'native' });
  const second = createProvider({ provider: 'hls' });
  const controller = new PlayerController();
  controller.setProvider(first.provider);
  const origins = recordSeekOrigins(controller);

  await controller.seekToWithOrigin(30, 'user');
  controller.setProvider(second.provider);
  reportSeek(second, 30);

  expect(origins).toEqual(['provider', 'provider']);
});

// The native and HLS adapters both reset `seeking` inside the patch that
// reports a fatal error. That patch confirms no seek — it is the seek report,
// not the presence of a `seeking` key, that a pending origin waits for.
test('does not let an error patch consume a pending seek origin', async () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  const origins = recordSeekOrigins(controller);

  await controller.seekToWithOrigin(30, 'user');
  fake.emit(
    {
      lifecycle: 'error',
      activation: 'error',
      playback: 'paused',
      buffering: false,
      seeking: false,
      error: mediaError
    },
    { type: 'error', detail: mediaError, origin: 'provider' }
  );
  reportSeek(fake, 30);

  expect(origins).toEqual(['user', 'user']);
});

test('does not carry a pending seek origin across a detach and reattach', async () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  const origins = recordSeekOrigins(controller);

  await controller.seekToWithOrigin(30, 'user');
  controller.setProvider(undefined);
  controller.setProvider(fake.provider);
  reportSeek(fake, 30);

  expect(origins).toEqual(['provider', 'provider']);
});

// A lifecycle failure advances the generation without swapping the provider,
// which is the one route to a new generation that `setProvider`'s own clear
// does not already cover. Nothing outstanding against the generation that
// failed survives it, so no later report can be labelled from it.
test('does not carry a pending seek origin across a generation bump', async () => {
  let emit: ProviderStateListener | undefined;
  const seeks: number[] = [];
  const controller = new PlayerController();
  const origins = recordSeekOrigins(controller);
  // The seek has to be asked for inside the window the failure closes: the
  // loading state is published before `subscribe()` is called, and a subscriber
  // can issue a command from it.
  const stopSubscribing = controller.subscribe((state) => {
    if (state.lifecycle === 'loading') {
      void controller.seekToWithOrigin(30, 'user');
    }
  });
  controller.setProvider({
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    seekTo: async (time) => {
      seeks.push(time);
      return { ok: true };
    },
    subscribe: (listener) => {
      emit = listener;
      throw new Error('subscribe failed');
    }
  });
  stopSubscribing();
  await Promise.resolve();

  // The seek did reach the provider, so an origin really was left outstanding
  // for the generation the failure ended.
  expect(seeks).toEqual([30]);
  emit?.({ seeking: true }, seekingEvent(30));
  emit?.({ seeking: false, currentTime: 30 }, seekedEvent(30));

  expect(origins).toEqual([]);
});

// The two pending origins are kept apart: a seek issued while a play command is
// still settling must not evict the play's origin, nor take it on.
test('keeps a pending seek origin apart from a pending playback origin', async () => {
  const fake = createProvider();
  const controller = new PlayerController();
  const playOrigins: PlayerEventOrigin[] = [];
  controller.on('play', (event) => playOrigins.push(event.origin));
  controller.setProvider(fake.provider);
  const seekOrigins = recordSeekOrigins(controller);

  await controller.playWithOrigin('user');
  await controller.seekTo(30);
  reportSeek(fake, 30);
  fake.emit({ playback: 'playing' }, playEvent);

  expect(seekOrigins).toEqual(['api', 'api']);
  expect(playOrigins).toEqual(['user']);
});

test('publishes the origin of the seek in flight beside seeking', async () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  expect(controller.getState().seekOrigin).toBeNull();

  await controller.seekToWithOrigin(30, 'user');
  fake.emit({ seeking: true }, seekingEvent(30));
  expect(controller.getState()).toMatchObject({
    seeking: true,
    seekOrigin: 'user'
  });

  fake.emit({ seeking: false, currentTime: 30 }, seekedEvent(30));
  expect(controller.getState()).toMatchObject({
    seeking: false,
    seekOrigin: null
  });
});

test('publishes provider as the origin of a seek the library did not request', () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);

  fake.emit({ seeking: true }, seekingEvent(30));

  expect(controller.getState()).toMatchObject({
    seeking: true,
    seekOrigin: 'provider'
  });
});

test('holds the seek origin across a patch that leaves seeking alone', async () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);

  await controller.seekToWithOrigin(30, 'user');
  fake.emit({ seeking: true }, seekingEvent(30));
  fake.emit({ buffering: true });

  expect(controller.getState()).toMatchObject({
    seeking: true,
    seekOrigin: 'user'
  });
});
