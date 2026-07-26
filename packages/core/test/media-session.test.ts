import { expect, test, vi } from 'vitest';
import {
  PlayerController,
  bindMediaSession,
  createMediaSessionCoordinator,
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
  const coordinator = createMediaSessionCoordinator(session);
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
  const coordinator = createMediaSessionCoordinator(session);
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
  const coordinator = createMediaSessionCoordinator(session);
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
  const coordinator = createMediaSessionCoordinator(session);
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
  const coordinator = createMediaSessionCoordinator(session);
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
  const coordinator = createMediaSessionCoordinator(session);
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
  const coordinator = createMediaSessionCoordinator(session);
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
  const coordinator = createMediaSessionCoordinator(session);
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
  const coordinator = createMediaSessionCoordinator(session);
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
  const coordinator = createMediaSessionCoordinator(session);
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
  const coordinator = createMediaSessionCoordinator(session);
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
  const coordinator = createMediaSessionCoordinator(session);
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
