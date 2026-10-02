import { afterEach, expect, test, vi } from 'vitest';
import {
  createYouTubeTimeUpdates,
  nextBufferView,
  type YouTubeTimedPlayer,
  type YouTubeTimeUpdates
} from '../src/time-updates';

const TIME_UPDATE_INTERVAL_MS = 250;

const createFakePlayer = (): YouTubeTimedPlayer & { currentTime: number } => {
  const player = {
    currentTime: 0,
    getCurrentTime: () => player.currentTime,
    getDuration: () => 100,
    getVideoLoadedFraction: () => 0.5
  };
  return player;
};

const createTimeUpdates = () => {
  const emit = vi.fn();
  const player = createFakePlayer();
  const timeUpdates = createYouTubeTimeUpdates({
    emit,
    isDestroyed: () => false,
    getPlayer: () => player,
    boundary: { onTimeReport: () => true },
    ownerDocument: document
  });
  return { emit, player, timeUpdates };
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('reports no range while the buffer end sits at or behind the playhead', () => {
  expect(nextBufferView(undefined, 10, 10)).toBeUndefined();
  expect(nextBufferView(undefined, 10, 4)).toBeUndefined();
});

test('anchors a first range at the playhead that proved it', () => {
  expect(nextBufferView(undefined, 5, 30)).toEqual({ anchor: 5, end: 30 });
});

test('keeps the earliest playhead seen while one range holds the thumb', () => {
  const first = nextBufferView(undefined, 5, 30);
  const second = nextBufferView(first, 9, 40);
  expect(second).toEqual({ anchor: 5, end: 40 });
  expect(nextBufferView(second, 7, 45)).toEqual({ anchor: 5, end: 45 });
});

test('re-anchors on a playhead past the end of the range it remembered', () => {
  const previous = { anchor: 5, end: 30 };
  expect(nextBufferView(previous, 31, 60)).toEqual({ anchor: 31, end: 60 });
});

test('keeps the anchor when the playhead lands exactly on the known end', () => {
  const previous = { anchor: 5, end: 30 };
  expect(nextBufferView(previous, 30, 60)).toEqual({ anchor: 5, end: 60 });
});

test('drops the range, anchor and all, once playback outruns the buffer', () => {
  expect(nextBufferView({ anchor: 5, end: 30 }, 31, 30)).toBeUndefined();
});

// --- visibility-gated polling ---

test('does not tick while the document is hidden', () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const { emit, timeUpdates } = createTimeUpdates();

  timeUpdates.start();
  vi.advanceTimersByTime(TIME_UPDATE_INTERVAL_MS * 4);

  expect(emit).not.toHaveBeenCalled();

  // Otherwise its `visibilitychange` listener outlives the test, answering
  // a later test's dispatches against the shared `document`.
  timeUpdates.stop();
});

test('ticks once immediately on show, then resumes the interval', () => {
  vi.useFakeTimers();
  const visibility = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('visible');
  const { emit, player, timeUpdates } = createTimeUpdates();

  timeUpdates.start();
  vi.advanceTimersByTime(TIME_UPDATE_INTERVAL_MS);
  emit.mockClear();

  visibility.mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  vi.advanceTimersByTime(TIME_UPDATE_INTERVAL_MS * 4);
  expect(emit).not.toHaveBeenCalled();

  player.currentTime = 42;
  visibility.mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));

  expect(emit).toHaveBeenCalledTimes(1);
  expect(emit).toHaveBeenCalledWith(
    expect.objectContaining({ currentTime: 42 })
  );

  emit.mockClear();
  vi.advanceTimersByTime(TIME_UPDATE_INTERVAL_MS);
  expect(emit).toHaveBeenCalledTimes(1);

  // Otherwise this interval and its `visibilitychange` listener outlive the
  // test: neither is on the fake clock a later test's own `useFakeTimers()`
  // call installs, so they go on answering real dispatches against the
  // shared `document` for the rest of the file.
  timeUpdates.stop();
});

test('does not restart polling on show after stop', () => {
  vi.useFakeTimers();
  const visibility = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('visible');
  const { emit, timeUpdates } = createTimeUpdates();

  timeUpdates.start();
  timeUpdates.stop();
  emit.mockClear();

  visibility.mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  visibility.mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  vi.advanceTimersByTime(TIME_UPDATE_INTERVAL_MS * 4);

  expect(emit).not.toHaveBeenCalled();
});

test('adds the visibility listener once on start and removes it on stop', () => {
  const addSpy = vi.spyOn(document, 'addEventListener');
  const removeSpy = vi.spyOn(document, 'removeEventListener');
  const { timeUpdates } = createTimeUpdates();

  const added = () =>
    addSpy.mock.calls.filter(([type]) => type === 'visibilitychange');
  const removed = () =>
    removeSpy.mock.calls.filter(([type]) => type === 'visibilitychange');

  timeUpdates.start();
  timeUpdates.start();
  expect(added()).toHaveLength(1);

  timeUpdates.stop();
  expect(removed()).toHaveLength(1);

  timeUpdates.stop();
  expect(removed()).toHaveLength(1);
});

test('removes the visibility listener on reset', () => {
  const removeSpy = vi.spyOn(document, 'removeEventListener');
  const { timeUpdates } = createTimeUpdates();

  timeUpdates.start();
  timeUpdates.reset();

  expect(
    removeSpy.mock.calls.filter(([type]) => type === 'visibilitychange')
  ).toHaveLength(1);
});

// A report reaching the end boundary stops the poll from inside `onTimeReport`
// itself (`boundary.ts`'s `boundaryEnded` path calls `timeUpdates.stop()`), not
// only from an external PAUSED/ENDED state change. The immediate tick the show
// handler runs can be that very report, so the handler must not restart the
// interval on the strength of what it wanted before the tick ran -- only on
// whether the tick itself left it still wanted.
test('does not restart the interval when the immediate show tick stops the poll itself', () => {
  vi.useFakeTimers();
  const visibility = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('visible');
  const emit = vi.fn();
  const player = createFakePlayer();
  // A mutable slot, filled in right after construction, so the
  // `onTimeReport` stub below can call back into the very instance it is a
  // dependency of.
  const timeUpdatesRef: { current?: YouTubeTimeUpdates } = {};
  const timeUpdates = createYouTubeTimeUpdates({
    emit,
    isDestroyed: () => false,
    getPlayer: () => player,
    boundary: {
      onTimeReport: () => {
        // Stands in for `boundaryEnded`: the boundary itself decides this
        // report lands past the window and stops the poll before the tick
        // would otherwise publish it.
        timeUpdatesRef.current?.stop();
        return false;
      }
    },
    ownerDocument: document
  });
  timeUpdatesRef.current = timeUpdates;

  timeUpdates.start();
  visibility.mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  visibility.mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));

  expect(vi.getTimerCount()).toBe(0);
});
