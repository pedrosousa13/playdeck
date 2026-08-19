// @vitest-environment node

import { expect, test } from 'vitest';
import {
  PlayerController,
  type PlayerError,
  type ProviderAdapter,
  type ProviderStateListener,
  type RefusedUrlSurface
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

// The whole message per surface, not a fragment of it. Asserting only the last
// word of the key was weaker than the test's name: three of the five keys end
// in `src`, so two surfaces could have shared one notice -- or had their
// notices swapped -- with this green. `Record` typing makes the table
// exhaustive, so a sixth surface added to `RefusedUrlSurface` fails to compile
// until it has a message here, and walking all five pins that every surface has
// a rank in `REFUSED_URL_SURFACE_RANK` (`safety.ts`): one missing from that list
// would publish no notice at all.
const REFUSED_URL_MESSAGES: Record<RefusedUrlSurface, string> = {
  'poster src':
    'The poster src URL was rejected, so no poster image was requested.',
  'poster srcSet':
    'A poster srcSet candidate URL was rejected, so that candidate was dropped.',
  nativePoster:
    'The nativePoster URL was rejected, so no poster attribute was set.',
  'textTracks src':
    'A textTracks src URL was rejected, so that text track was dropped.',
  'mediaSession artwork':
    'A mediaSession artwork src URL was rejected, so that artwork entry was dropped.'
};

// The prop the operator has to go and fix is in the message; the value that
// failed the check never is. `reportRefusedUrl` takes no URL at all, so an
// attacker-controlled string has no route into an error that a monitor may log
// or a page may render (#330).
test.each(
  Object.entries(REFUSED_URL_MESSAGES) as ReadonlyArray<
    [RefusedUrlSurface, string]
  >
)(
  'names the refused %s surface in the notice, and never the value',
  (surface, message) => {
    const controller = new PlayerController();

    controller.reportRefusedUrl(surface);

    expect(controller.getState().error?.message).toBe(message);
  }
);

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

// The defect #330's own first pass shipped: the notice recorded that a refusal
// had EVER happened rather than whether one currently stands, so a consumer who
// cleaned the poisoned CMS field was left with a permanent `configuration`
// error. A security notice that cannot be withdrawn is a false positive an
// operator learns to ignore, which defeats the monitoring the issue exists to
// add. Disposing the registration is how a call site says the value it was
// refusing is now permitted.
test('withdraws the notice when the refused surface turns permitted', () => {
  const controller = new PlayerController();

  const release = controller.reportRefusedUrl('poster src');
  expect(controller.getState().error).not.toBeNull();

  release();

  expect(controller.getState().error).toBeNull();
});

// The withdrawal has to reach the held record, not only the published slot:
// `#withHeldConfiguration` re-plants whatever is held over the state
// `setProvider` rebuilds from scratch, so a notice cleared from the slot alone
// would reappear on the very next attach (#330).
test('does not re-plant a withdrawn notice on a later setProvider', () => {
  const controller = new PlayerController();
  const fake = createProvider();

  controller.reportRefusedUrl('poster src')();
  controller.setProvider(fake.provider);

  expect(controller.getState().error).toBeNull();
});

// Withdrawal is per surface, which is why the controller tallies refusals by
// surface rather than holding one notice: a poster whose `src` was fixed while
// its `srcSet` is still poisoned has not stopped being poisoned.
test('keeps the notice while another surface is still refused', () => {
  const controller = new PlayerController();

  const releaseSrc = controller.reportRefusedUrl('poster src');
  controller.reportRefusedUrl('poster srcSet');
  releaseSrc();

  expect(controller.getState().error?.message).toContain('srcSet');
});

// The defect this pass fixes, at the controller. A refusal is keyed by a PROP
// NAME, and several component instances can hold that same prop at once -- two
// `PosterImage`s under one `Player.Root`, one poisoned and one not. With a
// per-prop boolean the permitted sibling's report withdrew the poisoned one's
// notice and the refusal went silent, which is exactly the A09 failure #330
// exists to fix (#345). A registration is withdrawn only by the reporter that
// made it.
test('keeps the notice while a second reporter still refuses the same surface', () => {
  const controller = new PlayerController();

  const first = controller.reportRefusedUrl('poster src');
  controller.reportRefusedUrl('poster src');
  first();

  expect(controller.getState().error?.message).toContain('poster src');
});

// The tally must come back to nothing once every reporter has gone, or a
// surface that was refused once could never be cleared again -- the permanent
// false positive from the other direction.
test('withdraws the notice once every reporter of a surface has released', () => {
  const controller = new PlayerController();

  const first = controller.reportRefusedUrl('poster src');
  const second = controller.reportRefusedUrl('poster src');
  first();
  second();

  expect(controller.getState().error).toBeNull();
});

// A disposer is handed to callers who may run it twice -- React's strict-mode
// double invoke, a consumer holding one past a `release()`. A second run must
// not decrement a tally another live reporter owns, which would withdraw a
// refusal that still stands (#330).
test('a disposer run twice does not withdraw another reporter of the same surface', () => {
  const controller = new PlayerController();

  const first = controller.reportRefusedUrl('poster src');
  controller.reportRefusedUrl('poster src');
  first();
  first();

  expect(controller.getState().error?.message).toContain('poster src');
});

// The state has one error slot, so several surfaces refused at once need a
// tie-break. It is the rank in `REFUSED_URL_SURFACE_RANK` (`safety.ts`), the
// declaration order of `RefusedUrlSurface` -- NOT the order the reports arrived
// in. The reports come from React effects, and their order depends on where a
// consumer happened to place `PosterImage` in the tree and on whether this pass
// is a mount or an update. Ranking makes the published message a function of
// what stands refused and of nothing else, so the same poisoned fields produce
// the same notice every time (#330).
test('publishes the highest-ranked refused surface whatever order the reports arrive in', () => {
  const forwards = new PlayerController();
  forwards.reportRefusedUrl('poster src');
  forwards.reportRefusedUrl('mediaSession artwork');

  const backwards = new PlayerController();
  backwards.reportRefusedUrl('mediaSession artwork');
  backwards.reportRefusedUrl('poster src');

  expect(forwards.getState().error?.message).toContain('poster src');
  expect(backwards.getState().error?.message).toBe(
    forwards.getState().error?.message
  );
});

// The five call sites are React effects and a media-session binding, all of
// which run for reasons that have nothing to do with the refused value. A
// registration that changes nothing the single error slot can say therefore has
// to be inert: `#applyPatch` alone would keep publishing the same notice, but it
// rebuilds the snapshot and fans it out to every subscriber each time. Both
// kinds of inert registration are covered -- a second reporter joining a surface
// that already stands, and a surface joining BELOW the one already published
// (#330).
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
