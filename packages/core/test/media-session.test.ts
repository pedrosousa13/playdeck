import { expect, test, vi } from 'vitest';
import {
  PlayerController,
  bindMediaSession,
  getMediaSessionCoordinator,
  type MediaSessionLike,
  type ProviderAdapter,
  type ProviderStateListener
} from '../src/index';

type Handlers = Record<
  string,
  ((details: { seekTime?: number; seekOffset?: number }) => void) | null
>;

const createSession = (): {
  session: MediaSessionLike;
  handlers: Handlers;
  positionStates: unknown[];
} => {
  const handlers: Handlers = {};
  const positionStates: unknown[] = [];
  const session: MediaSessionLike = {
    metadata: null,
    playbackState: 'none',
    setActionHandler: (action, handler) => {
      handlers[action] = handler;
    },
    setPositionState: (state) => {
      positionStates.push(state);
    }
  };
  return { session, handlers, positionStates };
};

const createProvider = (): {
  provider: ProviderAdapter;
  emit: ProviderStateListener;
  commands: string[];
} => {
  let listener: ProviderStateListener | undefined;
  const commands: string[] = [];
  const ok = () => Promise.resolve({ ok: true as const });
  return {
    provider: {
      provider: 'native',
      attach: () => undefined,
      load: () => undefined,
      destroy: () => (listener = undefined),
      subscribe: (nextListener) => {
        listener = nextListener;
        return () => (listener = undefined);
      },
      play: () => (commands.push('play'), ok()),
      pause: () => (commands.push('pause'), ok()),
      seekTo: (time) => (commands.push(`seekTo:${time}`), ok()),
      seekBy: (offset) => (commands.push(`seekBy:${offset}`), ok())
    },
    emit: (patch, event) => listener?.(patch, event),
    commands
  };
};

test('getMediaSessionCoordinator returns one coordinator per session (per document)', () => {
  const { session } = createSession();
  expect(getMediaSessionCoordinator(session)).toBe(
    getMediaSessionCoordinator(session)
  );
  expect(getMediaSessionCoordinator(createSession().session)).not.toBe(
    getMediaSessionCoordinator(session)
  );
});

test('a playing root registers metadata and action handlers', () => {
  const { session, handlers } = createSession();
  const coordinator = getMediaSessionCoordinator(session);
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);
  bindMediaSession(controller, coordinator, {
    metadata: { title: 'One' }
  });

  emit({ playback: 'playing' });

  expect(session.metadata).toMatchObject({ title: 'One' });
  expect(session.playbackState).toBe('playing');
  expect(typeof handlers.play).toBe('function');
  expect(typeof handlers.pause).toBe('function');
  expect(typeof handlers.seekto).toBe('function');
});

test('media session action handlers route to controller commands', () => {
  const { session, handlers } = createSession();
  const coordinator = getMediaSessionCoordinator(session);
  const controller = new PlayerController();
  const { commands, emit, provider } = createProvider();
  controller.setProvider(provider);
  bindMediaSession(controller, coordinator, { metadata: { title: 'One' } });
  emit({ playback: 'playing' });

  handlers.pause?.({});
  handlers.seekto?.({ seekTime: 42 });
  handlers.seekforward?.({});
  handlers.seekbackward?.({});

  expect(commands).toContain('pause');
  expect(commands).toContain('seekTo:42');
  expect(commands.some((command) => command.startsWith('seekBy:'))).toBe(true);
});

test('releasing the owning root clears its metadata and handlers', () => {
  const { session, handlers } = createSession();
  const coordinator = getMediaSessionCoordinator(session);
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);
  const binding = bindMediaSession(controller, coordinator, {
    metadata: { title: 'One' }
  });
  emit({ playback: 'playing' });
  expect(typeof handlers.play).toBe('function');

  binding.release();

  expect(session.metadata).toBeNull();
  expect(handlers.play).toBeNull();
  expect(handlers.pause).toBeNull();
  expect(handlers.seekto).toBeNull();
  expect(session.playbackState).toBe('none');
});

test('multi-root: ownership follows the most-recently-playing root', () => {
  const { session } = createSession();
  const coordinator = getMediaSessionCoordinator(session);
  const first = new PlayerController();
  const second = new PlayerController();
  const firstProvider = createProvider();
  const secondProvider = createProvider();
  first.setProvider(firstProvider.provider);
  second.setProvider(secondProvider.provider);
  bindMediaSession(first, coordinator, { metadata: { title: 'First' } });
  bindMediaSession(second, coordinator, { metadata: { title: 'Second' } });

  firstProvider.emit({ playback: 'playing' });
  expect(session.metadata).toMatchObject({ title: 'First' });

  secondProvider.emit({ playback: 'playing' });
  expect(session.metadata).toMatchObject({ title: 'Second' });
});

test('multi-root: releasing a non-owner never clears the owner handlers', () => {
  const { session, handlers } = createSession();
  const coordinator = getMediaSessionCoordinator(session);
  const first = new PlayerController();
  const second = new PlayerController();
  const firstProvider = createProvider();
  const secondProvider = createProvider();
  first.setProvider(firstProvider.provider);
  second.setProvider(secondProvider.provider);
  const firstBinding = bindMediaSession(first, coordinator, {
    metadata: { title: 'First' }
  });
  bindMediaSession(second, coordinator, { metadata: { title: 'Second' } });

  firstProvider.emit({ playback: 'playing' });
  secondProvider.emit({ playback: 'playing' });
  expect(session.metadata).toMatchObject({ title: 'Second' });

  // The first root is no longer the owner; tearing it down must not touch the
  // second root's live handlers or metadata.
  firstBinding.release();

  expect(session.metadata).toMatchObject({ title: 'Second' });
  expect(typeof handlers.play).toBe('function');
  expect(typeof handlers.pause).toBe('function');
  expect(session.playbackState).toBe('playing');
});

test('a paused owner keeps ownership but reports the paused state', () => {
  const { session, handlers } = createSession();
  const coordinator = getMediaSessionCoordinator(session);
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);
  bindMediaSession(controller, coordinator, { metadata: { title: 'One' } });

  emit({ playback: 'playing' });
  emit({ playback: 'paused' });

  expect(session.playbackState).toBe('paused');
  expect(typeof handlers.play).toBe('function');
  expect(session.metadata).toMatchObject({ title: 'One' });
});

test('source change releases handlers for the owning root', () => {
  const { session, handlers } = createSession();
  const coordinator = getMediaSessionCoordinator(session);
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);
  const binding = bindMediaSession(controller, coordinator, {
    metadata: { title: 'One' }
  });
  emit({ playback: 'playing' });

  // React re-runs the media-session effect on source change, releasing the old
  // binding before the next source registers.
  binding.release();
  expect(handlers.play).toBeNull();

  const next = createProvider();
  controller.setProvider(next.provider);
  bindMediaSession(controller, coordinator, { metadata: { title: 'Two' } });
  next.emit({ playback: 'playing' });

  expect(session.metadata).toMatchObject({ title: 'Two' });
  expect(typeof handlers.play).toBe('function');
});

test('setMetadata updates the live session only while owning', () => {
  const { session } = createSession();
  const coordinator = getMediaSessionCoordinator(session);
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);
  const binding = bindMediaSession(controller, coordinator, {
    metadata: { title: 'One' }
  });

  binding.setMetadata({ title: 'Before play' });
  expect(session.metadata).toBeNull();

  emit({ playback: 'playing' });
  expect(session.metadata).toMatchObject({ title: 'Before play' });

  binding.setMetadata({ title: 'Updated' });
  expect(session.metadata).toMatchObject({ title: 'Updated' });
});

test('position state is reported for the owning root when supported', () => {
  const { session, positionStates } = createSession();
  const setPositionState = vi.fn((state) => positionStates.push(state));
  session.setPositionState = setPositionState;
  const coordinator = getMediaSessionCoordinator(session);
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);
  bindMediaSession(controller, coordinator, { metadata: { title: 'One' } });

  emit({ playback: 'playing', duration: 120, currentTime: 5, playbackRate: 1 });

  expect(setPositionState).toHaveBeenCalled();
  expect(positionStates.at(-1)).toMatchObject({ duration: 120, position: 5 });
});

// #95. WebKit settles `currentTime` a fraction PAST `duration` once a clip
// ends (measured 1.000131 against a duration of 1 on the 1s reference
// fixture), and the Media Session spec makes `position > duration` a
// TypeError. Reporting the raw pair therefore throws inside a controller
// subscriber during ordinary end-of-playback.
test('clamps a position that overshoots duration rather than throwing', () => {
  const { session, positionStates } = createSession();
  // A spec-faithful stand-in: the real navigator.mediaSession throws here.
  session.setPositionState = (state) => {
    if (
      state &&
      state.position !== undefined &&
      state.duration !== undefined &&
      state.position > state.duration
    ) {
      throw new TypeError('Type error');
    }
    positionStates.push(state);
  };
  const coordinator = getMediaSessionCoordinator(session);
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);
  bindMediaSession(controller, coordinator, { metadata: { title: 'One' } });

  // The root only reports position while it owns the session, which it claims
  // by playing — so the clip has to run before it can overshoot its own end.
  emit({ playback: 'playing', duration: 1, currentTime: 0.5, playbackRate: 1 });
  expect(positionStates.at(-1)).toMatchObject({ position: 0.5 });

  expect(() =>
    emit({
      playback: 'ended',
      duration: 1,
      currentTime: 1.000131,
      playbackRate: 1
    })
  ).not.toThrow();
  expect(positionStates.at(-1)).toMatchObject({ duration: 1, position: 1 });
});

test('clears position state when the stream goes live (duration null)', () => {
  const { session, positionStates } = createSession();
  const coordinator = getMediaSessionCoordinator(session);
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);
  bindMediaSession(controller, coordinator, { metadata: { title: 'One' } });

  emit({ playback: 'playing', duration: 120, currentTime: 5, playbackRate: 1 });
  expect(positionStates.at(-1)).toMatchObject({ duration: 120, position: 5 });

  emit({ duration: null, currentTime: 6 });
  expect(positionStates.at(-1)).toBeUndefined();

  // Subsequent live ticks must not re-clear an already-cleared position.
  const afterFirstClear = positionStates.length;
  emit({ duration: null, currentTime: 7 });
  emit({ duration: null, currentTime: 8 });
  expect(positionStates.length).toBe(afterFirstClear);
});

test('clears position state when the owning root is released', () => {
  const { session, positionStates } = createSession();
  const coordinator = getMediaSessionCoordinator(session);
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);
  const binding = bindMediaSession(controller, coordinator, {
    metadata: { title: 'One' }
  });

  emit({ playback: 'playing', duration: 120, currentTime: 5, playbackRate: 1 });
  binding.release();

  expect(positionStates.at(-1)).toBeUndefined();
});

// Reads back the `artwork` array `toMediaMetadata` produced for a playing
// root. The test environment (happy-dom) defines no global `MediaMetadata`,
// same as every other test in this file, so this always exercises the
// fallback `init` path -- the one a platform without `MediaMetadata` gets --
// which is why that path needs no separate coverage (#236).
const artworkOn = (
  artwork: ReadonlyArray<{
    readonly src: string;
    readonly sizes?: string;
    readonly type?: string;
  }>
): unknown => {
  const { session } = createSession();
  const coordinator = getMediaSessionCoordinator(session);
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);
  bindMediaSession(controller, coordinator, { metadata: { artwork } });
  emit({ playback: 'playing' });
  return (session.metadata as { artwork: unknown } | null)?.artwork;
};

test.each([
  ['javascript:', 'javascript:alert(1)'],
  ['data:', 'data:text/html,<script>alert(1)</script>'],
  ['file:', 'file:///etc/passwd'],
  ['blob:', 'blob:https://example.com/uuid'],
  ['whitespace-carrying', 'java\tscript:alert(1)']
])('omits an artwork entry whose src is rejected (%s)', (_label, src) => {
  expect(artworkOn([{ src }])).toEqual([]);
});

test.each([
  ['http:', 'http://example.com/art.png', 'http://example.com/art.png'],
  ['https:', 'https://example.com/art.png', 'https://example.com/art.png'],
  ['protocol-relative', '//example.com/art.png', 'https://example.com/art.png'],
  ['relative', '/art.png', '/art.png']
])(
  'keeps a permitted artwork entry with sizes and type untouched (%s)',
  (_label, src, expectedSrc) => {
    expect(artworkOn([{ src, sizes: '96x96', type: 'image/png' }])).toEqual([
      { src: expectedSrc, sizes: '96x96', type: 'image/png' }
    ]);
  }
);

test('keeps every good artwork entry when one is rejected', () => {
  expect(
    artworkOn([
      { src: 'javascript:alert(1)' },
      { src: 'https://example.com/good.png' }
    ])
  ).toEqual([{ src: 'https://example.com/good.png' }]);
});

test('rejecting an artwork entry never throws', () => {
  const { session } = createSession();
  const coordinator = getMediaSessionCoordinator(session);
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);
  bindMediaSession(controller, coordinator, {
    metadata: { artwork: [{ src: 'javascript:alert(1)' }] }
  });
  expect(() => emit({ playback: 'playing' })).not.toThrow();
});

// `src` is typed `string`, but a cast, a spread or untyped CMS data walks
// past that type same as anywhere else in the library (#224, #236) --
// exercised here via an `as never` cast, since a type-checked caller can
// never produce this shape itself.
test.each([
  ['undefined', undefined],
  ['a number', 42]
])(
  'omits an artwork entry whose src is not a string (%s) without throwing',
  (_label, src) => {
    const { session } = createSession();
    const coordinator = getMediaSessionCoordinator(session);
    const controller = new PlayerController();
    const { emit, provider } = createProvider();
    controller.setProvider(provider);
    bindMediaSession(controller, coordinator, {
      metadata: {
        artwork: [{ src }, { src: 'https://example.com/good.png' }] as never
      }
    });
    expect(() => emit({ playback: 'playing' })).not.toThrow();
    expect((session.metadata as { artwork: unknown } | null)?.artwork).toEqual([
      { src: 'https://example.com/good.png' }
    ]);
  }
);

// #330: the refusal above is the blocking half and is unchanged. These cover
// the detection half -- `bindMediaSession` is the one place in this file that
// holds a `PlayerController`, so it is where the report is made.
const bindArtwork = (
  artwork: ReadonlyArray<{ readonly src: string }>
): PlayerController => {
  const { session } = createSession();
  const coordinator = getMediaSessionCoordinator(session);
  const controller = new PlayerController();
  const { provider } = createProvider();
  controller.setProvider(provider);
  bindMediaSession(controller, coordinator, { metadata: { artwork } });
  return controller;
};

test('reports a refused artwork src as a notice on the bound controller', () => {
  const controller = bindArtwork([
    { src: 'javascript:alert(1)' },
    { src: 'https://example.com/good.png' }
  ]);

  expect(controller.getState().error).toMatchObject({
    category: 'configuration',
    fatal: false,
    recoverable: false
  });
  expect(controller.getState().error?.message).toContain('artwork');
  // The report is not a failure: nothing about the player moved.
  expect(controller.getState().lifecycle).not.toBe('error');
});

test('publishes nothing when every artwork src is permitted', () => {
  expect(
    bindArtwork([{ src: 'https://example.com/good.png' }]).getState().error
  ).toBeNull();
});

test('reports a refused artwork src handed to setMetadata after binding', () => {
  const { session } = createSession();
  const coordinator = getMediaSessionCoordinator(session);
  const controller = new PlayerController();
  const { provider } = createProvider();
  controller.setProvider(provider);
  const binding = bindMediaSession(controller, coordinator, {
    metadata: { artwork: [{ src: 'https://example.com/good.png' }] }
  });

  expect(controller.getState().error).toBeNull();

  binding.setMetadata({ artwork: [{ src: 'file:///etc/passwd' }] });

  expect(controller.getState().error?.message).toContain('artwork');
});

// `setMetadata` reports the permitted case as well as the refused one, so a
// consumer who cleans the poisoned artwork field and pushes the metadata again
// gets the notice withdrawn. Reporting only the refused case would leave the
// notice standing for the controller's life, which is the false positive #330's
// second pass removes.
test('withdraws the artwork notice once setMetadata carries only permitted srcs', () => {
  const { session } = createSession();
  const coordinator = getMediaSessionCoordinator(session);
  const controller = new PlayerController();
  const { provider } = createProvider();
  controller.setProvider(provider);
  const binding = bindMediaSession(controller, coordinator, {
    metadata: { artwork: [{ src: 'javascript:alert(1)' }] }
  });

  expect(controller.getState().error?.message).toContain('artwork');

  binding.setMetadata({ artwork: [{ src: 'https://example.com/good.png' }] });

  expect(controller.getState().error).toBeNull();
});

// Two roots on one document bind to the same coordinator, and a binding is one
// reporter: the one whose artwork is clean must not be able to withdraw the
// notice the poisoned one published. This is the media-session shape of the
// sibling defect `keeps the notice while a second reporter still refuses the
// same surface` (`configuration-notices.test.ts`) pins in the controller (#330).
test('a second binding with permitted artwork does not withdraw the first notice', () => {
  const { session } = createSession();
  const coordinator = getMediaSessionCoordinator(session);
  const controller = new PlayerController();
  const { provider } = createProvider();
  controller.setProvider(provider);

  bindMediaSession(controller, coordinator, {
    metadata: { artwork: [{ src: 'javascript:alert(1)' }] }
  });
  bindMediaSession(controller, coordinator, {
    metadata: { artwork: [{ src: 'https://example.com/good.png' }] }
  });

  expect(controller.getState().error?.message).toContain('artwork');
});

// A binding that released and left its registration standing would leak: React
// calls `release()` on every source change and unmount, so the tally would climb
// with each bind/release pair and the notice could never come back down. The
// cost is stated at `release()` in `media-session.ts` -- a poisoned artwork
// field stops being reported once nothing is bound to report it (#330).
test('withdraws the artwork notice when the binding is released', () => {
  const { session } = createSession();
  const coordinator = getMediaSessionCoordinator(session);
  const controller = new PlayerController();
  const { provider } = createProvider();
  controller.setProvider(provider);
  const binding = bindMediaSession(controller, coordinator, {
    metadata: { artwork: [{ src: 'javascript:alert(1)' }] }
  });

  expect(controller.getState().error?.message).toContain('artwork');

  binding.release();

  expect(controller.getState().error).toBeNull();
});

// The binding holds ONE registration and swaps it only when the answer changes.
// Tearing it down and re-making it per `setMetadata` would withdraw and
// re-publish the notice at every call, waking every subscriber for a value that
// did not move (#330).
test('re-pushing the same poisoned artwork neither renotifies nor rebuilds the state', () => {
  const { session } = createSession();
  const coordinator = getMediaSessionCoordinator(session);
  const controller = new PlayerController();
  const { provider } = createProvider();
  controller.setProvider(provider);
  const binding = bindMediaSession(controller, coordinator, {
    metadata: { artwork: [{ src: 'javascript:alert(1)' }] }
  });
  const published = controller.getState();
  const seen: unknown[] = [];
  const unsubscribe = controller.subscribe((state) => seen.push(state));
  seen.length = 0;

  binding.setMetadata({ artwork: [{ src: 'javascript:alert(1)' }] });

  expect(seen).toEqual([]);
  expect(controller.getState()).toBe(published);
  unsubscribe();
});

test('on() keeps a re-registered listener after a duplicated unsubscribe', () => {
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);

  const first: string[] = [];
  const off1 = controller.on('play', () => first.push('first'));
  off1();

  // A new listener for the same type registers a fresh internal set.
  const second: string[] = [];
  controller.on('play', () => second.push('second'));

  // Duplicated unsubscribe of the already-removed listener must not disturb
  // the new registration.
  off1();

  emit(
    { playback: 'playing' },
    { type: 'play', origin: 'user', detail: undefined }
  );

  expect(first).toEqual([]);
  expect(second).toEqual(['second']);
});

// Type-level, not runtime: `MediaSessionLike` exists to model
// `navigator.mediaSession`, so the real DOM object must satisfy it without a
// cast. It did not — `setActionHandler(action: string, ...)` cannot be
// satisfied by the DOM's narrower `MediaSessionAction` parameter, so every
// caller needed `as unknown as MediaSessionLike`. This assertion fails
// `pnpm typecheck` if that regresses.
// Type-only so it emits nothing: `Source extends Target` is the assertion.
type AssertAssignable<Target, Source extends Target> = Source;
export type DomSessionIsMediaSessionLike = AssertAssignable<
  MediaSessionLike,
  MediaSession
>;
