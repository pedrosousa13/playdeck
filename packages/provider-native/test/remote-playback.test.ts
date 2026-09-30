// @vitest-environment happy-dom

import { expect, test, vi } from 'vitest';
import { createNativeProvider } from '../src/index';

const define = (target: object, key: string, value: unknown): void => {
  Object.defineProperty(target, key, { configurable: true, value });
};

const createOwnedVideo = (): HTMLVideoElement => {
  const ownerDocument = document.implementation.createHTMLDocument('owner');
  return ownerDocument.createElement('video');
};

// A fake Remote Playback API object, replacing happy-dom's own `remote` stub
// entirely so the tests control exactly when a device appears and what its
// connection state is -- the shape the issue's acceptance criteria ask for.
type FakeRemote = {
  state: 'connecting' | 'connected' | 'disconnected';
  watchAvailability: ReturnType<typeof vi.fn>;
  cancelWatchAvailability: ReturnType<typeof vi.fn>;
  prompt: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  announceAvailability: (available: boolean) => void;
  announceConnectionEvent: (
    type: 'connecting' | 'connect' | 'disconnect'
  ) => void;
};

const createFakeRemote = (
  overrides: Partial<
    Pick<FakeRemote, 'state' | 'prompt' | 'watchAvailability'>
  > = {}
): FakeRemote => {
  let availabilityCallback: ((available: boolean) => void) | undefined;
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const on = (type: string, listener: (event: Event) => void): void => {
    const set = listeners.get(type) ?? new Set();
    set.add(listener);
    listeners.set(type, set);
  };
  const off = (type: string, listener: (event: Event) => void): void => {
    listeners.get(type)?.delete(listener);
  };
  const remote: FakeRemote = {
    state: overrides.state ?? 'disconnected',
    watchAvailability:
      overrides.watchAvailability ??
      vi.fn((callback: (available: boolean) => void) => {
        availabilityCallback = callback;
        return Promise.resolve(1);
      }),
    cancelWatchAvailability: vi.fn(() => Promise.resolve()),
    prompt: overrides.prompt ?? vi.fn(() => Promise.resolve()),
    addEventListener: vi.fn(on),
    removeEventListener: vi.fn(off),
    announceAvailability: (available) => availabilityCallback?.(available),
    announceConnectionEvent: (type) => {
      for (const listener of listeners.get(type) ?? []) {
        listener(new Event(type));
      }
    }
  };
  return remote;
};

test('reports remotePlayback unavailable/browser where the element has no Remote Playback API', async () => {
  const media = createOwnedVideo();
  define(media, 'remote', undefined);
  const patches: Array<Record<string, unknown>> = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();

  expect(patches.at(-1)).toMatchObject({
    capabilities: {
      remotePlayback: { status: 'unavailable', reason: 'browser' }
    }
  });
  await expect(provider.showRemotePlaybackPicker?.()).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });
});

test('reports remotePlayback unavailable/provider until the availability watch finds a device', async () => {
  const media = createOwnedVideo();
  const remote = createFakeRemote();
  define(media, 'remote', remote);
  const patches: Array<Record<string, unknown>> = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();

  expect(patches.at(-1)).toMatchObject({
    capabilities: {
      remotePlayback: { status: 'unavailable', reason: 'provider' }
    }
  });
  expect(remote.watchAvailability).toHaveBeenCalledOnce();
});

test('remotePlayback becomes available when the watch reports a device, and goes away again', async () => {
  const media = createOwnedVideo();
  const remote = createFakeRemote({ state: 'disconnected' });
  define(media, 'remote', remote);
  const patches: Array<Record<string, unknown>> = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();

  remote.announceAvailability(true);
  expect(patches.at(-1)).toMatchObject({
    capabilities: { remotePlayback: { status: 'available' } },
    remotePlayback: 'disconnected'
  });

  await expect(provider.showRemotePlaybackPicker?.()).resolves.toEqual({
    ok: true
  });
  expect(remote.prompt).toHaveBeenCalledOnce();

  remote.announceAvailability(false);
  expect(patches.at(-1)).toMatchObject({
    capabilities: {
      remotePlayback: { status: 'unavailable', reason: 'provider' }
    },
    remotePlayback: null
  });
});

test('a repeated availability announcement emits nothing new', async () => {
  const media = createOwnedVideo();
  const remote = createFakeRemote();
  define(media, 'remote', remote);
  const patches: Array<Record<string, unknown>> = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();
  remote.announceAvailability(true);
  const afterFirst = patches.length;

  remote.announceAvailability(true);
  remote.announceAvailability(true);

  expect(patches.length).toBe(afterFirst);
});

test('reflects connecting/connected/disconnected as the element reports them', async () => {
  const media = createOwnedVideo();
  const remote = createFakeRemote();
  define(media, 'remote', remote);
  const patches: Array<Record<string, unknown>> = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();
  remote.announceAvailability(true);

  remote.state = 'connecting';
  remote.announceConnectionEvent('connecting');
  expect(patches.at(-1)).toMatchObject({ remotePlayback: 'connecting' });

  remote.state = 'connected';
  remote.announceConnectionEvent('connect');
  expect(patches.at(-1)).toMatchObject({ remotePlayback: 'connected' });

  remote.state = 'disconnected';
  remote.announceConnectionEvent('disconnect');
  expect(patches.at(-1)).toMatchObject({ remotePlayback: 'disconnected' });
});

test('the availability watch is cancelled and connection listeners removed on destroy', async () => {
  const media = createOwnedVideo();
  const remote = createFakeRemote();
  define(media, 'remote', remote);
  const provider = createNativeProvider(media);

  await provider.attach();
  provider.destroy();

  expect(remote.cancelWatchAvailability).toHaveBeenCalledWith(1);
  expect(remote.removeEventListener).toHaveBeenCalledWith(
    'connecting',
    expect.any(Function)
  );
  expect(remote.removeEventListener).toHaveBeenCalledWith(
    'connect',
    expect.any(Function)
  );
  expect(remote.removeEventListener).toHaveBeenCalledWith(
    'disconnect',
    expect.any(Function)
  );
});

test('showRemotePlaybackPicker reports unsupported when the element has no Remote Playback API', async () => {
  const media = createOwnedVideo();
  define(media, 'remote', undefined);
  const provider = createNativeProvider(media);

  await expect(provider.showRemotePlaybackPicker?.()).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });
});

test('surfaces a rejected prompt() as a typed provider error', async () => {
  const media = createOwnedVideo();
  const remote = createFakeRemote({
    prompt: vi.fn(() => Promise.reject(new Error('no device to cast to')))
  });
  define(media, 'remote', remote);
  const provider = createNativeProvider(media);

  await expect(provider.showRemotePlaybackPicker?.()).resolves.toMatchObject({
    ok: false,
    reason: 'provider-error',
    error: { category: 'provider', message: 'no device to cast to' }
  });
});
