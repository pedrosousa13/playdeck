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

const providerFault: PlayerError = {
  category: 'provider',
  fatal: false,
  recoverable: true,
  message: 'The provider command failed.'
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

  fake.emit({ lifecycle: 'ready', activation: 'ready', commandsReady: true });
  await flushCommands();

  expect(settled).toBe(true);

  // The only moment the flag could be withdrawn is a notice arriving while
  // commands stand, so the notice has to come after the declaration.
  fake.emit({ error: posterNotice });

  expect(controller.getState()).toMatchObject({
    commandsReady: true,
    error: hostNotice
  });
});

test('drops the held notice when subscribing to the provider throws', () => {
  const controller = new PlayerController();
  const provider: ProviderAdapter = {
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: (listener) => {
      listener({ error: hostNotice });
      throw new Error('The provider could not be subscribed to.');
    }
  };

  controller.setProvider(provider);

  expect(controller.getState().lifecycle).toBe('error');

  // The provider is gone, so `setActivation` is permitted again — and it
  // patches `error: null`, which is exactly where a still-held notice would
  // resurface.
  controller.setActivation({ activation: 'eligible' });

  expect(controller.getState().error).toBeNull();
});

test('publishes the notice frozen and detached from the provider object', () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  const reported = { ...hostNotice };

  fake.emit({ error: reported });
  const published = controller.getState().error;
  reported.message = 'Rewritten after the provider reported it.';

  expect(Object.isFrozen(published)).toBe(true);
  expect(published?.message).toBe(hostNotice.message);
});

// #330: the five URL surfaces #320 routed through the shared allowlist are
// consumer props, not provider options, so they reach the same slot through
// `reportRefusedUrl` rather than through a provider patch.
test('publishes a refused consumer URL as a notice without moving the lifecycle', () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  fake.emit({ lifecycle: 'ready', activation: 'ready' });
  const before = controller.getState();

  controller.reportRefusedUrl('poster src');

  expect(controller.getState()).toMatchObject({
    lifecycle: before.lifecycle,
    activation: before.activation,
    playback: before.playback,
    error: {
      category: 'configuration',
      fatal: false,
      recoverable: false
    }
  });
  expect(controller.getState().lifecycle).not.toBe('error');
});

test('names the refused surface in the notice and never the refused value', () => {
  const surfaces = [
    'poster src',
    'poster srcSet',
    'nativePoster',
    'textTracks src',
    'mediaSession artwork'
  ] as const;

  for (const surface of surfaces) {
    const controller = new PlayerController();
    controller.reportRefusedUrl(surface);
    const message = controller.getState().error?.message ?? '';

    // The prop the operator has to go and fix has to be in the message, and
    // the value that failed the check must never be -- `reportRefusedUrl`
    // takes no URL at all, so an attacker-controlled string has no route into
    // an error that a monitor may log or a page may render (#330).
    expect(message).toContain(surface.split(' ').at(-1));
    expect(message).toMatch(/rejected/);
  }
});

test('keeps a refused-URL notice through a provider attaching after it', () => {
  const controller = new PlayerController();
  const fake = createProvider();

  // The ordinary React ordering: `PosterImage` renders and reports from its
  // mount effect, and the provider only attaches once its module has loaded.
  // A notice scoped to the provider the way `#configurationNotice` is would be
  // wiped by this attach before anything could observe it (#330).
  controller.reportRefusedUrl('poster src');
  const reported = controller.getState().error;
  controller.setProvider(fake.provider);

  expect(controller.getState().error).toMatchObject(reported!);

  fake.emit({ lifecycle: 'ready', activation: 'ready' });

  expect(controller.getState().error).toMatchObject(reported!);
});

test('holds the first refused URL and ignores a later one', () => {
  const controller = new PlayerController();

  controller.reportRefusedUrl('poster src');
  const first = controller.getState().error;
  controller.reportRefusedUrl('nativePoster');

  expect(controller.getState().error).toBe(first);
});

// The five call sites are React effects and a media-session binding, all of
// which re-run for reasons that have nothing to do with the refused value. A
// report that is already standing therefore has to be inert: `#applyPatch`
// alone would keep publishing the same notice, but it rebuilds the snapshot and
// fans it out to every subscriber each time (#330).
test('a repeated refusal report neither renotifies nor rebuilds the state', () => {
  const controller = new PlayerController();
  controller.reportRefusedUrl('poster src');
  const published = controller.getState();
  const seen: unknown[] = [];
  const unsubscribe = controller.subscribe((state) => seen.push(state));
  // `subscribe` delivers the current state on registration.
  seen.length = 0;

  controller.reportRefusedUrl('poster src');
  controller.reportRefusedUrl('nativePoster');

  expect(seen).toEqual([]);
  expect(controller.getState()).toBe(published);
  unsubscribe();
});

test('does not let a refused-URL notice displace a standing error', () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);

  fake.emit({ lifecycle: 'error', activation: 'error', error: fatalError });
  controller.reportRefusedUrl('poster src');

  expect(controller.getState()).toMatchObject({
    lifecycle: 'error',
    error: fatalError
  });
});

// Characterizes the single slot as it stands, and does not fix it. A refused
// consumer URL published first keeps the slot against a provider's own notice,
// the same first-one-wins the two provider notices of #332 already show. This
// change makes that masking reachable from one more direction; ranking the two
// is arbitration, which is #332's subject.
test('a refused-URL notice published first masks a later provider notice (#332)', () => {
  const fake = createProvider();
  const controller = new PlayerController();

  controller.reportRefusedUrl('poster src');
  const refused = controller.getState().error;
  controller.setProvider(fake.provider);
  fake.emit({ error: hostNotice });

  expect(controller.getState().error).toMatchObject(refused!);

  // The provider notice is held, not lost: the ready patch clears the slot
  // before it is refilled, and the provider's notice outranks the refused URL
  // the moment both are resolved together.
  fake.emit({ lifecycle: 'ready', activation: 'ready' });

  expect(controller.getState().error).toMatchObject(hostNotice);
});

test('publishes the refused-URL notice frozen', () => {
  const controller = new PlayerController();

  controller.reportRefusedUrl('textTracks src');

  expect(Object.isFrozen(controller.getState().error)).toBe(true);
});

test('holds the notice behind a standing non-fatal error until it clears', () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);

  // Not only a fatal error keeps the slot: this is the shape
  // `#applyAutoplayFailure` publishes when a play command reports a provider
  // fault, and the notice waits behind it the same way.
  fake.emit({ error: providerFault });
  fake.emit({ error: hostNotice });

  expect(controller.getState().error).toMatchObject(providerFault);

  fake.emit({ error: null });

  expect(controller.getState().error).toMatchObject(hostNotice);
});
