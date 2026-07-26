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

// WebKit reports route availability through
// `webkitplaybacktargetavailabilitychanged`, whose event carries an
// `availability` of 'available' | 'not-available'.
const announceRoutes = (
  media: HTMLVideoElement,
  availability: 'available' | 'not-available'
): void => {
  const event = new Event('webkitplaybacktargetavailabilitychanged');
  Object.defineProperty(event, 'availability', {
    configurable: true,
    value: availability
  });
  media.dispatchEvent(event);
};

test('reports AirPlay unavailable until WebKit says a route exists (#71)', async () => {
  const media = createOwnedVideo();
  define(media, 'webkitShowPlaybackTargetPicker', vi.fn());
  const patches: Array<Record<string, unknown>> = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();

  // The picker API exists, so this used to report `available` outright — which
  // is what made `Player.AirPlayButton` render on desktop Safari with nothing
  // to cast to, opening an empty picker. `available` now means "there is
  // somewhere to cast to", not "this engine has the API".
  expect(patches.at(-1)).toMatchObject({
    capabilities: { airPlay: { status: 'unavailable', reason: 'provider' } }
  });
});

test('AirPlay becomes available when a route appears mid-session, and goes away again (#71)', async () => {
  const media = createOwnedVideo();
  const webkitShowPlaybackTargetPicker = vi.fn();
  define(
    media,
    'webkitShowPlaybackTargetPicker',
    webkitShowPlaybackTargetPicker
  );
  const patches: Array<Record<string, unknown>> = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();

  // Live, with no reload: plugging in a receiver is what makes the button
  // appear.
  announceRoutes(media, 'available');
  expect(patches.at(-1)).toMatchObject({
    capabilities: { airPlay: { status: 'available' } }
  });

  await expect(provider.showAirPlayPicker()).resolves.toEqual({ ok: true });
  expect(webkitShowPlaybackTargetPicker).toHaveBeenCalledOnce();

  // And the reverse: the receiver leaving the network takes the button with
  // it, rather than leaving a control that opens an empty picker.
  announceRoutes(media, 'not-available');
  expect(patches.at(-1)).toMatchObject({
    capabilities: { airPlay: { status: 'unavailable', reason: 'provider' } }
  });
});

test('a repeated AirPlay availability announcement emits nothing new (#71)', async () => {
  const media = createOwnedVideo();
  define(media, 'webkitShowPlaybackTargetPicker', vi.fn());
  const patches: Array<Record<string, unknown>> = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();
  announceRoutes(media, 'available');
  const afterFirst = patches.length;

  announceRoutes(media, 'available');
  announceRoutes(media, 'available');

  // WebKit re-announces on route changes that do not change availability.
  // Recomputing capabilities on each would push an identical patch to every
  // subscriber, waking every capability-gated control for nothing.
  expect(patches.length).toBe(afterFirst);
});

test('the AirPlay route listener is removed on destroy (#71)', async () => {
  const media = createOwnedVideo();
  define(media, 'webkitShowPlaybackTargetPicker', vi.fn());
  const added = vi.spyOn(media, 'addEventListener');
  const removed = vi.spyOn(media, 'removeEventListener');
  const provider = createNativeProvider(media);

  await provider.attach();
  provider.destroy();

  // Asserted as add/remove symmetry on the same handler reference, not by
  // dispatching after destroy: `destroy()` also clears the subscriber set, so
  // a post-destroy dispatch produces no patch whether the listener was
  // detached or not — it would be a test that cannot fail.
  const event = 'webkitplaybacktargetavailabilitychanged';
  const handler = added.mock.calls.find(([name]) => name === event)?.[1];
  expect(handler).toBeDefined();
  expect(removed).toHaveBeenCalledWith(event, handler);
});

test('reports AirPlay unavailable when WebKit lacks the picker', async () => {
  const media = createOwnedVideo();
  const patches: Array<Record<string, unknown>> = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();
  expect(patches.at(-1)).toMatchObject({
    capabilities: { airPlay: { status: 'unavailable', reason: 'browser' } }
  });

  await expect(provider.showAirPlayPicker()).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });
});

test('reports AirPlay policy-disallowed for x-webkit-airplay="deny"', async () => {
  const media = createOwnedVideo();
  const webkitShowPlaybackTargetPicker = vi.fn();
  define(
    media,
    'webkitShowPlaybackTargetPicker',
    webkitShowPlaybackTargetPicker
  );
  media.setAttribute('x-webkit-airplay', 'deny');
  const patches: Array<Record<string, unknown>> = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();
  expect(patches.at(-1)).toMatchObject({
    capabilities: { airPlay: { status: 'unavailable', reason: 'policy' } }
  });

  await expect(provider.showAirPlayPicker()).resolves.toMatchObject({
    ok: false,
    reason: 'blocked',
    error: { category: 'policy' }
  });
  expect(webkitShowPlaybackTargetPicker).not.toHaveBeenCalled();
});

test('reports AirPlay policy-disallowed when remote playback is disabled', async () => {
  const media = createOwnedVideo();
  define(media, 'webkitShowPlaybackTargetPicker', vi.fn());
  define(media, 'disableRemotePlayback', true);
  const patches: Array<Record<string, unknown>> = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();
  expect(patches.at(-1)).toMatchObject({
    capabilities: { airPlay: { status: 'unavailable', reason: 'policy' } }
  });
});

test('surfaces AirPlay user-gesture rejection as a blocked policy result', async () => {
  const media = createOwnedVideo();
  define(
    media,
    'webkitShowPlaybackTargetPicker',
    vi.fn().mockImplementation(() => {
      throw new DOMException(
        'AirPlay requires a user gesture.',
        'NotAllowedError'
      );
    })
  );
  const provider = createNativeProvider(media);

  await expect(provider.showAirPlayPicker()).resolves.toMatchObject({
    ok: false,
    reason: 'blocked',
    error: {
      category: 'policy',
      message: 'AirPlay requires a user gesture.'
    }
  });
});
