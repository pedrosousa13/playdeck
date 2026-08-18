// @vitest-environment happy-dom

import { expect, test, vi } from 'vitest';
import type { ProviderEvent } from '@playdeck/core';
import { createNativeProvider } from '../src/index';

const define = (target: object, key: string, value: unknown): void => {
  Object.defineProperty(target, key, { configurable: true, value });
};

// HTMLMediaElement readyState values; happy-dom omits the static constants.
const HAVE_NOTHING = 0;
const HAVE_METADATA = 1;

const createOwnedVideo = (): {
  ownerDocument: Document;
  media: HTMLVideoElement;
} => {
  const ownerDocument = document.implementation.createHTMLDocument('owner');
  return { ownerDocument, media: ownerDocument.createElement('video') };
};

test('reports WebKit presentation-mode fullscreen and routes commands through it', async () => {
  const { media } = createOwnedVideo();
  const webkitEnterFullscreen = vi.fn();
  const webkitExitFullscreen = vi.fn();
  define(media, 'webkitSupportsFullscreen', true);
  define(media, 'webkitEnterFullscreen', webkitEnterFullscreen);
  define(media, 'webkitExitFullscreen', webkitExitFullscreen);
  const patches: Array<Record<string, unknown>> = [];
  const events: ProviderEvent[] = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch, event) => {
    patches.push(patch);
    if (event) events.push(event);
  });

  await provider.attach();
  expect(patches.at(-1)).toMatchObject({
    capabilities: { fullscreen: { status: 'available' } }
  });

  await expect(provider.requestFullscreen()).resolves.toEqual({ ok: true });
  expect(webkitEnterFullscreen).toHaveBeenCalledOnce();

  define(media, 'webkitDisplayingFullscreen', true);
  media.dispatchEvent(new Event('webkitbeginfullscreen'));
  expect(patches.at(-1)).toEqual({ fullscreen: true });
  expect(events.at(-1)).toMatchObject({
    type: 'fullscreenchange',
    detail: { fullscreen: true }
  });

  await expect(provider.exitFullscreen()).resolves.toEqual({ ok: true });
  expect(webkitExitFullscreen).toHaveBeenCalledOnce();

  define(media, 'webkitDisplayingFullscreen', false);
  media.dispatchEvent(new Event('webkitendfullscreen'));
  expect(patches.at(-1)).toEqual({ fullscreen: false });
  expect(events.at(-1)).toMatchObject({
    type: 'fullscreenchange',
    detail: { fullscreen: false }
  });
});

test('reports WebKit fullscreen as not ready until metadata resolves support', async () => {
  const { media } = createOwnedVideo();
  const webkitEnterFullscreen = vi.fn();
  define(media, 'webkitSupportsFullscreen', false);
  define(media, 'webkitEnterFullscreen', webkitEnterFullscreen);
  define(media, 'readyState', HAVE_NOTHING);
  const patches: Array<Record<string, unknown>> = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();
  expect(patches.at(-1)).toMatchObject({
    capabilities: { fullscreen: { status: 'unknown', reason: 'not-ready' } }
  });
  await expect(provider.requestFullscreen()).resolves.toEqual({
    ok: false,
    reason: 'not-ready'
  });
  expect(webkitEnterFullscreen).not.toHaveBeenCalled();

  define(media, 'webkitSupportsFullscreen', true);
  define(media, 'readyState', HAVE_METADATA);
  media.dispatchEvent(new Event('loadedmetadata'));
  expect(patches.at(-1)).toMatchObject({
    capabilities: { fullscreen: { status: 'available' } }
  });
});

test('reports WebKit fullscreen as unavailable once metadata rules it out', async () => {
  const { media } = createOwnedVideo();
  define(media, 'webkitSupportsFullscreen', false);
  define(media, 'webkitEnterFullscreen', vi.fn());
  define(media, 'readyState', HAVE_METADATA);
  const patches: Array<Record<string, unknown>> = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();

  expect(patches.at(-1)).toMatchObject({
    capabilities: { fullscreen: { status: 'unavailable', reason: 'browser' } }
  });
});

test('prefers the standard fullscreen exit over lingering WebKit legacy state', async () => {
  const { media, ownerDocument } = createOwnedVideo();
  const exitFullscreen = vi.fn().mockResolvedValue(undefined);
  const webkitExitFullscreen = vi.fn();
  define(media, 'requestFullscreen', vi.fn().mockResolvedValue(undefined));
  define(ownerDocument, 'exitFullscreen', exitFullscreen);
  define(ownerDocument, 'fullscreenElement', media);
  // Blink also exposes the legacy WebKit video fullscreen surface, and it
  // reports webkitDisplayingFullscreen after a standard requestFullscreen.
  define(media, 'webkitDisplayingFullscreen', true);
  define(media, 'webkitExitFullscreen', webkitExitFullscreen);
  const provider = createNativeProvider(media);

  await expect(provider.exitFullscreen()).resolves.toEqual({ ok: true });

  expect(exitFullscreen).toHaveBeenCalledOnce();
  expect(webkitExitFullscreen).not.toHaveBeenCalled();
});

test('reports policy-disallowed fullscreen and returns a typed blocked result', async () => {
  const { media, ownerDocument } = createOwnedVideo();
  const requestFullscreen = vi.fn().mockResolvedValue(undefined);
  define(media, 'requestFullscreen', requestFullscreen);
  define(ownerDocument, 'fullscreenEnabled', false);
  const patches: Array<Record<string, unknown>> = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();
  expect(patches.at(-1)).toMatchObject({
    capabilities: { fullscreen: { status: 'unavailable', reason: 'policy' } }
  });
  await expect(provider.requestFullscreen()).resolves.toMatchObject({
    ok: false,
    reason: 'blocked',
    error: { category: 'policy' }
  });
  expect(requestFullscreen).not.toHaveBeenCalled();
});

test('surfaces user-gesture rejections as blocked policy results', async () => {
  const { media } = createOwnedVideo();
  define(
    media,
    'requestFullscreen',
    vi
      .fn()
      .mockRejectedValue(
        new DOMException(
          'Fullscreen requires a user gesture.',
          'NotAllowedError'
        )
      )
  );
  define(
    media,
    'requestPictureInPicture',
    vi
      .fn()
      .mockRejectedValue(
        new DOMException(
          'Picture-in-picture requires a user gesture.',
          'NotAllowedError'
        )
      )
  );
  const provider = createNativeProvider(media);

  await expect(provider.requestFullscreen()).resolves.toMatchObject({
    ok: false,
    reason: 'blocked',
    error: {
      category: 'policy',
      message: 'Fullscreen requires a user gesture.'
    }
  });
  await expect(provider.requestPictureInPicture()).resolves.toMatchObject({
    ok: false,
    reason: 'blocked',
    error: {
      category: 'policy',
      message: 'Picture-in-picture requires a user gesture.'
    }
  });
});

test('reports document policy-disallowed picture-in-picture as blocked', async () => {
  const { media, ownerDocument } = createOwnedVideo();
  const requestPictureInPicture = vi.fn().mockResolvedValue(undefined);
  define(media, 'requestPictureInPicture', requestPictureInPicture);
  define(ownerDocument, 'pictureInPictureEnabled', false);
  const patches: Array<Record<string, unknown>> = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();
  expect(patches.at(-1)).toMatchObject({
    capabilities: {
      pictureInPicture: { status: 'unavailable', reason: 'policy' }
    }
  });
  await expect(provider.requestPictureInPicture()).resolves.toMatchObject({
    ok: false,
    reason: 'blocked',
    error: { category: 'policy' }
  });
  expect(requestPictureInPicture).not.toHaveBeenCalled();
});

test('reports element-disabled picture-in-picture as blocked', async () => {
  const { media } = createOwnedVideo();
  const requestPictureInPicture = vi.fn().mockResolvedValue(undefined);
  define(media, 'requestPictureInPicture', requestPictureInPicture);
  define(media, 'disablePictureInPicture', true);
  const patches: Array<Record<string, unknown>> = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();
  expect(patches.at(-1)).toMatchObject({
    capabilities: {
      pictureInPicture: { status: 'unavailable', reason: 'policy' }
    }
  });
  await expect(provider.requestPictureInPicture()).resolves.toMatchObject({
    ok: false,
    reason: 'blocked',
    error: { category: 'policy' }
  });
  expect(requestPictureInPicture).not.toHaveBeenCalled();
});

test('reports WebKit presentation-mode picture-in-picture and routes commands through it', async () => {
  const { media } = createOwnedVideo();
  const webkitSetPresentationMode = vi.fn((mode: string) => {
    define(media, 'webkitPresentationMode', mode);
  });
  define(
    media,
    'webkitSupportsPresentationMode',
    (mode: string) => mode === 'picture-in-picture'
  );
  define(media, 'webkitSetPresentationMode', webkitSetPresentationMode);
  define(media, 'webkitPresentationMode', 'inline');
  const patches: Array<Record<string, unknown>> = [];
  const events: ProviderEvent[] = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch, event) => {
    patches.push(patch);
    if (event) events.push(event);
  });

  await provider.attach();
  expect(patches.at(-1)).toMatchObject({
    capabilities: { pictureInPicture: { status: 'available' } }
  });

  await expect(provider.requestPictureInPicture()).resolves.toEqual({
    ok: true
  });
  expect(webkitSetPresentationMode).toHaveBeenLastCalledWith(
    'picture-in-picture'
  );

  media.dispatchEvent(new Event('webkitpresentationmodechanged'));
  expect(patches.at(-1)).toEqual({ pictureInPicture: true });
  expect(events.at(-1)).toMatchObject({
    type: 'pictureinpicturechange',
    detail: { pictureInPicture: true }
  });

  await expect(provider.exitPictureInPicture()).resolves.toEqual({ ok: true });
  expect(webkitSetPresentationMode).toHaveBeenLastCalledWith('inline');

  media.dispatchEvent(new Event('webkitpresentationmodechanged'));
  expect(patches.at(-1)).toEqual({ pictureInPicture: false });
  expect(events.at(-1)).toMatchObject({
    type: 'pictureinpicturechange',
    detail: { pictureInPicture: false }
  });
});

test('reports picture-in-picture unavailable when WebKit presentation mode rejects it', async () => {
  const { media } = createOwnedVideo();
  const webkitSetPresentationMode = vi.fn();
  define(media, 'webkitSupportsPresentationMode', () => false);
  define(media, 'webkitSetPresentationMode', webkitSetPresentationMode);
  const patches: Array<Record<string, unknown>> = [];
  const provider = createNativeProvider(media);
  provider.subscribe((patch) => patches.push(patch));

  await provider.attach();
  expect(patches.at(-1)).toMatchObject({
    capabilities: {
      pictureInPicture: { status: 'unavailable', reason: 'browser' }
    }
  });
  await expect(provider.requestPictureInPicture()).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });
  expect(webkitSetPresentationMode).not.toHaveBeenCalled();
});
