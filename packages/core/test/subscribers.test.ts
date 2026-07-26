import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  PlayerController,
  type ProviderAdapter,
  type ProviderStateListener,
  type TextCue
} from '../src/index';

const createProvider = (): {
  provider: ProviderAdapter;
  emit: ProviderStateListener;
  emitCues: (cues: readonly TextCue[]) => void;
} => {
  let listener: ProviderStateListener | undefined;
  let cueListener: ((cues: readonly TextCue[]) => void) | undefined;
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
      subscribeCues: (nextListener) => {
        cueListener = nextListener;
        return () => (cueListener = undefined);
      }
    },
    emit: (patch, event) => listener?.(patch, event),
    emitCues: (cues) => cueListener?.(cues)
  };
};

// Every test here throws from a listener on purpose, and the controller
// rethrows those on a fresh task so they still reach uncaught-error handling.
// Left alone that would land in the runner as an unhandled error and fail the
// file, so the scheduled rethrows are captured rather than run — and the test
// that owns the surfacing contract asserts against what was captured.
let rethrows: (() => void)[] = [];
let realQueueMicrotask: typeof queueMicrotask;

beforeEach(() => {
  rethrows = [];
  realQueueMicrotask = globalThis.queueMicrotask;
  globalThis.queueMicrotask = (task: () => void) => rethrows.push(task);
});

afterEach(() => {
  globalThis.queueMicrotask = realQueueMicrotask;
});

const throwsAfterRegistration = (): (() => void) => {
  let registered = false;
  return () => {
    if (!registered) {
      registered = true;
      return;
    }
    throw new Error('subscriber blew up');
  };
};

// #95. `#setState` notified subscribers with a bare `Set.forEach`, so one
// subscriber throwing abandoned the rest of the loop: every listener
// registered AFTER the thrower silently missed that one emit, then resynced on
// the next unrelated one. Measured in the reference example as a captions
// button stuck reading `on` after its own click had already set
// `selectedTextTrackId` to null — the late-subscribing control row sat behind
// `bindMediaSession`'s subscriber, which was throwing at end of playback.
test('a throwing subscriber does not starve the subscribers behind it', () => {
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);

  // `subscribe` invokes the listener once on registration, on the consumer's
  // own stack; only the emits after that are the controller's to isolate.
  const before = vi.fn();
  const after = vi.fn();
  controller.subscribe(before);
  controller.subscribe(throwsAfterRegistration());
  controller.subscribe(after);

  emit({ currentTime: 5 });

  expect(before).toHaveBeenCalled();
  expect(after).toHaveBeenCalled();
  expect(after.mock.calls.at(-1)?.[0]).toMatchObject({ currentTime: 5 });
});

// The emit itself must stay a completed unit of work: a consumer's broken
// listener cannot be allowed to abort the state transition for the caller that
// triggered it.
test('a throwing subscriber does not escape the command that emitted', () => {
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);

  controller.subscribe(throwsAfterRegistration());

  expect(() => emit({ currentTime: 5 })).not.toThrow();
  expect(controller.getState().currentTime).toBe(5);
});

// Isolated is not the same as silenced. The error is rethrown on a fresh task
// so it still reaches the page's uncaught-error handling; the scheduled task is
// captured here rather than run, which is what keeps a deliberately-throwing
// test from surfacing as an unhandled error in the runner.
test('a throwing subscriber still surfaces its error asynchronously', () => {
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);
  controller.subscribe(throwsAfterRegistration());

  emit({ currentTime: 5 });

  expect(rethrows).toHaveLength(1);
  expect(() => rethrows[0]?.()).toThrow('subscriber blew up');
});

// The same hazard, reached through the two other notification paths: a cue
// listener and an event listener each iterate their own set.
test('a throwing cue listener does not starve the cue listeners behind it', () => {
  const controller = new PlayerController();
  const { emitCues, provider } = createProvider();
  controller.setProvider(provider);

  const after = vi.fn();
  controller.subscribeCues(throwsAfterRegistration());
  controller.subscribeCues(after);

  emitCues([{ id: 'a', startTime: 0, endTime: 1, text: 'one' }]);

  expect(after.mock.calls.at(-1)?.[0]).toMatchObject([{ text: 'one' }]);
});

test('a throwing event listener does not starve the listeners behind it', () => {
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);

  const after = vi.fn();
  controller.on('play', () => {
    throw new Error('event listener blew up');
  });
  controller.on('play', after);

  emit(
    { playback: 'playing' },
    { type: 'play', detail: undefined, origin: 'provider' }
  );

  expect(after).toHaveBeenCalled();
});
