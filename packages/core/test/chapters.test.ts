import { expect, test } from 'vitest';
import {
  createInitialPlayerState,
  deriveChapters,
  PlayerController,
  type ProviderAdapter,
  type ProviderStateListener,
  type ProviderStatePatch
} from '@reely/core';

const createProvider = (): {
  emit: (patch: ProviderStatePatch) => void;
  provider: ProviderAdapter;
} => {
  const listeners = new Set<ProviderStateListener>();
  return {
    emit: (patch) => listeners.forEach((listener) => listener(patch)),
    provider: {
      provider: 'native',
      attach: () => undefined,
      load: () => undefined,
      destroy: () => undefined,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    }
  };
};

test('the starting state carries no chapters and an undecided capability', () => {
  const state = createInitialPlayerState();

  expect(state.chapters).toEqual([]);
  expect(Object.isFrozen(state.chapters)).toBe(true);
  expect(state.capabilities.chapters).toEqual({
    status: 'unknown',
    reason: 'not-ready'
  });
});

test('publishes a provider chapter collection frozen entry by entry', () => {
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);

  emit({
    chapters: [
      { id: 'c1', title: 'Intro', startTime: 0, endTime: 30 },
      { id: 'c2', title: 'Body', startTime: 30, endTime: null }
    ]
  });

  const { chapters } = controller.getState();
  expect(chapters).toEqual([
    { id: 'c1', title: 'Intro', startTime: 0, endTime: 30 },
    { id: 'c2', title: 'Body', startTime: 30, endTime: null }
  ]);
  expect(Object.isFrozen(chapters)).toBe(true);
  expect(Object.isFrozen(chapters[0])).toBe(true);
});

test('swapping the provider clears the published chapters', () => {
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);
  emit({ chapters: [{ id: 'c1', title: 'Intro', startTime: 0, endTime: 30 }] });

  controller.setProvider(undefined);

  expect(controller.getState().chapters).toEqual([]);
});

test('derives each end time from the next chapter start, ordered by start', () => {
  expect(
    deriveChapters(
      [
        { id: 'c2', title: 'Body', startTime: 30 },
        { id: 'c1', title: 'Intro', startTime: 0 }
      ],
      90
    )
  ).toEqual([
    { id: 'c1', title: 'Intro', startTime: 0, endTime: 30 },
    { id: 'c2', title: 'Body', startTime: 30, endTime: 90 }
  ]);
});

test('gives the last chapter the media duration when it is known', () => {
  expect(
    deriveChapters([{ id: 'c1', title: 'Only', startTime: 0 }], 42).at(-1)
  ).toEqual({ id: 'c1', title: 'Only', startTime: 0, endTime: 42 });
});

test('leaves the last chapter open when the duration is unknown', () => {
  const inputs = [
    { id: 'c1', title: 'Intro', startTime: 0 },
    { id: 'c2', title: 'Body', startTime: 30 }
  ];

  for (const duration of [null, undefined, Number.POSITIVE_INFINITY, NaN]) {
    const chapters = deriveChapters(inputs, duration);
    expect(chapters.at(-1)?.endTime).toBeNull();
    // The chapter itself is never dropped, and the ones before it are
    // unaffected by an unknown duration.
    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.endTime).toBe(30);
  }
});

test('freezes every derived chapter and the collection holding them', () => {
  const chapters = deriveChapters(
    [{ id: 'c1', title: 'Only', startTime: 0 }],
    5
  );

  expect(Object.isFrozen(chapters)).toBe(true);
  expect(Object.isFrozen(chapters[0])).toBe(true);
});
