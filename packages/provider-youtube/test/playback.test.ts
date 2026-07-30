import { afterEach, expect, test, vi } from 'vitest';
import type { ProviderStatePatch } from '@reely/core';
import { playerStates } from '../src/adapter-values';
import {
  createYouTubePlayback,
  PLAYBACK_CONFIRMATION_TIMEOUT_MS,
  type YouTubeCommandPlayer
} from '../src/playback';

afterEach(() => {
  vi.useRealTimers();
});

const createHarness = () => {
  const patches: ProviderStatePatch[] = [];
  const timePolling: string[] = [];
  let state: number = playerStates.UNSTARTED;
  let ready = true;
  let currentTime = 0;

  const player: YouTubeCommandPlayer = {
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    seekTo: vi.fn(),
    mute: vi.fn(),
    unMute: vi.fn(),
    setVolume: vi.fn(),
    setPlaybackRate: vi.fn(),
    getPlayerState: () => state,
    getCurrentTime: () => currentTime,
    getDuration: () => 120,
    isMuted: () => false,
    getVolume: () => 100
  };

  const playback = createYouTubePlayback({
    emit: (patch) => patches.push(patch),
    isDestroyed: () => false,
    getPlayer: () => player,
    getReadyPlayer: () => (ready ? player : undefined),
    timeUpdates: {
      start: () => timePolling.push('start'),
      stop: () => timePolling.push('stop'),
      adoptCurrentTime: (current) => {
        currentTime = current.getCurrentTime();
        return currentTime;
      },
      setCurrentTime: (time) => {
        currentTime = time;
      },
      getCurrentTime: () => currentTime
    }
  });

  return {
    patches,
    playback,
    player,
    timePolling,
    setState: (next: number) => {
      state = next;
    },
    setReady: (next: boolean) => {
      ready = next;
    }
  };
};

test('confirms a play the player already reports as playing without waiting', async () => {
  const { playback, player, setState } = createHarness();
  setState(playerStates.PLAYING);
  await expect(playback.play()).resolves.toEqual({ ok: true });
  expect(player.playVideo).not.toHaveBeenCalled();
});

test('reports blocked once the confirmation window passes unconfirmed', async () => {
  vi.useFakeTimers();
  const { playback, player } = createHarness();
  const play = playback.play();
  expect(player.playVideo).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(PLAYBACK_CONFIRMATION_TIMEOUT_MS);
  await expect(play).resolves.toMatchObject({
    ok: false,
    reason: 'blocked',
    error: { category: 'policy', fatal: false, recoverable: true }
  });
});

test('confirms a pending play as soon as the player reports playing', async () => {
  vi.useFakeTimers();
  const { playback, setState } = createHarness();
  const play = playback.play();
  setState(playerStates.PLAYING);
  playback.handlers.onPlayerStateChange(playerStates.PLAYING);
  await expect(play).resolves.toEqual({ ok: true });
  // The confirmation timer was cleared, so the window passing changes nothing.
  await vi.advanceTimersByTimeAsync(PLAYBACK_CONFIRMATION_TIMEOUT_MS);
  await expect(play).resolves.toEqual({ ok: true });
});

test('confirms a pending play on buffering, which blocked autoplay never reaches', async () => {
  vi.useFakeTimers();
  const { playback } = createHarness();
  const play = playback.play();
  playback.handlers.onPlayerStateChange(playerStates.BUFFERING);
  await expect(play).resolves.toEqual({ ok: true });
});

test('confirms at the deadline when the player is playing but the state change was missed', async () => {
  vi.useFakeTimers();
  const { playback, setState } = createHarness();
  const play = playback.play();
  setState(playerStates.PLAYING);
  await vi.advanceTimersByTimeAsync(PLAYBACK_CONFIRMATION_TIMEOUT_MS);
  await expect(play).resolves.toEqual({ ok: true });
});

test('reports blocked at the deadline when the player state cannot be read', async () => {
  vi.useFakeTimers();
  const { playback, player } = createHarness();
  const play = playback.play();
  vi.spyOn(player, 'getPlayerState').mockImplementation(() => {
    throw new Error('postMessage bridge is gone');
  });
  await vi.advanceTimersByTimeAsync(PLAYBACK_CONFIRMATION_TIMEOUT_MS);
  await expect(play).resolves.toMatchObject({ ok: false, reason: 'blocked' });
});

test('fails a play the iframe API rejects instead of leaving it pending', async () => {
  vi.useFakeTimers();
  const { playback, player } = createHarness();
  vi.spyOn(player, 'playVideo').mockImplementation(() => {
    throw new Error('player is gone');
  });
  await expect(playback.play()).resolves.toMatchObject({
    ok: false,
    reason: 'provider-error',
    error: { message: 'player is gone' }
  });
  // Nothing is left waiting on the cleared timer.
  await vi.advanceTimersByTimeAsync(PLAYBACK_CONFIRMATION_TIMEOUT_MS);
});

test('settles a pending play with the player error when the player fails', async () => {
  vi.useFakeTimers();
  const { playback } = createHarness();
  const play = playback.play();
  playback.handlers.onPlayerError(101);
  await expect(play).resolves.toMatchObject({
    ok: false,
    reason: 'provider-error',
    error: { category: 'policy', fatal: true, recoverable: false }
  });
});

test('reports not-ready for a play made before the player is ready', async () => {
  const { playback, player, setReady } = createHarness();
  setReady(false);
  await expect(playback.play()).resolves.toEqual({
    ok: false,
    reason: 'not-ready'
  });
  expect(player.playVideo).not.toHaveBeenCalled();
});
