// @vitest-environment happy-dom

import { expect, expectTypeOf, test, vi } from 'vitest';
import type { ResolvedPlayerSource } from '@reely/core';
import type { VimeoProviderOptions } from '@reely/provider-vimeo';
import type { WistiaProviderOptions } from '@reely/provider-wistia';
import type { YouTubeProviderOptions } from '@reely/provider-youtube';
import type { PlayerProviderOptions } from '../src/provider-loaders';
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

// What a provider's own options type declares that its `Root`-facing bag does
// not expose -- the keys ADR-0004 moved onto `Root` itself.
type KeysRootOwns<Bag, Options> = Exclude<
  keyof Options,
  keyof NonNullable<Bag>
>;

// `docs/third-party-requests.md` tells a consumer which origins a page can
// reach and what its CSP must allow, and it argues that from this shape: which
// providers have a bag at all, and which options `Root` keeps for itself. When
// the shape moved, the document did not, and the drift survived two edits to it
// because nothing checked (#216). These are type-level claims, so they fail
// `pnpm typecheck` rather than the runtime run -- the same way
// `packages/core/test/activation.test.ts` states a claim about a type.
test('the per-provider option bags are the shape the CSP document describes', () => {
  // Gaining or losing a provider key changes which rows of that document's
  // origins table are reachable through `Player.Root` at all.
  expectTypeOf<keyof PlayerProviderOptions>().toEqualTypeOf<
    'vimeo' | 'wistia' | 'youtube'
  >();

  // Vimeo's omissions are load-bearing for the document twice over: what stays
  // is what a `Player.Root` consumer can set, and `customControls` staying is
  // why `vimeo.com` belongs in `connect-src`.
  expectTypeOf<
    KeysRootOwns<PlayerProviderOptions['vimeo'], VimeoProviderOptions>
  >().toEqualTypeOf<'controls' | 'endTime' | 'loop' | 'startTime'>();

  expectTypeOf<
    KeysRootOwns<PlayerProviderOptions['youtube'], YouTubeProviderOptions>
  >().toEqualTypeOf<'controls' | 'endTime' | 'loop' | 'startTime'>();

  // Wistia keeps `controls`: it has the concept but no fold writes it, so the
  // bag key is still the only way to reach it (ADR-0004's Consequences).
  expectTypeOf<
    KeysRootOwns<PlayerProviderOptions['wistia'], WistiaProviderOptions>
  >().toEqualTypeOf<'endTime' | 'loop' | 'startTime'>();
});

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
