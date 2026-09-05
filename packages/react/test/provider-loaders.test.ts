// @vitest-environment happy-dom

import { expect, expectTypeOf, test, vi } from 'vitest';
import type { ResolvedPlayerSource } from '@playdeck/core';
import type { HlsProviderOptions } from '@playdeck/provider-hls';
import type { VimeoProviderOptions } from '@playdeck/provider-vimeo';
import type { WistiaProviderOptions } from '@playdeck/provider-wistia';
import type { YouTubeProviderOptions } from '@playdeck/provider-youtube';
import type {
  PlayerProviderOptions,
  PrimitiveOptionBag
} from '../src/provider-loaders';
import { loadProvider } from '../src/provider-loaders';

vi.mock('@playdeck/provider-hls', () => ({
  createHlsProvider: vi.fn(() => ({ provider: 'hls' }))
}));

vi.mock('@playdeck/provider-native', () => ({
  createNativeProvider: vi.fn(() => ({ provider: 'native' }))
}));

vi.mock('@playdeck/provider-vimeo', () => ({
  createVimeoProvider: vi.fn(() => ({ provider: 'vimeo' }))
}));

vi.mock('@playdeck/provider-wistia', () => ({
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
    'hls' | 'vimeo' | 'wistia' | 'youtube'
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

  // `hls` keeps `loadHls`: a function cannot satisfy `PrimitiveOptionBag`
  // (below), so `build` -- the primitive `loadHls` stands in for -- is the
  // only key `Root` folds in, and reaching `loadHls` itself still means
  // mounting `createHlsProvider` directly (#579).
  expectTypeOf<
    KeysRootOwns<PlayerProviderOptions['hls'], HlsProviderOptions>
  >().toEqualTypeOf<'endTime' | 'loadHls' | 'loop' | 'startTime'>();
});

// The constraint itself, not merely a bag that happens not to declare a
// function-valued key: `providerBagEqual` (`use-activation.ts`) compares bag
// values with `Object.is`, so a bag typed through this can never again carry
// one, whichever provider adds it next.
test('PrimitiveOptionBag rejects a function-valued key at the type level', () => {
  expectTypeOf<
    // @ts-expect-error a bag whose value is a function cannot satisfy
    // `PrimitiveOptionBag` -- this is the guard #579 adds so the next
    // function-valued option (like `loadHls` almost was) fails to compile
    // instead of quietly retiring an activation on every render.
    PrimitiveOptionBag<{ loadHls: () => Promise<unknown> }>
  >().toEqualTypeOf<{ loadHls: () => Promise<unknown> }>();
});

test('dispatches vimeo sources to the vimeo adapter with the mount and source', async () => {
  const { createVimeoProvider } = await import('@playdeck/provider-vimeo');
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
  const { createWistiaProvider } = await import('@playdeck/provider-wistia');
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
  const { createWistiaProvider } = await import('@playdeck/provider-wistia');
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

test('dispatches hls sources to the hls adapter with the mount, source and native options', async () => {
  const { createHlsProvider } = await import('@playdeck/provider-hls');
  const media = document.createElement('video');
  const source = { type: 'hls', src: '/master.m3u8' } as const;
  const hlsNativeOptions = { endTime: 30, loop: true, startTime: 5 };

  await expect(
    loadProvider({ media, nativeOptions: hlsNativeOptions, source })
  ).resolves.toMatchObject({ provider: 'hls' });
  // No `hls` bag: the merge still runs, so `createHlsProvider` gets exactly
  // the native options and nothing an absent `build` would have added.
  expect(createHlsProvider).toHaveBeenCalledWith(
    media,
    source,
    hlsNativeOptions
  );
});

// #579: `build` is the primitive `PlayerProviderOptions.hls` carries through
// `Player.Root`, merged alongside the native options `createHlsProvider`
// already took -- not a second call, and not a replacement for them.
test('forwards the hls build option to the hls adapter alongside native options', async () => {
  const { createHlsProvider } = await import('@playdeck/provider-hls');
  const media = document.createElement('video');
  const source = { type: 'hls', src: '/master.m3u8' } as const;
  const hlsNativeOptions = { endTime: 30, loop: true, startTime: 5 };

  await expect(
    loadProvider({
      media,
      nativeOptions: hlsNativeOptions,
      providerOptions: { hls: { build: 'light' } },
      source
    })
  ).resolves.toMatchObject({ provider: 'hls' });
  expect(createHlsProvider).toHaveBeenCalledWith(media, source, {
    ...hlsNativeOptions,
    build: 'light'
  });
});

test('rejects hls sources without a media mount', async () => {
  await expect(
    loadProvider({
      media: null,
      nativeOptions,
      source: { type: 'hls', src: '/master.m3u8' }
    })
  ).rejects.toThrow('The HLS provider requires a media mount.');
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
