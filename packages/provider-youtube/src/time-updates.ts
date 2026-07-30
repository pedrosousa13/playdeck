import type { TimeRange } from '@reely/core';
import {
  clamp01,
  nextBufferView,
  type BufferView,
  type EmitProviderState
} from './adapter-values.js';
import type { YouTubePlayer } from './loader.js';

const TIME_UPDATE_INTERVAL_MS = 250;

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
  getPlayer
}: YouTubeTimeUpdatesDeps): YouTubeTimeUpdates => {
  let timeInterval: ReturnType<typeof setInterval> | undefined;
  // The iframe API proxies commands over postMessage, so getters read stale
  // values right after a command. This mirror tracks the last confirmed or
  // intended position instead; commands emit intent, polling confirms.
  let knownCurrentTime = 0;
  let bufferView: BufferView | undefined;

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

  const stop = (): void => {
    if (timeInterval === undefined) return;
    clearInterval(timeInterval);
    timeInterval = undefined;
  };

  return {
    start: () => {
      if (timeInterval !== undefined) return;
      timeInterval = setInterval(() => {
        const current = getPlayer();
        if (isDestroyed() || !current) return;
        try {
          knownCurrentTime = current.getCurrentTime();
          emit({
            currentTime: knownCurrentTime,
            buffered: bufferedRanges(current, knownCurrentTime)
          });
        } catch {
          // Polling must not escape the provider boundary.
        }
      }, TIME_UPDATE_INTERVAL_MS);
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
