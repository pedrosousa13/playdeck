import { expect, test } from 'vitest';
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

test('showRemotePlaybackPicker reports not-ready before a provider is installed', async () => {
  const controller = new PlayerController();

  await expect(controller.showRemotePlaybackPicker()).resolves.toEqual({
    ok: false,
    reason: 'not-ready'
  });
});

test('showRemotePlaybackPicker reports unsupported when the provider lacks it', async () => {
  const controller = new PlayerController();
  controller.setProvider(createProvider().provider);

  await expect(controller.showRemotePlaybackPicker()).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });
});

test('showRemotePlaybackPicker forwards a confirmed provider result', async () => {
  const controller = new PlayerController();
  controller.setProvider(
    createProvider({
      showRemotePlaybackPicker: () => Promise.resolve({ ok: true })
    }).provider
  );

  await expect(controller.showRemotePlaybackPicker()).resolves.toEqual({
    ok: true
  });
});

test('showRemotePlaybackPicker surfaces a blocked policy result instead of throwing', async () => {
  const controller = new PlayerController();
  controller.setProvider(
    createProvider({
      showRemotePlaybackPicker: () =>
        Promise.resolve({
          ok: false,
          reason: 'blocked',
          error: {
            category: 'policy',
            fatal: false,
            recoverable: true,
            message: 'Remote playback requires a user gesture.'
          }
        })
    }).provider
  );

  await expect(controller.showRemotePlaybackPicker()).resolves.toMatchObject({
    ok: false,
    reason: 'blocked',
    error: {
      category: 'policy',
      message: 'Remote playback requires a user gesture.'
    }
  });
});

test('showRemotePlaybackPicker contains a thrown provider command as a typed error', async () => {
  const controller = new PlayerController();
  controller.setProvider(
    createProvider({
      showRemotePlaybackPicker: () => {
        throw new Error('prompt failed');
      }
    }).provider
  );

  await expect(controller.showRemotePlaybackPicker()).resolves.toMatchObject({
    ok: false,
    reason: 'provider-error',
    error: { category: 'provider', message: 'prompt failed' }
  });
});

test('publishes the frozen remotePlayback capability patch from the provider', () => {
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);
  const capabilities: PlayerCapabilities = {
    seek: { status: 'available' },
    setVolume: { status: 'available' },
    setPlaybackRate: { status: 'available' },
    selectQuality: { status: 'unknown', reason: 'provider-check' },
    selectQualityAuto: { status: 'unknown', reason: 'provider-check' },
    selectTextTrack: { status: 'unavailable', reason: 'source' },
    selectAudioTrack: { status: 'unknown', reason: 'provider-check' },
    chapters: { status: 'unavailable', reason: 'source' },
    liveEdge: { status: 'unavailable', reason: 'source' },
    fullscreen: { status: 'available' },
    pictureInPicture: { status: 'available' },
    airPlay: { status: 'unavailable', reason: 'browser' },
    customControls: { status: 'available' },
    providerPoster: { status: 'available' },
    remotePlayback: { status: 'unavailable', reason: 'browser' }
  };

  emit({ capabilities });

  const published = controller.getState().capabilities;
  expect(published.remotePlayback).toEqual({
    status: 'unavailable',
    reason: 'browser'
  });
  expect(Object.isFrozen(published.remotePlayback)).toBe(true);
});

test('publishes PlayerState.remotePlayback from a plain provider patch', () => {
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);

  emit({ remotePlayback: 'connecting' });

  expect(controller.getState().remotePlayback).toBe('connecting');
});
