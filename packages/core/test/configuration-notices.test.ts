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

// The two levels a notice is ranked by, on the shapes the adapters actually
// emit. A notice that says a control protecting the viewer fired — an untrusted
// URL blocked, a privacy opt-out that did not take — outranks one that says a
// presentational option was ignored, whichever of them was emitted first
// (#368). `hostNotice` and `posterNotice` above deliberately carry no severity
// at all: an out-of-repo adapter may emit a notice without one, and the tests
// that use them are what says an absent severity is read as the presentational
// level rather than as an error.
const privacyNotice: PlayerError = {
  category: 'configuration',
  fatal: false,
  recoverable: false,
  severity: 'protective',
  message: 'The suppressSeoMetadata option did not take effect.'
};

const refusedPosterNotice: PlayerError = {
  category: 'configuration',
  fatal: false,
  recoverable: false,
  severity: 'protective',
  message: 'The poster option was rejected: expected a permitted source URL.'
};

const cosmeticNotice: PlayerError = {
  category: 'configuration',
  fatal: false,
  recoverable: false,
  severity: 'presentational',
  message: 'The playerColor option was rejected: expected a CSS hex colour.'
};

// What nothing in this repo can construct and an untyped adapter can still emit:
// a notice claiming a level `PlayerErrorSeverity` does not name. Built through a
// cast because the type is exactly what keeps it out of this repo, and the input
// this pins arrives from outside it — the same reason `hostNotice` above carries
// no severity at all (#368).
const inventedSeverityNotice = {
  category: 'configuration',
  fatal: false,
  recoverable: false,
  severity: 'critical',
  message: 'The theme option was rejected, so the default theme was used.'
} as unknown as PlayerError;

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

// Two notices carrying no severity tie, and a tie keeps the incumbent. This is
// the anti-flapping property the slot has always had, and the one the `??=` it
// replaces was really about: the slot must not change its mind while a single
// attach is still reporting (#235, #368).
test('holds the first of two notices declaring no severity', () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);

  fake.emit({ error: hostNotice });
  fake.emit({ error: posterNotice });

  expect(controller.getState().error).toMatchObject(hostNotice);

  fake.emit({ lifecycle: 'ready', activation: 'ready' });

  expect(controller.getState().error).toMatchObject(hostNotice);
});

// The severity decides the slot and the arrival order does not. The cosmetic
// notice is emitted first and is already published, so the protective one has
// to displace a notice that STANDS — the second assertion is the held record,
// the first is the published slot, and both have to move (#368).
test('lets a protective notice displace a presentational one emitted first', () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);

  fake.emit({ error: cosmeticNotice });
  fake.emit({ error: privacyNotice });

  expect(controller.getState().error).toMatchObject(privacyNotice);

  fake.emit({ lifecycle: 'ready', activation: 'ready' });

  expect(controller.getState().error).toMatchObject(privacyNotice);
});

// The other half of the same rule: a presentational notice arriving after a
// protective one changes nothing. Ranking has to be a comparison rather than a
// "latest wins" overwrite, or the slot would flap on every attach that reports
// its security-relevant refusal first (#368).
test('leaves a standing protective notice alone when a presentational one follows', () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);

  fake.emit({ error: privacyNotice });
  fake.emit({ error: cosmeticNotice });

  expect(controller.getState().error).toMatchObject(privacyNotice);

  fake.emit({ lifecycle: 'ready', activation: 'ready' });

  expect(controller.getState().error).toMatchObject(privacyNotice);
});

// Ties are settled by arrival, at the explicit levels as well as at the absent
// ones: two protective refusals in one attach must not trade the slot back and
// forth, because a notice that changes wording for a reason the operator cannot
// see is unreadable to a monitoring system — the same ground
// `REFUSED_URL_SURFACE_RANK` stands on (#330, #368).
test('keeps the first of two notices of equal severity', () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);

  fake.emit({ error: privacyNotice });
  fake.emit({ error: refusedPosterNotice });

  expect(controller.getState().error).toMatchObject(privacyNotice);

  fake.emit({ lifecycle: 'ready', activation: 'ready' });

  expect(controller.getState().error).toMatchObject(privacyNotice);
});

// A severity the rank does not name is the lowest level, exactly as an absent
// one is, rather than a level of its own above every other. Nothing here can
// emit one, and an untyped adapter outside this repo can, so the rank has to
// hold against it: read with `indexOf` it would have answered `-1`, which sorts
// ABOVE `'protective'`, and an invented level would have masked the refusal that
// blocked an untrusted URL — the masking this change exists to remove, back
// through the one input the types do not reach (#368).
test('does not let an unrecognised severity displace a protective notice', () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);

  fake.emit({ error: privacyNotice });
  fake.emit({ error: inventedSeverityNotice });

  expect(controller.getState().error).toMatchObject(privacyNotice);

  fake.emit({ lifecycle: 'ready', activation: 'ready' });

  expect(controller.getState().error).toMatchObject(privacyNotice);
});

// The property the whole change exists to establish, pinned here rather than in
// each provider's suite: which notice a consumer sees is a function of what was
// refused and of nothing else, so the order an adapter happens to run its checks
// in stops being load-bearing. One row per pair a provider can emit inside a
// single attach — a provider that gains a third notice adds its new pairs here.
// The messages are copied from the adapters so a row names the case it stands
// for; only the severities decide (#368).
const PROVIDER_NOTICE_PAIRS: ReadonlyArray<
  readonly [string, PlayerError, PlayerError]
> = [
  [
    'Vimeo: SEO metadata against the chromeless probe',
    privacyNotice,
    {
      category: 'configuration',
      fatal: false,
      recoverable: false,
      severity: 'presentational',
      message:
        'The chromeless-capability check could not be completed, so the customControls capability is reported as unknown.'
    }
  ],
  ['Wistia: poster against playerColor', refusedPosterNotice, cosmeticNotice]
];

test.each(PROVIDER_NOTICE_PAIRS)(
  'resolves %s to the same notice whichever order the checks emit them in',
  (_pair, protective, presentational) => {
    const forwards = createProvider();
    const forwardsController = new PlayerController();
    forwardsController.setProvider(forwards.provider);
    forwards.emit({ error: protective });
    forwards.emit({ error: presentational });
    forwards.emit({ lifecycle: 'ready', activation: 'ready' });

    const backwards = createProvider();
    const backwardsController = new PlayerController();
    backwardsController.setProvider(backwards.provider);
    backwards.emit({ error: presentational });
    backwards.emit({ error: protective });
    backwards.emit({ lifecycle: 'ready', activation: 'ready' });

    expect(backwardsController.getState().error).toEqual(
      forwardsController.getState().error
    );
    expect(forwardsController.getState().error).toMatchObject(protective);
  }
);

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
// until it has a message here.
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

// A notice reports whether a refusal currently stands, never that one had EVER
// happened: keyed to the latter, a consumer who cleaned the poisoned CMS field
// would be left with a permanent `configuration` error. A security notice that
// cannot be withdrawn is a false positive an operator learns to ignore, which
// defeats the monitoring the issue exists to add. Disposing the registration is
// how a call site says the value it was refusing is now permitted.
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

// A refusal is keyed by a PROP NAME, and several component instances can hold
// that same prop at once -- two `PosterImage`s under one `Player.Root`, one
// poisoned and one not. Keyed by prop alone, the permitted sibling's report
// would withdraw the poisoned one's notice and the refusal would go silent,
// which is exactly the A09 failure #330 exists to fix (#345). A registration is
// withdrawn only by the reporter that made it.
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

// `reportRefusedUrl` is public on `PlayerController`, so the disposer reaches
// callers this repo does not write, and one of them can run it twice. A second
// run must not decrement a tally another live reporter owns, which would
// withdraw a refusal that still stands. Neither call site in the library gets
// there -- React never repeats an effect cleanup, and `bindMediaSession` nulls
// its own handle inside `release()` -- so what this pins is the guard the public
// method needs and nothing inside reaches (#330).
test('a disposer run twice does not withdraw another reporter of the same surface', () => {
  const controller = new PlayerController();

  const first = controller.reportRefusedUrl('poster src');
  controller.reportRefusedUrl('poster src');
  first();
  first();

  expect(controller.getState().error?.message).toContain('poster src');
});

// The state has one error slot, so several surfaces refused at once need a
// tie-break. It is the order of `REFUSED_URL_SURFACE_RANK` (`safety.ts`), a
// list of its own and not the declaration order of `RefusedUrlSurface` -- and
// NOT the order the reports arrived in. The reports come from React effects,
// and their order depends on where a consumer happened to place `PosterImage`
// in the tree and on whether this pass is a mount or an update. Ranking makes
// the published message a function of what stands refused and of nothing else,
// so the same poisoned fields produce the same notice every time (#330).
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

// The masking path #332 characterized from one more direction, and what #368
// settles. A refused consumer URL published first used to keep the slot against
// any provider notice at all, by standing in it; now the two are ranked. Every
// refused-URL notice is protective — the shared allowlist blocked an untrusted
// URL — so a presentational provider notice never takes the slot from one, at
// the moment it arrives or at the ready patch that resolves both together.
test('keeps a refused-URL notice over a presentational provider notice', () => {
  const fake = createProvider();
  const controller = new PlayerController();

  controller.reportRefusedUrl('poster src');
  const refused = controller.getState().error;
  controller.setProvider(fake.provider);
  fake.emit({ error: cosmeticNotice });

  expect(controller.getState().error).toMatchObject(refused!);

  fake.emit({ lifecycle: 'ready', activation: 'ready' });

  expect(controller.getState().error).toMatchObject(refused!);
});

// Where the two tie — and a provider's own protective notice against a refused
// consumer URL is the common tie — the provider's wins, which is what the
// `#configurationNotice ?? #refusedUrlNotice` order has always expressed: the
// provider reported something about the source that is about to play, and the
// refused URL is about a prop beside it (#330). The tie is settled only where
// both are resolved together: until then the published notice is the incumbent,
// because a tie never displaces what already stands.
test('gives a provider notice the slot over an equally protective refused URL', () => {
  const fake = createProvider();
  const controller = new PlayerController();

  controller.reportRefusedUrl('poster src');
  const refused = controller.getState().error;
  controller.setProvider(fake.provider);
  fake.emit({ error: privacyNotice });

  expect(controller.getState().error).toMatchObject(refused!);

  fake.emit({ lifecycle: 'ready', activation: 'ready' });

  expect(controller.getState().error).toMatchObject(privacyNotice);
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
