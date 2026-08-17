// @vitest-environment node

import { expect, test, vi } from 'vitest';
import {
  PlayerController,
  type AutoplayMode,
  type CommandResult,
  type ProviderAdapter,
  type PlayerEventOrigin,
  type ProviderStateListener
} from '../src/index';

type FakeProviderOptions = {
  readonly provider?: ProviderAdapter['provider'];
  readonly play?: () => Promise<CommandResult>;
  readonly mute?: () => Promise<CommandResult>;
};

const createProvider = (options: FakeProviderOptions = {}) => {
  let emit: ProviderStateListener | undefined;
  let playCalls = 0;
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
    play: async () => {
      calls.push('play');
      playCalls += 1;
      return options.play?.() ?? { ok: true };
    },
    mute: async () => {
      calls.push('mute');
      return options.mute?.() ?? { ok: true };
    }
  };

  return {
    calls,
    provider,
    emit: (...args: Parameters<ProviderStateListener>) => emit?.(...args),
    getPlayCalls: () => playCalls
  };
};

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

const deferred = <Value>() => {
  let resolve: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((next) => (resolve = next));
  return {
    promise,
    resolve: (value: Value) => resolve?.(value)
  };
};

const flushCommands = () => new Promise((resolve) => setTimeout(resolve, 0));

test('does not attempt autoplay when it is disabled', () => {
  const mode: AutoplayMode = false;
  const fake = createProvider();
  const controller = new PlayerController();

  controller.configureAutoplay(mode);
  controller.setProvider(fake.provider);
  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);

  expect(fake.getPlayCalls()).toBe(0);
  expect(controller.getState().autoplay).toBe('idle');
});

test('reports a non-recoverable configuration error for controlled unmuted autoplay', () => {
  const fake = createProvider();
  const controller = new PlayerController();

  controller.configureAutoplay('muted', { controlledMuted: false });
  controller.setProvider(fake.provider);
  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);

  expect(controller.getState()).toMatchObject({
    lifecycle: 'ready',
    activation: 'ready',
    autoplay: 'failed',
    error: { category: 'configuration', fatal: false, recoverable: false }
  });
  expect(fake.getPlayCalls()).toBe(0);
});

test('ignores adversarial provider autoplay patches while disabled', () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.configureAutoplay(false);
  controller.setProvider(fake.provider);

  fake.emit({ autoplay: 'started' });
  fake.emit({ autoplay: 'blocked', playback: 'playing' }, playEvent);

  expect(controller.getState().autoplay).toBe('idle');
});

test('requires an attempting state and playing patch before autoplay starts', async () => {
  const pendingPlay = deferred<CommandResult>();
  const fake = createProvider({ play: () => pendingPlay.promise });
  const controller = new PlayerController();
  controller.configureAutoplay('audible');
  controller.setProvider(fake.provider);

  fake.emit({ autoplay: 'started' });
  expect(controller.getState().autoplay).toBe('idle');

  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
  await vi.waitFor(() => expect(fake.calls).toEqual(['play']));
  fake.emit({ autoplay: 'started' });
  expect(controller.getState().autoplay).toBe('attempting');

  fake.emit({ autoplay: 'failed', playback: 'playing' }, playEvent);
  expect(controller.getState().autoplay).toBe('started');
  pendingPlay.resolve({ ok: true });
});

test('keeps authoritative started state when the play promise later rejects', async () => {
  const pendingPlay = deferred<CommandResult>();
  const fake = createProvider({ play: () => pendingPlay.promise });
  const controller = new PlayerController();
  controller.configureAutoplay('audible');
  controller.setProvider(fake.provider);
  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
  await vi.waitFor(() => expect(fake.calls).toEqual(['play']));

  fake.emit({ playback: 'playing' }, playEvent);
  expect(controller.getState().autoplay).toBe('started');
  pendingPlay.resolve({ ok: false, reason: 'blocked' });
  await flushCommands();

  expect(controller.getState()).toMatchObject({
    playback: 'playing',
    autoplay: 'started',
    error: null
  });
});

test('does not play after autoplay is disabled during deferred mute', async () => {
  const pendingMute = deferred<CommandResult>();
  const fake = createProvider({ mute: () => pendingMute.promise });
  const controller = new PlayerController();
  controller.configureAutoplay('muted');
  controller.setProvider(fake.provider);
  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
  await vi.waitFor(() => expect(fake.calls).toEqual(['mute']));

  controller.configureAutoplay(false);
  pendingMute.resolve({ ok: true });
  await flushCommands();

  expect(fake.calls).toEqual(['mute']);
  expect(controller.getState().autoplay).toBe('idle');
});

test('rechecks autoplay configuration after attempting state publication', () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.configureAutoplay('audible');
  controller.subscribe((state) => {
    if (state.autoplay === 'attempting') controller.configureAutoplay(false);
  });
  controller.setProvider(fake.provider);

  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);

  expect(fake.calls).toEqual([]);
  expect(controller.getState().autoplay).toBe('idle');
});

test('ignores a deferred play failure after autoplay is disabled', async () => {
  const pendingPlay = deferred<CommandResult>();
  const fake = createProvider({ play: () => pendingPlay.promise });
  const controller = new PlayerController();
  controller.configureAutoplay('audible');
  controller.setProvider(fake.provider);
  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
  await vi.waitFor(() => expect(fake.calls).toEqual(['play']));

  controller.configureAutoplay(false);
  pendingPlay.resolve({ ok: false, reason: 'blocked' });
  await flushCommands();

  expect(controller.getState().autoplay).toBe('idle');
});

test('invalidates deferred autoplay when a controlled mute conflict appears', async () => {
  const pendingPlay = deferred<CommandResult>();
  const fake = createProvider({ play: () => pendingPlay.promise });
  const controller = new PlayerController();
  const origins: PlayerEventOrigin[] = [];
  controller.on('play', (event) => origins.push(event.origin));
  controller.configureAutoplay('muted');
  controller.setProvider(fake.provider);
  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
  await vi.waitFor(() => expect(fake.calls).toEqual(['mute', 'play']));

  controller.configureAutoplay('muted', { controlledMuted: false });
  pendingPlay.resolve({ ok: true });
  await flushCommands();
  fake.emit({ playback: 'playing' }, playEvent);

  expect(controller.getState()).toMatchObject({
    autoplay: 'failed',
    error: { category: 'configuration', fatal: false, recoverable: false }
  });
  expect(origins).toEqual(['provider']);
});

test('preserves a fatal provider error through an autoplay conflict correction', () => {
  const fatalError = {
    category: 'decode',
    fatal: true,
    recoverable: false,
    message: 'The provider could not decode the media.'
  } as const;
  const fake = createProvider();
  const controller = new PlayerController();
  controller.configureAutoplay('muted', { controlledMuted: false });
  controller.setProvider(fake.provider);
  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);

  fake.emit({
    lifecycle: 'error',
    activation: 'error',
    error: fatalError
  });

  expect(controller.getState()).toMatchObject({
    lifecycle: 'error',
    autoplay: 'failed',
    error: fatalError
  });

  controller.configureAutoplay('muted', { controlledMuted: true });

  expect(controller.getState()).toMatchObject({
    lifecycle: 'error',
    autoplay: 'idle',
    error: fatalError
  });
});

test('mutes before attempting muted autoplay and waits for confirmation', async () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.configureAutoplay('muted');
  controller.setProvider(fake.provider);

  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);

  await vi.waitFor(() => expect(fake.calls).toEqual(['mute', 'play']));
  expect(controller.getState().autoplay).toBe('attempting');

  fake.emit({ playback: 'playing' }, playEvent);
  expect(controller.getState().autoplay).toBe('started');
});

test('attempts audible autoplay without changing mute', async () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.configureAutoplay('audible');
  controller.setProvider(fake.provider);

  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);

  await vi.waitFor(() => expect(fake.calls).toEqual(['play']));
});

test('maps a blocked autoplay command to blocked without retrying muted', async () => {
  const fake = createProvider({
    play: async () => ({ ok: false, reason: 'blocked' })
  });
  const controller = new PlayerController();
  controller.configureAutoplay('muted');
  controller.setProvider(fake.provider);

  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
  await vi.waitFor(() =>
    expect(controller.getState().autoplay).toBe('blocked')
  );
  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);

  expect(fake.calls).toEqual(['mute', 'play']);
});

// --- 'audible-then-muted' recovery (#306) ---

const blockedThenPlaying = () => {
  let playCalls = 0;
  return async (): Promise<CommandResult> => {
    playCalls += 1;
    return playCalls === 1 ? { ok: false, reason: 'blocked' } : { ok: true };
  };
};

test('retries muted exactly once when an audible attempt is refused by policy', async () => {
  const fake = createProvider({ play: blockedThenPlaying() });
  const controller = new PlayerController();
  controller.configureAutoplay('audible-then-muted');
  controller.setProvider(fake.provider);

  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
  await vi.waitFor(() => expect(fake.calls).toEqual(['play', 'mute', 'play']));
  fake.emit({ playback: 'playing' }, playEvent);
  await flushCommands();

  expect(fake.calls).toEqual(['play', 'mute', 'play']);
});

test('reports a recovered autoplay once the muted retry starts playback', async () => {
  const fake = createProvider({ play: blockedThenPlaying() });
  const controller = new PlayerController();
  controller.configureAutoplay('audible-then-muted');
  controller.setProvider(fake.provider);

  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
  await vi.waitFor(() => expect(fake.calls).toEqual(['play', 'mute', 'play']));
  fake.emit({ playback: 'playing' }, playEvent);

  expect(controller.getState()).toMatchObject({
    autoplay: 'started',
    autoplayRecovered: true
  });
});

test('leaves autoplay unrecovered when the audible attempt is accepted', async () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.configureAutoplay('audible-then-muted');
  controller.setProvider(fake.provider);

  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
  await vi.waitFor(() => expect(fake.calls).toEqual(['play']));
  fake.emit({ playback: 'playing' }, playEvent);

  expect(controller.getState()).toMatchObject({
    autoplay: 'started',
    autoplayRecovered: false
  });
});

test('leaves autoplay unrecovered while the muted retry is in flight', async () => {
  const pendingRetry = deferred<CommandResult>();
  let playCalls = 0;
  const fake = createProvider({
    play: () => {
      playCalls += 1;
      return playCalls === 1
        ? Promise.resolve({ ok: false, reason: 'blocked' as const })
        : pendingRetry.promise;
    }
  });
  const controller = new PlayerController();
  controller.configureAutoplay('audible-then-muted');
  controller.setProvider(fake.provider);

  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
  await vi.waitFor(() => expect(fake.calls).toEqual(['play', 'mute', 'play']));

  expect(controller.getState()).toMatchObject({
    autoplay: 'attempting',
    autoplayRecovered: false
  });
  pendingRetry.resolve({ ok: true });
});

test('reports blocked without recovery when both attempts are refused', async () => {
  const fake = createProvider({
    play: async () => ({ ok: false, reason: 'blocked' })
  });
  const controller = new PlayerController();
  controller.configureAutoplay('audible-then-muted');
  controller.setProvider(fake.provider);

  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
  await vi.waitFor(() =>
    expect(controller.getState().autoplay).toBe('blocked')
  );
  await flushCommands();

  expect(fake.calls).toEqual(['play', 'mute', 'play']);
  expect(controller.getState().autoplayRecovered).toBe(false);
});

test.each(['unsupported', 'not-ready', 'provider-error'] as const)(
  'does not retry muted after a %s audible failure',
  async (reason) => {
    const error = {
      category: 'provider',
      fatal: false,
      recoverable: true,
      message: `${reason} failure`
    } as const;
    const fake = createProvider({
      play: async () => ({ ok: false, reason, error })
    });
    const controller = new PlayerController();
    controller.configureAutoplay('audible-then-muted');
    controller.setProvider(fake.provider);

    fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
    await vi.waitFor(() =>
      expect(controller.getState()).toMatchObject({
        autoplay: 'failed',
        autoplayRecovered: false,
        error
      })
    );
    await flushCommands();

    expect(fake.calls).toEqual(['play']);
  }
);

test('keeps the original refusal when muting fails', async () => {
  const blockedError = {
    category: 'policy',
    fatal: false,
    recoverable: true,
    message: 'Playback blocked.'
  } as const;
  const fake = createProvider({
    play: async () => ({ ok: false, reason: 'blocked', error: blockedError }),
    mute: async () => ({ ok: false, reason: 'unsupported' })
  });
  const controller = new PlayerController();
  controller.configureAutoplay('audible-then-muted');
  controller.setProvider(fake.provider);

  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
  await vi.waitFor(() =>
    expect(controller.getState()).toMatchObject({
      autoplay: 'blocked',
      autoplayRecovered: false,
      error: blockedError
    })
  );

  expect(fake.calls).toEqual(['play', 'mute']);
});

test('does not retry muted after a source change supersedes the attempt', async () => {
  const pendingPlay = deferred<CommandResult>();
  const first = createProvider({
    provider: 'native',
    play: () => pendingPlay.promise
  });
  const second = createProvider({ provider: 'hls' });
  const controller = new PlayerController();
  controller.configureAutoplay('audible-then-muted');
  controller.setProvider(first.provider);
  first.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
  await vi.waitFor(() => expect(first.calls).toEqual(['play']));

  controller.setProvider(second.provider);
  pendingPlay.resolve({ ok: false, reason: 'blocked' });
  await flushCommands();

  expect(first.calls).toEqual(['play']);
  expect(controller.getState()).toMatchObject({
    autoplay: 'idle',
    autoplayRecovered: false
  });
});

test('does not retry muted after a reconfiguration supersedes the attempt', async () => {
  const pendingPlay = deferred<CommandResult>();
  const fake = createProvider({ play: () => pendingPlay.promise });
  const controller = new PlayerController();
  controller.configureAutoplay('audible-then-muted');
  controller.setProvider(fake.provider);
  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
  await vi.waitFor(() => expect(fake.calls).toEqual(['play']));

  controller.configureAutoplay('audible');
  pendingPlay.resolve({ ok: false, reason: 'blocked' });
  await flushCommands();

  expect(fake.calls).toEqual(['play']);
  expect(controller.getState().autoplay).toBe('idle');
});

test('does not retry muted after a teardown supersedes the attempt', async () => {
  const pendingPlay = deferred<CommandResult>();
  const fake = createProvider({ play: () => pendingPlay.promise });
  const controller = new PlayerController();
  controller.configureAutoplay('audible-then-muted');
  controller.setProvider(fake.provider);
  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
  await vi.waitFor(() => expect(fake.calls).toEqual(['play']));

  controller.setProvider(undefined);
  pendingPlay.resolve({ ok: false, reason: 'blocked' });
  await flushCommands();

  expect(fake.calls).toEqual(['play']);
  expect(controller.getState()).toMatchObject({
    autoplay: 'idle',
    autoplayRecovered: false
  });
});

test('suppresses the muted recovery under a controlled unmuted state', async () => {
  const blockedError = {
    category: 'policy',
    fatal: false,
    recoverable: true,
    message: 'Playback blocked.'
  } as const;
  const fake = createProvider({
    play: async () => ({ ok: false, reason: 'blocked', error: blockedError })
  });
  const controller = new PlayerController();
  controller.configureAutoplay('audible-then-muted', {
    controlledMuted: false
  });
  controller.setProvider(fake.provider);

  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
  await vi.waitFor(() =>
    expect(controller.getState()).toMatchObject({
      autoplay: 'blocked',
      autoplayRecovered: false,
      error: blockedError
    })
  );
  await flushCommands();

  expect(fake.calls).toEqual(['play']);
});

test.each(['unsupported', 'not-ready', 'provider-error'] as const)(
  'maps %s autoplay command failure to failed',
  async (reason) => {
    const error = {
      category: 'provider',
      fatal: false,
      recoverable: true,
      message: `${reason} failure`
    } as const;
    const fake = createProvider({
      play: async () => ({ ok: false, reason, error })
    });
    const controller = new PlayerController();
    controller.configureAutoplay('audible');
    controller.setProvider(fake.provider);

    fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);

    await vi.waitFor(() =>
      expect(controller.getState()).toMatchObject({
        autoplay: 'failed',
        error
      })
    );
  }
);

test('stops muted autoplay when muting fails', async () => {
  const fake = createProvider({
    mute: async () => ({ ok: false, reason: 'unsupported' })
  });
  const controller = new PlayerController();
  controller.configureAutoplay('muted');
  controller.setProvider(fake.provider);

  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);

  await vi.waitFor(() => expect(controller.getState().autoplay).toBe('failed'));
  expect(fake.calls).toEqual(['mute']);
});

test('attempts autoplay once per provider generation', async () => {
  const first = createProvider({ provider: 'native' });
  const second = createProvider({ provider: 'hls' });
  const controller = new PlayerController();
  controller.configureAutoplay('audible');
  controller.setProvider(first.provider);

  first.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
  first.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
  await vi.waitFor(() => expect(first.calls).toEqual(['play']));

  controller.setProvider(second.provider);
  second.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
  await vi.waitFor(() => expect(second.calls).toEqual(['play']));
});

test('ignores a stale autoplay completion after provider replacement', async () => {
  let resolveFirst: ((result: CommandResult) => void) | undefined;
  const first = createProvider({
    provider: 'native',
    play: () => new Promise((resolve) => (resolveFirst = resolve))
  });
  const second = createProvider({ provider: 'hls' });
  const controller = new PlayerController();
  controller.configureAutoplay('audible');
  controller.setProvider(first.provider);
  first.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
  await vi.waitFor(() => expect(first.calls).toEqual(['play']));

  controller.setProvider(second.provider);
  second.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
  await vi.waitFor(() => expect(second.calls).toEqual(['play']));
  resolveFirst?.({ ok: false, reason: 'blocked' });
  await Promise.resolve();

  expect(controller.getState()).toMatchObject({
    provider: 'hls',
    autoplay: 'attempting'
  });
});

test('labels a confirmed no-argument play action as api', async () => {
  const fake = createProvider();
  const controller = new PlayerController();
  const origins: PlayerEventOrigin[] = [];
  controller.on('play', (event) => origins.push(event.origin));
  controller.setProvider(fake.provider);

  await controller.play();
  fake.emit({ playback: 'playing' }, playEvent);

  expect(origins).toEqual(['api']);
});

test('labels confirmed autoplay as autoplay', async () => {
  const fake = createProvider();
  const controller = new PlayerController();
  const origins: PlayerEventOrigin[] = [];
  controller.on('play', (event) => origins.push(event.origin));
  controller.configureAutoplay('audible');
  controller.setProvider(fake.provider);
  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
  await vi.waitFor(() => expect(fake.calls).toEqual(['play']));

  fake.emit({ playback: 'playing' }, playEvent);

  expect(origins).toEqual(['autoplay']);
});

test('labels user play after blocked autoplay as user', async () => {
  let playCalls = 0;
  const fake = createProvider({
    play: async () => {
      playCalls += 1;
      return playCalls === 1 ? { ok: false, reason: 'blocked' } : { ok: true };
    }
  });
  const controller = new PlayerController();
  const origins: PlayerEventOrigin[] = [];
  controller.on('play', (event) => origins.push(event.origin));
  controller.configureAutoplay('audible');
  controller.setProvider(fake.provider);
  fake.emit({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
  await vi.waitFor(() =>
    expect(controller.getState().autoplay).toBe('blocked')
  );

  await controller.playWithOrigin('user');
  fake.emit({ playback: 'playing' }, playEvent);

  expect(origins).toEqual(['user']);
});

test('uses the newest overlapping play request origin', async () => {
  let resolveFirst: ((result: CommandResult) => void) | undefined;
  let playCalls = 0;
  const fake = createProvider({
    play: () => {
      playCalls += 1;
      return playCalls === 1
        ? new Promise((resolve) => (resolveFirst = resolve))
        : Promise.resolve({ ok: true });
    }
  });
  const controller = new PlayerController();
  const origins: PlayerEventOrigin[] = [];
  controller.on('play', (event) => origins.push(event.origin));
  controller.setProvider(fake.provider);

  const firstPlay = controller.playWithOrigin('api');
  await controller.playWithOrigin('user');
  resolveFirst?.({ ok: false, reason: 'provider-error' });
  await firstPlay;
  fake.emit({ playback: 'playing' }, playEvent);

  expect(origins).toEqual(['user']);
});

test('does not carry a pending play origin across provider replacement', async () => {
  const first = createProvider({ provider: 'native' });
  const second = createProvider({ provider: 'hls' });
  const controller = new PlayerController();
  const origins: PlayerEventOrigin[] = [];
  controller.on('play', (event) => origins.push(event.origin));
  controller.setProvider(first.provider);
  await controller.playWithOrigin('user');

  controller.setProvider(second.provider);
  second.emit({ playback: 'playing' }, playEvent);

  expect(origins).toEqual(['provider']);
});

test('labels confirmed pause actions with their requested origin', async () => {
  const fake = createProvider();
  fake.provider.pause = async () => ({ ok: true });
  const controller = new PlayerController();
  const origins: PlayerEventOrigin[] = [];
  controller.on('pause', (event) => origins.push(event.origin));
  controller.setProvider(fake.provider);
  fake.emit({ playback: 'playing' }, playEvent);

  await controller.togglePlaybackWithOrigin('user');
  fake.emit(
    { playback: 'paused' },
    { type: 'pause', detail: undefined, origin: 'provider' }
  );

  expect(origins).toEqual(['user']);
});

// Reproduces #87. The provider reports ready from inside `attach()` — which is
// what `provider-native` does whenever the media already has metadata
// (`readyState >= HAVE_METADATA`), i.e. for a local fixture served directly
// rather than through a throttled/mocked response. `load()` is only queued
// after `attach()` returns, so a play issued during the attach tick lands
// first and `load()` then aborts it, per the HTML media spec.
const createEagerReadyProvider = () => {
  const calls: string[] = [];
  let emit: ProviderStateListener | undefined;
  const provider: ProviderAdapter = {
    provider: 'native',
    attach: () => {
      calls.push('attach');
      emit?.({ lifecycle: 'ready', activation: 'ready' }, readyEvent);
    },
    load: () => {
      calls.push('load');
    },
    destroy: () => undefined,
    subscribe: (listener) => {
      emit = listener;
      return () => undefined;
    },
    play: async () => {
      calls.push('play');
      return { ok: true };
    },
    mute: async () => {
      calls.push('mute');
      return { ok: true };
    }
  };
  return { calls, provider };
};

test('issues no autoplay play before load when metadata is already available', async () => {
  const eager = createEagerReadyProvider();
  const controller = new PlayerController();
  controller.configureAutoplay('audible');
  controller.setProvider(eager.provider);
  await flushCommands();

  expect(eager.calls).toContain('play');
  expect(eager.calls.indexOf('play')).toBeGreaterThan(
    eager.calls.indexOf('load')
  );
});

test('issues no muted-autoplay play before load either', async () => {
  // `muted` is only accidentally safe today: the `mute` await costs it enough
  // microtask hops to land after `load()`. Nothing in the code expresses that,
  // so it is one refactor away from breaking the same way `audible` does.
  const eager = createEagerReadyProvider();
  const controller = new PlayerController();
  controller.configureAutoplay('muted');
  controller.setProvider(eager.provider);
  await flushCommands();

  expect(eager.calls).toContain('play');
  expect(eager.calls.indexOf('play')).toBeGreaterThan(
    eager.calls.indexOf('load')
  );
});
