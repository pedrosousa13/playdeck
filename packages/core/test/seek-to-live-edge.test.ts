import { expect, test, vi } from 'vitest';
import {
  PlayerController,
  type PlayerCapabilities,
  type ProviderAdapter,
  type ProviderStateListener
} from '../src/index';

const createProvider = (
  overrides: Partial<ProviderAdapter> = {}
): { provider: ProviderAdapter; emit: ProviderStateListener } => {
  let listener: ProviderStateListener | undefined;
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
      ...overrides
    },
    emit: (patch, event) => listener?.(patch, event)
  };
};

const capabilitiesWith = (
  liveEdge: PlayerCapabilities['liveEdge']
): PlayerCapabilities => ({
  seek: { status: 'available' },
  setVolume: { status: 'available' },
  setPlaybackRate: { status: 'available' },
  selectQuality: { status: 'unavailable', reason: 'source' },
  selectQualityAuto: { status: 'unavailable', reason: 'source' },
  selectTextTrack: { status: 'unavailable', reason: 'source' },
  selectAudioTrack: { status: 'unavailable', reason: 'source' },
  chapters: { status: 'unavailable', reason: 'source' },
  liveEdge,
  fullscreen: { status: 'available' },
  pictureInPicture: { status: 'available' },
  airPlay: { status: 'unavailable', reason: 'browser' },
  customControls: { status: 'available' },
  providerPoster: { status: 'unavailable', reason: 'source' },
  remotePlayback: { status: 'unavailable', reason: 'browser' }
});

test('seekToLiveEdge reports not-ready before a provider is installed', async () => {
  const controller = new PlayerController();

  await expect(controller.seekToLiveEdge()).resolves.toEqual({
    ok: false,
    reason: 'not-ready'
  });
});

test('seekToLiveEdge reports not-ready when the capability is not available', async () => {
  const controller = new PlayerController();
  const { emit, provider } = createProvider({
    seekToLiveEdge: () => Promise.resolve({ ok: true })
  });
  controller.setProvider(provider);
  emit({
    capabilities: capabilitiesWith({ status: 'unavailable', reason: 'source' })
  });

  await expect(controller.seekToLiveEdge()).resolves.toEqual({
    ok: false,
    reason: 'not-ready'
  });
  expect(controller.getState().refusedCommand).toEqual({
    command: 'seekToLiveEdge',
    origin: null,
    reason: 'not-ready'
  });
});

test('seekToLiveEdge reports not-ready when the capability is available but the adapter implements no seekToLiveEdge', async () => {
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);
  emit({ capabilities: capabilitiesWith({ status: 'available' }) });

  await expect(controller.seekToLiveEdge()).resolves.toEqual({
    ok: false,
    reason: 'not-ready'
  });
  expect(controller.getState().refusedCommand).toEqual({
    command: 'seekToLiveEdge',
    origin: null,
    reason: 'not-ready'
  });
});

test('seekToLiveEdge delegates to the adapter once the capability is available', async () => {
  const controller = new PlayerController();
  const seekToLiveEdge = vi.fn(() => Promise.resolve({ ok: true as const }));
  const { emit, provider } = createProvider({ seekToLiveEdge });
  controller.setProvider(provider);
  emit({ capabilities: capabilitiesWith({ status: 'available' }) });

  await expect(controller.seekToLiveEdge()).resolves.toEqual({ ok: true });
  expect(seekToLiveEdge).toHaveBeenCalledTimes(1);
  expect(controller.getState().refusedCommand).toBeNull();
});

test('seekToLiveEdge surfaces a thrown provider error rather than throwing', async () => {
  const controller = new PlayerController();
  const { emit, provider } = createProvider({
    seekToLiveEdge: () => {
      throw new Error('boom');
    }
  });
  controller.setProvider(provider);
  emit({ capabilities: capabilitiesWith({ status: 'available' }) });

  await expect(controller.seekToLiveEdge()).resolves.toMatchObject({
    ok: false,
    reason: 'provider-error'
  });
});
