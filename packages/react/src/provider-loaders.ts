import type { ProviderAdapter, ResolvedPlayerSource } from '@playdeck/core';
import type { HlsBuild } from '@playdeck/provider-hls';
import type { NativePlaybackOptions } from '@playdeck/provider-native';
import type { VimeoProviderOptions } from '@playdeck/provider-vimeo';
import type { WistiaProviderOptions } from '@playdeck/provider-wistia';
import type { YouTubeProviderOptions } from '@playdeck/provider-youtube';

export type PlayerMediaMount = HTMLVideoElement | HTMLDivElement;

// Every bag below is guarded to this except `youtube`'s: fields whose value is
// a string, a number, a boolean, or absent. `providerBagEqual`
// (`use-activation.ts`) compares a bag's own keys with `Object.is`, which is
// only meaningful for a value that is itself its own identity -- a function or
// another object compares unequal to a value equal to it in every way that
// matters, so a bag holding one would retire the provider's activation
// identity, and rebuild its engine, on every render that passes it inline
// (#579). `PrimitiveOptionBag` turns a bag that stops being able to promise
// that into a compile error at the bag's own declaration below, rather than a
// rebuilt engine and a lost playback position discovered by a consumer.
//
// `youtube` cannot take it as written. `loadIframeApi` is a function, and a
// documented one: `docs/third-party-requests.md`'s "YouTube's is reachable
// through `Player.Root`" names it as the deliberate, CSP-motivated exception
// to Wistia's script injector staying construction-only. It already carries
// the exact hazard this guard exists to catch -- an inline
// `providerOptions={{ youtube: { loadIframeApi: () => ... } }}` retires the
// YouTube activation every render today, and nothing says so -- but that is a
// pre-existing gap this guard turned up while adding `hls`'s, not one #579
// closes on the way past; it wants its own design decision, the way this
// issue's own did.
type PrimitiveOptionValue = string | number | boolean | undefined;

// Exported for `provider-loaders.test.ts` alone, to prove the constraint
// itself rejects a function-valued key at the type level -- not just that one
// particular bag happens not to declare one.
export type PrimitiveOptionBag<
  Bag extends Record<string, PrimitiveOptionValue>
> = Bag;

/**
 * Options a single provider accepts that no Playdeck prop covers, keyed by
 * provider. Wistia's embed carries presentation options -- a player colour, a
 * swatch, a poster -- that only that provider has. HLS carries one option of
 * its own, `build` (#579): which hls.js build `loadProvider` loads, `'full'`
 * (its default) or `'light'`. It is a name rather than the `loadHls` loader
 * function `HlsProviderOptions` (`@playdeck/provider-hls`) also accepts,
 * because a function cannot satisfy `PrimitiveOptionBag` above; reaching
 * `loadHls` itself -- to pin an hls.js version or serve it from somewhere
 * else -- still means mounting `createHlsProvider` directly, the way
 * `apps/storybook/stories/hls-build.stories.tsx` does. The native provider
 * still waits on its own issue, so its absence here remains deliberate.
 *
 * `controls`, `loop`, `startTime` and `endTime` are cross-provider concepts and
 * live on `Root` as its own props (ADR-0004). Each is omitted here from the bags
 * `Root`'s fan-out actually reaches, which makes the double home
 * unrepresentable rather than merely discouraged -- and they do not reach the
 * same set. `loop`, `startTime` and `endTime` are omitted from all three.
 * `controls` is omitted from `youtube` and `vimeo`
 * only: Wistia has the concept
 * (`provider-wistia/src/attachment.ts:240`, `if (options.controls !== true)`)
 * but no fold in `resolvedProviderOptions` writes it, so the bag key is still
 * the only way to reach it and stays. That asymmetry is ADR-0004's own
 * Consequences section, not an oversight here.
 *
 * `loop` was the exception until SIDEPRO-210. It reached the native and HLS
 * providers inside `NativePlaybackOptions` and no further, so the `wistia` bag
 * key was the only way to loop an embed. `Root` now folds `loop` into the
 * active provider's own bag (`root.tsx`'s `resolvedProviderOptions`) exactly as
 * it folds `controls`, and every provider answers it: Wistia by setting
 * `endVideoBehavior` (`provider-wistia/src/attachment.ts:243`,
 * `if (options.loop === true)`), Vimeo and YouTube by an embed parameter, and
 * native and HLS by the `<video>` element's own attribute. The bag keys remain
 * as the provider-level channel that fold writes to; what is gone is the
 * consumer-facing second spelling.
 *
 * `startTime` and `endTime` were the same exception until #214, and a wider
 * one: they reached the native and HLS providers inside `NativePlaybackOptions`
 * and no embed bag declared them at all, so neither prop nor bag key could bound
 * a YouTube, Vimeo or Wistia source. Each provider now declares both and
 * enforces the boundary itself, `Root` folds both into the active provider's bag
 * beside `loop`, and the keys are omitted here for the same one-home reason.
 */
export type PlayerProviderOptions = {
  readonly wistia?: PrimitiveOptionBag<
    Omit<WistiaProviderOptions, 'endTime' | 'loop' | 'startTime'>
  >;
  // Not `PrimitiveOptionBag`-wrapped: see the comment above it for why
  // `loadIframeApi` keeps this bag out of the guard for now.
  readonly youtube?: Omit<
    YouTubeProviderOptions,
    'controls' | 'endTime' | 'loop' | 'startTime'
  >;
  readonly vimeo?: PrimitiveOptionBag<
    Omit<VimeoProviderOptions, 'controls' | 'endTime' | 'loop' | 'startTime'>
  >;
  readonly hls?: PrimitiveOptionBag<{ readonly build?: HlsBuild }>;
};

/**
 * What `Root` actually hands the loader: the public bags with `Root`'s own
 * `controls`, `loop`, `startTime` and `endTime` folded into each provider that
 * has an answer to them. `hls` folds nothing in -- `loop`, `startTime` and
 * `endTime` already reach it through `nativeOptions`, the way they reach the
 * native provider -- so it carries the same shape here as it does above.
 */
export type ResolvedProviderOptions = {
  readonly wistia?: WistiaProviderOptions;
  readonly youtube?: YouTubeProviderOptions;
  readonly vimeo?: VimeoProviderOptions;
  readonly hls?: PlayerProviderOptions['hls'];
};

export type ProviderLoaderRequest = {
  readonly source: ResolvedPlayerSource;
  readonly media: PlayerMediaMount | null;
  readonly nativeOptions: NativePlaybackOptions;
  readonly providerOptions?: ResolvedProviderOptions;
};

export const loadProvider = async ({
  media,
  nativeOptions,
  providerOptions,
  source
}: ProviderLoaderRequest): Promise<ProviderAdapter> => {
  if (source.type === 'hls') {
    if (!media || !(media instanceof HTMLVideoElement)) {
      throw new Error('The HLS provider requires a media mount.');
    }
    const { createHlsProvider } = await import('@playdeck/provider-hls');
    return createHlsProvider(media, source, {
      ...nativeOptions,
      ...providerOptions?.hls
    });
  }
  if (source.type === 'video') {
    if (!media || !(media instanceof HTMLVideoElement)) {
      throw new Error('The native provider requires a media mount.');
    }
    const { createNativeProvider } = await import('@playdeck/provider-native');
    return createNativeProvider(media, nativeOptions);
  }
  if (source.type === 'youtube') {
    if (!media) {
      throw new Error('The YouTube provider requires a media mount.');
    }
    const { createYouTubeProvider } =
      await import('@playdeck/provider-youtube');
    return createYouTubeProvider(
      media,
      source.videoId,
      providerOptions?.youtube
    );
  }
  if (source.type === 'vimeo') {
    if (!media) {
      throw new Error('The Vimeo provider requires a media mount.');
    }
    const { createVimeoProvider } = await import('@playdeck/provider-vimeo');
    return createVimeoProvider(media, source, providerOptions?.vimeo);
  }
  if (source.type === 'wistia') {
    if (!media) {
      throw new Error('The Wistia provider requires a media mount.');
    }
    const { createWistiaProvider } = await import('@playdeck/provider-wistia');
    return createWistiaProvider(media, source, providerOptions?.wistia);
  }
  // Every known source type is handled above, so `source` narrows to `never`
  // here; read the type defensively for a runtime-only unknown source.
  const unknownType = (source as { type?: string }).type ?? 'unknown';
  throw new Error(`No provider adapter is installed for ${unknownType}.`);
};
