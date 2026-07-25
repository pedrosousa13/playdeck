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

test('showAirPlayPicker reports not-ready before a provider is installed', async () => {
  const controller = new PlayerController();

  await expect(controller.showAirPlayPicker()).resolves.toEqual({
    ok: false,
    reason: 'not-ready'
  });
});

test('showAirPlayPicker reports unsupported when the provider lacks it', async () => {
  const controller = new PlayerController();
  controller.setProvider(createProvider().provider);

  await expect(controller.showAirPlayPicker()).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });
});

test('showAirPlayPicker forwards a confirmed provider result', async () => {
  const controller = new PlayerController();
  controller.setProvider(
    createProvider({
      showAirPlayPicker: () => Promise.resolve({ ok: true })
    }).provider
  );

  await expect(controller.showAirPlayPicker()).resolves.toEqual({ ok: true });
});

test('showAirPlayPicker surfaces a blocked policy result instead of throwing', async () => {
  const controller = new PlayerController();
  controller.setProvider(
    createProvider({
      showAirPlayPicker: () =>
        Promise.resolve({
          ok: false,
          reason: 'blocked',
          error: {
            category: 'policy',
            fatal: false,
            recoverable: true,
            message: 'AirPlay requires a user gesture.'
          }
        })
    }).provider
  );

  await expect(controller.showAirPlayPicker()).resolves.toMatchObject({
    ok: false,
    reason: 'blocked',
    error: { category: 'policy', message: 'AirPlay requires a user gesture.' }
  });
});

test('showAirPlayPicker contains a thrown provider command as a typed error', async () => {
  const controller = new PlayerController();
  controller.setProvider(
    createProvider({
      showAirPlayPicker: () => {
        throw new Error('picker failed');
      }
    }).provider
  );

  await expect(controller.showAirPlayPicker()).resolves.toMatchObject({
    ok: false,
    reason: 'provider-error',
    error: { category: 'provider', message: 'picker failed' }
  });
});

test('publishes the frozen airPlay capability patch from the provider', () => {
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);
  const capabilities: PlayerCapabilities = {
    seek: { status: 'available' },
    setVolume: { status: 'available' },
    setPlaybackRate: { status: 'available' },
    selectQuality: { status: 'unknown', reason: 'provider-check' },
    selectTextTrack: { status: 'unavailable', reason: 'source' },
    fullscreen: { status: 'available' },
    pictureInPicture: { status: 'available' },
    airPlay: { status: 'unavailable', reason: 'browser' },
    customControls: { status: 'available' }
  };

  emit({ capabilities });

  const published = controller.getState().capabilities;
  expect(published.airPlay).toEqual({
    status: 'unavailable',
    reason: 'browser'
  });
  expect(Object.isFrozen(published.airPlay)).toBe(true);
});
