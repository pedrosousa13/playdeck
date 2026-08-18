import type {
  CommandResult,
  PlayerProvider,
  ProviderAdapter,
  ProviderStateListener,
  ProviderStatePatch
} from '@playdeck/core';

export const deferred = <Value>() => {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
};

export const createFakeProvider = ({
  onAttach,
  onLoad,
  onPlay,
  playResult = { ok: true } as CommandResult,
  provider = 'native' as PlayerProvider
}: {
  readonly onAttach?: () => void;
  readonly onLoad?: () => void;
  readonly onPlay?: () => void;
  readonly playResult?: CommandResult;
  readonly provider?: PlayerProvider;
} = {}) => {
  const listeners = new Set<ProviderStateListener>();
  let attachCount = 0;
  let destroyCount = 0;
  let loadCount = 0;
  let muteCount = 0;
  let playCount = 0;
  let playbackRateCount = 0;
  let unmuteCount = 0;
  let volumeCount = 0;
  const adapter: ProviderAdapter = {
    provider,
    attach: () => {
      attachCount += 1;
      onAttach?.();
    },
    load: () => {
      loadCount += 1;
      onLoad?.();
    },
    destroy: () => {
      destroyCount += 1;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    play: async () => {
      playCount += 1;
      onPlay?.();
      return playResult;
    },
    mute: async () => {
      muteCount += 1;
      return { ok: true };
    },
    unmute: async () => {
      unmuteCount += 1;
      return { ok: true };
    },
    setVolume: async () => {
      volumeCount += 1;
      return { ok: true };
    },
    setPlaybackRate: async () => {
      playbackRateCount += 1;
      return { ok: true };
    }
  };
  return {
    adapter,
    counts: () => ({
      attachCount,
      destroyCount,
      loadCount,
      muteCount,
      playCount,
      playbackRateCount,
      unmuteCount,
      volumeCount
    }),
    emit: (patch: ProviderStatePatch) => {
      listeners.forEach((listener) => listener(patch));
    }
  };
};
