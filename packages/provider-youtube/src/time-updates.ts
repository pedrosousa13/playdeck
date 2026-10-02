import type { TimeRange } from '@playdeck/core';
import { clamp01, type EmitProviderState } from './adapter-values.js';
import type { YouTubeBoundary } from './boundary.js';
import type { YouTubePlayer } from './loader.js';

const TIME_UPDATE_INTERVAL_MS = 250;

// The iframe API exposes no ranges, only `getVideoLoadedFraction()`, which
// measures the end of the range the playhead sits in, never its start (#91).
// Every playhead position seen while that same range held it is a start we can
// prove, so the earliest one anchors the range -- reporting less than is
// buffered, never more, and without the start sliding along with the thumb.
export type BufferView = { readonly anchor: number; readonly end: number };

export const nextBufferView = (
  previous: BufferView | undefined,
  currentTime: number,
  end: number
): BufferView | undefined => {
  // A seek can leave the playhead outside the buffer for a poll or two, and
  // playback can outrun it entirely. Neither leaves a range to report.
  if (end <= currentTime) return undefined;
  // A playhead past the edge we knew is in a range we were not tracking, so
  // nothing we remember about the old one applies to it.
  const continuous = previous !== undefined && currentTime <= previous.end;
  return {
    anchor: continuous ? Math.min(previous.anchor, currentTime) : currentTime,
    end
  };
};

// The slice of the player this seam reads: position, duration and the loaded
// fraction the buffered range is derived from.
export type YouTubeTimedPlayer = Pick<
  YouTubePlayer,
  'getCurrentTime' | 'getDuration' | 'getVideoLoadedFraction'
>;

export type YouTubeTimeUpdatesDeps = {
  readonly emit: EmitProviderState;
  readonly isDestroyed: () => boolean;
  readonly getPlayer: () => YouTubeTimedPlayer | undefined;
  // The poll is the only time report YouTube gives, so it is where the
  // [startTime, endTime] window is enforced — before anything is published.
  readonly boundary: Pick<YouTubeBoundary, 'onTimeReport'>;
  // The document whose visibility gates the poll -- the mount's own
  // (`attachment.ts`'s `ownerDocument`), so a host embedding the player into
  // another frame is judged by that frame's visibility, not the top one's.
  readonly ownerDocument: Document;
};

// The polling seam: the iframe API pushes no time updates, so position and
// buffered range are polled while playback runs. Owns the position mirror and
// the buffer anchor — every other seam reads the playhead through here rather
// than keeping a second copy of it.
export type YouTubeTimeUpdates = {
  readonly start: () => void;
  readonly stop: () => void;
  // Re-reads the player's own position into the mirror and returns it.
  readonly adoptCurrentTime: (
    current: Pick<YouTubePlayer, 'getCurrentTime'>
  ) => number;
  // Records a position the player has accepted but will not report back yet.
  readonly setCurrentTime: (time: number) => void;
  readonly getCurrentTime: () => number;
  // Stops polling and forgets the buffer anchor; called when the player is
  // torn down.
  readonly reset: () => void;
};

export const createYouTubeTimeUpdates = ({
  emit,
  isDestroyed,
  getPlayer,
  boundary,
  ownerDocument
}: YouTubeTimeUpdatesDeps): YouTubeTimeUpdates => {
  let timeInterval: ReturnType<typeof setInterval> | undefined;
  // The iframe API proxies commands over postMessage, so getters read stale
  // values right after a command. This mirror tracks the last confirmed or
  // intended position instead; commands emit intent, polling confirms.
  let knownCurrentTime = 0;
  let bufferView: BufferView | undefined;
  // Whether playback wants the poll running, independent of `timeInterval`:
  // the interval itself also pauses while the document is hidden, and this is
  // what the visibility listener consults to decide whether to resume it.
  let wanted = false;
  let visibilityListenerAdded = false;

  const bufferedRanges = (
    current: YouTubeTimedPlayer,
    currentTime: number
  ): readonly TimeRange[] => {
    const duration = current.getDuration();
    const fraction = current.getVideoLoadedFraction();
    bufferView =
      Number.isFinite(duration) && duration > 0 && Number.isFinite(fraction)
        ? nextBufferView(bufferView, currentTime, clamp01(fraction) * duration)
        : undefined;
    return bufferView
      ? [{ start: bufferView.anchor, end: bufferView.end }]
      : [];
  };

  // The interval's own body, factored out so the immediate poll fired on
  // becoming visible again runs the exact same read-and-publish as a regular
  // tick, rather than waiting out a first interval delay on top of however
  // long the tab was hidden.
  const tick = (): void => {
    const current = getPlayer();
    if (isDestroyed() || !current) return;
    try {
      knownCurrentTime = current.getCurrentTime();
      // The boundary may pin the mirror and stop the poll from in here; a
      // report it consumed is one this poll must not publish.
      if (!boundary.onTimeReport(knownCurrentTime)) return;
      emit({
        currentTime: knownCurrentTime,
        buffered: bufferedRanges(current, knownCurrentTime)
      });
    } catch {
      // Polling must not escape the provider boundary.
    }
  };

  const stopInterval = (): void => {
    if (timeInterval === undefined) return;
    clearInterval(timeInterval);
    timeInterval = undefined;
  };

  const startInterval = (): void => {
    if (timeInterval !== undefined) return;
    timeInterval = setInterval(tick, TIME_UPDATE_INTERVAL_MS);
  };

  // A hidden tab still runs the interval, just throttled; clearing it instead
  // stops the work outright rather than relying on the browser to slow it
  // down. Showing the tab again polls once right away -- the whole point of
  // not waiting out a timer the hidden period already starved -- and only
  // restarts the interval if `start()` is still what called for it.
  //
  // `wanted` is read again after `tick()`, not only before it: the tick can
  // be the report that reaches the boundary's own end, and `onTimeReport`
  // stops the poll from inside that call (`boundary.ts`'s `boundaryEnded`
  // path) before this function gets to decide whether to restart the
  // interval. Restarting on the pre-tick value would leave an interval
  // running that nothing goes on to clear.
  const onVisibilityChange = (): void => {
    if (ownerDocument.visibilityState === 'hidden') {
      stopInterval();
      return;
    }
    if (!wanted) return;
    tick();
    if (wanted) startInterval();
  };

  const removeVisibilityListener = (): void => {
    if (!visibilityListenerAdded) return;
    ownerDocument.removeEventListener('visibilitychange', onVisibilityChange);
    visibilityListenerAdded = false;
  };

  const stop = (): void => {
    stopInterval();
    wanted = false;
    removeVisibilityListener();
  };

  return {
    start: () => {
      if (wanted) return;
      wanted = true;
      if (!visibilityListenerAdded) {
        ownerDocument.addEventListener('visibilitychange', onVisibilityChange);
        visibilityListenerAdded = true;
      }
      if (ownerDocument.visibilityState === 'hidden') return;
      startInterval();
    },
    stop,
    adoptCurrentTime: (current) => {
      knownCurrentTime = current.getCurrentTime();
      return knownCurrentTime;
    },
    setCurrentTime: (time) => {
      knownCurrentTime = time;
    },
    getCurrentTime: () => knownCurrentTime,
    reset: () => {
      stop();
      bufferView = undefined;
    }
  };
};
