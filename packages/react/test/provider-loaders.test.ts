// @vitest-environment happy-dom

import { expect, expectTypeOf, test, vi } from 'vitest';
import {
  detectSource,
  type ProviderAdapter,
  type ResolvedPlayerSource
} from '@playdeck/core';
import type { HlsProviderOptions } from '@playdeck/provider-hls';
import type { VimeoProviderOptions } from '@playdeck/provider-vimeo';
import type { WistiaProviderOptions } from '@playdeck/provider-wistia';
import type { YouTubeProviderOptions } from '@playdeck/provider-youtube';
import type {
  PlayerProviderOptions,
  PrimitiveOptionBag,
  ProviderRegistration,
  SuppliedProviderOptions,
  SuppliedSource
} from '../src/provider-loaders';
import {
  detectSourceWithProviders,
  loadProvider
} from '../src/provider-loaders';
import type { RootProps } from '../src/root';

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

  // Red, for `resolvePoster` joining the two omission lists below: with both
  // `Omit`s in `PlayerProviderOptions` (provider-loaders.ts) reverted to leave
  // `resolvePoster` un-omitted, `pnpm typecheck` failed here with TS2344 (the
  // actual union `'controls' | 'endTime' | 'loop' | 'resolvePoster' |
  // 'startTime'` did not satisfy the expected literal-mismatch constraint)
  // and on the `wistia` assertion further down, the same way.
  //
  // Vimeo's omissions are load-bearing for the document twice over: what stays
  // is what a `Player.Root` consumer can set, and `customControls` staying is
  // why `vimeo.com` belongs in `connect-src`.
  expectTypeOf<
    KeysRootOwns<PlayerProviderOptions['vimeo'], VimeoProviderOptions>
  >().toEqualTypeOf<
    'controls' | 'endTime' | 'loop' | 'resolvePoster' | 'startTime'
  >();

  // `youtube` keeps `loadIframeApi` too, as of #628, for the same reason `hls`
  // keeps `loadHls` just below: a function cannot satisfy `PrimitiveOptionBag`,
  // so `host` is the only key of its own `Root` folds in, and reaching
  // `loadIframeApi` itself still means mounting `createYouTubeProvider`
  // directly.
  expectTypeOf<
    KeysRootOwns<PlayerProviderOptions['youtube'], YouTubeProviderOptions>
  >().toEqualTypeOf<
    'controls' | 'endTime' | 'loadIframeApi' | 'loop' | 'startTime'
  >();

  // Wistia keeps `controls`: it has the concept but no fold writes it, so the
  // bag key is still the only way to reach it (ADR-0004's Consequences).
  expectTypeOf<
    KeysRootOwns<PlayerProviderOptions['wistia'], WistiaProviderOptions>
  >().toEqualTypeOf<'endTime' | 'loop' | 'resolvePoster' | 'startTime'>();

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

// Not just the constraint in the abstract: the real `youtube` bag itself
// (#628) has to reject the one function-valued key it used to declare, the
// same way `PlayerProviderOptions['hls']` already cannot compile `loadHls`
// into its own bag above.
test('the youtube bag rejects a function-valued loadIframeApi at the type level', () => {
  const youtubeBag: PlayerProviderOptions['youtube'] = {
    // @ts-expect-error `loadIframeApi` is a function; #628 removed it from
    // this bag so it can no longer compile here -- it stays reachable only on
    // `YouTubeProviderOptions` itself, `hls`'s `loadHls` precedent applied to
    // the provider #579 left aside.
    loadIframeApi: () => Promise.resolve({} as never)
  };
  void youtubeBag;
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

// `providers`: `Player.Root`'s seam for a source kind beyond the five above.
// The tests below drive `detectSourceWithProviders` and `loadProvider`
// directly -- the two functions `root.tsx` and `use-activation.ts` call, so a
// claim proven here is a claim proven about exactly what a consumer's
// `providers` prop reaches.
type AcmeSource = { readonly type: 'acme'; readonly videoId: string };
type AcmeOptions = { readonly quality?: 'sd' | 'hd' };

test('tries the five built-in kinds before any supplied provider, even one whose detect would also match', () => {
  const detect = vi.fn();
  const result = detectSourceWithProviders(
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    { acme: { detect, load: vi.fn() } }
  );
  expect(result).toEqual({
    status: 'success',
    input: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    source: { type: 'youtube', videoId: 'dQw4w9WgXcQ' }
  });
  expect(detect).not.toHaveBeenCalled();
});

test('walks supplied providers in declaration order, stopping at the first whose detect accepts the URL', () => {
  const url = 'https://example.com/media/42';
  const first = vi.fn(() => undefined);
  const second = vi.fn(() => ({ type: 'second', id: '42' }) as const);
  const third = vi.fn(() => ({ type: 'third', id: '42' }) as const);

  const result = detectSourceWithProviders(url, {
    first: { detect: first, load: vi.fn() },
    second: { detect: second, load: vi.fn() },
    third: { detect: third, load: vi.fn() }
  });

  expect(first).toHaveBeenCalledWith(url);
  expect(second).toHaveBeenCalledWith(url);
  expect(third).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    status: 'success',
    source: { type: 'second', id: '42' }
  });
});

test('declines a URL no built-in kind and no supplied provider recognises', () => {
  const detect = vi.fn(() => undefined);
  const result = detectSourceWithProviders('https://example.com/nothing-here', {
    acme: { detect, load: vi.fn() }
  });
  expect(detect).toHaveBeenCalledWith('https://example.com/nothing-here');
  expect(result.status).toBe('failure');
});

// The security-sensitive guarantee: a scheme the shared allowlist refuses
// never reaches a supplied provider's own `detect`, the same gate core's own
// `detectSource` applies ahead of every one of its five built-in hosts.
test('never hands a forbidden-scheme URL to a supplied detect', () => {
  const detect = vi.fn();
  const result = detectSourceWithProviders('javascript:alert(1)', {
    acme: { detect, load: vi.fn() }
  });
  expect(detect).not.toHaveBeenCalled();
  expect(result.status).toBe('failure');
});

test('behaves exactly like detectSource when no providers are supplied', () => {
  expect(
    detectSourceWithProviders('https://example.com/nothing', undefined)
  ).toEqual(detectSource('https://example.com/nothing'));
});

test('dispatches a supplied kind to its own registration, with the mount, source and its own option bag', async () => {
  const adapter = { provider: 'native' } as unknown as ProviderAdapter;
  const factory = vi.fn(async () => adapter);
  const load = vi.fn(async () => factory);
  const media = document.createElement('div');
  const source: AcmeSource = { type: 'acme', videoId: '1' };

  await expect(
    loadProvider({
      media,
      nativeOptions,
      providerOptions: { acme: { quality: 'hd' } } as never,
      providers: { acme: { detect: vi.fn(), load } },
      source
    })
  ).resolves.toBe(adapter);
  expect(load).toHaveBeenCalledOnce();
  expect(factory).toHaveBeenCalledWith(media, source, { quality: 'hd' });
});

test('reports a supplied kind with no matching registration the same way as an unrecognised type', async () => {
  await expect(
    loadProvider({
      media: null,
      nativeOptions,
      providers: { other: { detect: vi.fn(), load: vi.fn() } },
      source: { type: 'acme' } as unknown as ResolvedPlayerSource
    })
  ).rejects.toThrow('No provider adapter is installed for acme.');
});

// The inertness `provider-loaders.ts`'s own comment on `detectSourceWithProviders`
// relies on: a `providers` entry keyed by a reserved, built-in name never
// actually runs, because the five built-in branches in `loadProvider` dispatch
// on `source.type` before its own `providers` lookup ever does.
test('never lets a providers entry keyed by a built-in name intercept the built-in dispatch', async () => {
  const { createHlsProvider } = await import('@playdeck/provider-hls');
  const media = document.createElement('video');
  const source = { type: 'hls', src: '/master.m3u8' } as const;
  const suppliedLoad = vi.fn();

  await expect(
    loadProvider({
      media,
      nativeOptions,
      providers: { hls: { detect: vi.fn(), load: suppliedLoad } },
      source
    })
  ).resolves.toMatchObject({ provider: 'hls' });
  expect(createHlsProvider).toHaveBeenCalled();
  expect(suppliedLoad).not.toHaveBeenCalled();
});

test('a supplied kind types its own source shape and its own providerOptions key without weakening the five built-in kinds', () => {
  type AcmeProviders = {
    readonly acme: ProviderRegistration<AcmeSource, AcmeOptions>;
  };

  expectTypeOf<SuppliedSource<AcmeProviders>>().toEqualTypeOf<AcmeSource>();
  expectTypeOf<SuppliedProviderOptions<AcmeProviders>>().toEqualTypeOf<{
    readonly acme?: AcmeOptions;
  }>();

  // `RootProps<AcmeProviders>['source']` accepts the supplied kind's own
  // shape directly, alongside every built-in form.
  const suppliedSource: RootProps<AcmeProviders>['source'] = {
    type: 'acme',
    videoId: '1'
  };
  const builtInSource: RootProps<AcmeProviders>['source'] = {
    type: 'youtube',
    videoId: '1'
  };
  const stringSource: RootProps<AcmeProviders>['source'] =
    'https://example.com';
  void suppliedSource;
  void builtInSource;
  void stringSource;

  const options: RootProps<AcmeProviders>['providerOptions'] = {
    acme: { quality: 'hd' },
    hls: { build: 'light' }
  };
  void options;
});

test('rejects a source object whose type matches no registered kind at the type level', () => {
  type AcmeProviders = {
    readonly acme: ProviderRegistration<AcmeSource, AcmeOptions>;
  };
  // @ts-expect-error `mystery` names neither a built-in kind nor an entry of
  // `AcmeProviders`.
  const invalid: RootProps<AcmeProviders>['source'] = { type: 'mystery' };
  void invalid;
});

// The other half of "without weakening the built-in kinds' typing": a
// `RootProps` given no type argument -- every consumer who never sets
// `providers`, `root-props.test.ts`'s own subject -- accepts none of a
// supplied kind's shapes at all. Red without `PlayerSource`'s `Extra`
// defaulting to `never`: a default of `unknown` or `{}` would admit
// `AcmeSource` here even with `providers` never opted into, which is exactly
// the widening this generic parameter must not cause.
test('accepts no supplied-kind source at all when providers is never opted into', () => {
  // @ts-expect-error `AcmeSource` is not a member of the non-generic
  // `PlayerSource` union `RootProps['source']` defaults to.
  const invalid: RootProps['source'] = { type: 'acme', videoId: '1' };
  void invalid;
});
