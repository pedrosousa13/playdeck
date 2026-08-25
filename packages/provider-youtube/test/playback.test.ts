import { afterEach, expect, test, vi } from 'vitest';
import type { ProviderEvent, ProviderStatePatch } from '@playdeck/core';
import { playerStates } from '../src/adapter-values';
import { createYouTubeBoundary } from '../src/boundary';
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
  const events: ProviderEvent[] = [];
  const timePolling: string[] = [];
  const record = (patch: ProviderStatePatch, event?: ProviderEvent): void => {
    patches.push(patch);
    if (event) events.push(event);
  };
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

  const timeUpdates = {
    start: () => timePolling.push('start'),
    stop: () => timePolling.push('stop'),
    adoptCurrentTime: (
      current: Pick<YouTubeCommandPlayer, 'getCurrentTime'>
    ) => {
      currentTime = current.getCurrentTime();
      return currentTime;
    },
    setCurrentTime: (time: number) => {
      currentTime = time;
    },
    getCurrentTime: () => currentTime
  };

  const playback = createYouTubePlayback({
    emit: record,
    isDestroyed: () => false,
    getPlayer: () => player,
    getReadyPlayer: () => (ready ? player : undefined),
    timeUpdates,
    // The unbounded window: no start, no end, so every command behaves as it
    // did before the boundary seam existed.
    boundary: createYouTubeBoundary(
      {},
      {
        emit: record,
        isDestroyed: () => false,
        getPlayer: () => player,
        timeUpdates
      }
    )
  });

  return {
    events,
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

const volumeEvents = (events: ProviderEvent[]): ProviderEvent[] =>
  events.filter(({ type }) => type === 'volumechange');

test('publishes nothing for a setVolume asking for the volume already held', async () => {
  const { events, patches, playback, player } = createHarness();

  // The mirrors start at an unmuted 1, which is what a fresh player reports.
  await expect(playback.setVolume(1)).resolves.toEqual({ ok: true });

  // The command still reaches the player: nothing re-reads the player's volume
  // between ready adopts, so re-asserting the mirror is the only thing that
  // re-converges a player that drifted from it — see `emitVolumeIntent` in
  // `playback.ts`. What is suppressed is the report of a change that did not
  // happen (#365).
  expect(player.setVolume).toHaveBeenCalledWith(100);
  expect(patches).toEqual([]);
  expect(events).toEqual([]);
});

test('publishes exactly one volumechange for a setVolume that moves the volume', async () => {
  const { events, patches, playback } = createHarness();

  await expect(playback.setVolume(0.4)).resolves.toEqual({ ok: true });

  expect(patches).toEqual([{ muted: false, volume: 0.4 }]);
  expect(volumeEvents(events)).toEqual([
    {
      type: 'volumechange',
      detail: { muted: false, volume: 0.4 },
      origin: 'provider'
    }
  ]);
});

test('publishes a mute and an unmute only where the flag moves', async () => {
  const { events, patches, playback, player } = createHarness();

  // Already unmuted, so this asks for nothing.
  await expect(playback.unmute()).resolves.toEqual({ ok: true });
  expect(patches).toEqual([]);
  expect(events).toEqual([]);

  await expect(playback.mute()).resolves.toEqual({ ok: true });
  expect(volumeEvents(events)).toHaveLength(1);
  expect(patches).toEqual([{ muted: true, volume: 1 }]);

  await expect(playback.mute()).resolves.toEqual({ ok: true });
  expect(volumeEvents(events)).toHaveLength(1);
  expect(patches).toHaveLength(1);

  await expect(playback.unmute()).resolves.toEqual({ ok: true });
  expect(volumeEvents(events)).toHaveLength(2);

  expect(player.mute).toHaveBeenCalledTimes(2);
  expect(player.unMute).toHaveBeenCalledTimes(2);
});

test('publishes both of two distinct volumes that round onto one player step', async () => {
  const { events, playback, player } = createHarness();

  // Two requests the adapter holds apart and the player cannot: the comparison
  // reads the unrounded mirror, never the rounded 0-100 integer. The comment
  // on `emitVolumeIntent` in `playback.ts` says why (#365).
  await expect(playback.setVolume(0.501)).resolves.toEqual({ ok: true });
  await expect(playback.setVolume(0.502)).resolves.toEqual({ ok: true });

  expect(player.setVolume).toHaveBeenNthCalledWith(1, 50);
  expect(player.setVolume).toHaveBeenNthCalledWith(2, 50);
  expect(volumeEvents(events).map(({ detail }) => detail)).toEqual([
    { muted: false, volume: 0.501 },
    { muted: false, volume: 0.502 }
  ]);
});

test('publishes nothing for a volume the clamp lands back on', async () => {
  const { events, patches, playback } = createHarness();

  // Out-of-range requests are clamped before they are compared, so asking for
  // 1.5 twice — or once, at a mirror already holding 1 — moves nothing.
  await expect(playback.setVolume(1.5)).resolves.toEqual({ ok: true });

  expect(patches).toEqual([]);
  expect(events).toEqual([]);
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
