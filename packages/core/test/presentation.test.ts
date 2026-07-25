import { expect, test } from 'vitest';
import {
  PlayerController,
  type PlayerCapabilities,
  type PlayerEvent,
  type ProviderAdapter,
  type ProviderStateListener
} from '../src/index';

const presentationCommands = [
  'requestFullscreen',
  'exitFullscreen',
  'requestPictureInPicture',
  'exitPictureInPicture'
] as const;

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

test.each(presentationCommands)(
  '%s reports not-ready before a provider is installed',
  async (command) => {
    const controller = new PlayerController();

    await expect(controller[command]()).resolves.toEqual({
      ok: false,
      reason: 'not-ready'
    });
  }
);

test.each(presentationCommands)(
  '%s reports unsupported when the provider lacks the command',
  async (command) => {
    const controller = new PlayerController();
    controller.setProvider(createProvider().provider);

    await expect(controller[command]()).resolves.toEqual({
      ok: false,
      reason: 'unsupported'
    });
  }
);

test('confirms fullscreen state from provider events with typed metadata', async () => {
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);
  const events: PlayerEvent[] = [];
  controller.on('fullscreenchange', (event) => events.push(event));

  emit(
    { fullscreen: true },
    {
      type: 'fullscreenchange',
      detail: { fullscreen: true },
      origin: 'provider'
    }
  );

  expect(controller.getState().fullscreen).toBe(true);
  expect(events).toEqual([
    expect.objectContaining({
      type: 'fullscreenchange',
      detail: { fullscreen: true },
      origin: 'provider',
      provider: 'native',
      timestamp: expect.any(Number)
    })
  ]);
});

test('confirms picture-in-picture state from provider events with typed metadata', async () => {
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);
  const events: PlayerEvent[] = [];
  controller.on('pictureinpicturechange', (event) => events.push(event));

  emit(
    { pictureInPicture: true },
    {
      type: 'pictureinpicturechange',
      detail: { pictureInPicture: true },
      origin: 'provider'
    }
  );

  expect(controller.getState().pictureInPicture).toBe(true);
  expect(events).toEqual([
    expect.objectContaining({
      type: 'pictureinpicturechange',
      detail: { pictureInPicture: true },
      origin: 'provider',
      provider: 'native',
      timestamp: expect.any(Number)
    })
  ]);
});

test('contains thrown presentation commands as typed provider errors', async () => {
  const controller = new PlayerController();
  controller.setProvider(
    createProvider({
      requestFullscreen: () => {
        throw new Error('presentation change failed');
      }
    }).provider
  );

  await expect(controller.requestFullscreen()).resolves.toMatchObject({
    ok: false,
    reason: 'provider-error',
    error: {
      category: 'provider',
      message: 'presentation change failed'
    }
  });
});

test('publishes frozen presentation capability patches from the provider', () => {
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);
  const capabilities: PlayerCapabilities = {
    seek: { status: 'available' },
    setVolume: { status: 'available' },
    setPlaybackRate: { status: 'available' },
    selectQuality: { status: 'unknown', reason: 'provider-check' },
    selectTextTrack: { status: 'unavailable', reason: 'source' },
    fullscreen: { status: 'unavailable', reason: 'policy' },
    pictureInPicture: { status: 'unavailable', reason: 'browser' },
    airPlay: { status: 'unknown', reason: 'provider-check' },
    customControls: { status: 'available' }
  };

  emit({ capabilities });

  const published = controller.getState().capabilities;
  expect(published.fullscreen).toEqual({
    status: 'unavailable',
    reason: 'policy'
  });
  expect(published.pictureInPicture).toEqual({
    status: 'unavailable',
    reason: 'browser'
  });
  expect(Object.isFrozen(published)).toBe(true);
  expect(Object.isFrozen(published.fullscreen)).toBe(true);
});
