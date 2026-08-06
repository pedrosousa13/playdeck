// @vitest-environment happy-dom

import { expect, test, vi } from 'vitest';
import type { ResolvedPlayerSource } from '@reely/core';
import { loadProvider } from '../src/provider-loaders';

vi.mock('@reely/provider-native', () => ({
  createNativeProvider: vi.fn(() => ({ provider: 'native' }))
}));

vi.mock('@reely/provider-vimeo', () => ({
  createVimeoProvider: vi.fn(() => ({ provider: 'vimeo' }))
}));

vi.mock('@reely/provider-wistia', () => ({
  createWistiaProvider: vi.fn(() => ({ provider: 'wistia' }))
}));

const nativeOptions = {};

test('dispatches vimeo sources to the vimeo adapter with the mount and source', async () => {
  const { createVimeoProvider } = await import('@reely/provider-vimeo');
  const media = document.createElement('div');
  const source = {
    type: 'vimeo',
    videoId: '76979871',
    hash: 'abc123'
  } as const;

  await expect(
    loadProvider({ media, nativeOptions, source })
  ).resolves.toMatchObject({ provider: 'vimeo' });
  // The third argument is always passed, so an absent bag arrives as
  // `undefined` and `createVimeoProvider`'s own `{}` default applies.
  expect(createVimeoProvider).toHaveBeenCalledWith(media, source, undefined);
});

test('rejects vimeo sources without a media mount', async () => {
  await expect(
    loadProvider({
      media: null,
      nativeOptions,
      source: { type: 'vimeo', videoId: '76979871' }
    })
  ).rejects.toThrow('The Vimeo provider requires a media mount.');
});

test('dispatches wistia sources to the wistia adapter with the mount and source', async () => {
  const { createWistiaProvider } = await import('@reely/provider-wistia');
  const media = document.createElement('div');
  const source = {
    type: 'wistia',
    mediaId: 'oifkgmxnkb'
  } as const;

  await expect(
    loadProvider({ media, nativeOptions, source })
  ).resolves.toMatchObject({ provider: 'wistia' });
  // The third argument is always passed, so an absent bag arrives as
  // `undefined` and `createWistiaProvider`'s own `{}` default applies.
  expect(createWistiaProvider).toHaveBeenCalledWith(media, source, undefined);
});

test('forwards the wistia option bag to the wistia adapter', async () => {
  const { createWistiaProvider } = await import('@reely/provider-wistia');
  const media = document.createElement('div');
  const source = {
    type: 'wistia',
    mediaId: 'oifkgmxnkb'
  } as const;
  const wistia = { playerColor: 'ff0000', swatch: false };

  await expect(
    loadProvider({ media, nativeOptions, providerOptions: { wistia }, source })
  ).resolves.toMatchObject({ provider: 'wistia' });
  expect(createWistiaProvider).toHaveBeenCalledWith(media, source, wistia);
});

test('rejects wistia sources without a media mount', async () => {
  await expect(
    loadProvider({
      media: null,
      nativeOptions,
      source: { type: 'wistia', mediaId: 'oifkgmxnkb' }
    })
  ).rejects.toThrow('The Wistia provider requires a media mount.');
});

test('requires a video element for native sources', async () => {
  await expect(
    loadProvider({
      media: document.createElement('div'),
      nativeOptions,
      source: {
        type: 'video',
        sources: [{ src: '/tracer.mp4', mimeType: 'video/mp4' }]
      }
    })
  ).rejects.toThrow('The native provider requires a media mount.');
});

test('reports source types without an installed adapter', async () => {
  await expect(
    loadProvider({
      media: null,
      nativeOptions,
      source: { type: 'unknown-provider' } as unknown as ResolvedPlayerSource
    })
  ).rejects.toThrow('No provider adapter is installed for unknown-provider.');
});
