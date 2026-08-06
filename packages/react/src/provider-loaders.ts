import type { ProviderAdapter, ResolvedPlayerSource } from '@reely/core';
import type { NativePlaybackOptions } from '@reely/provider-native';
import type { VimeoProviderOptions } from '@reely/provider-vimeo';
import type { WistiaProviderOptions } from '@reely/provider-wistia';
import type { YouTubeProviderOptions } from '@reely/provider-youtube';

export type PlayerMediaMount = HTMLVideoElement | HTMLDivElement;

/**
 * Options a single provider accepts that no Reely prop covers, keyed by
 * provider. Wistia's embed carries presentation options -- a player colour, a
 * swatch, a poster -- that only that provider has. The native and HLS
 * providers wait on their own issues, so a missing key here is a deliberate
 * absence rather than an oversight.
 *
 * `controls` and `loop` are deliberately absent from every bag that has a
 * notion of them: both are cross-provider concepts and live on `Root` as its
 * own props (ADR-0004), so omitting them here makes the double home
 * unrepresentable rather than merely discouraged.
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
 */
export type PlayerProviderOptions = {
  readonly wistia?: Omit<WistiaProviderOptions, 'loop'>;
  readonly youtube?: Omit<YouTubeProviderOptions, 'controls' | 'loop'>;
  readonly vimeo?: Omit<VimeoProviderOptions, 'controls' | 'loop'>;
};

/**
 * What `Root` actually hands the loader: the public bags with `Root`'s own
 * `controls` and `loop` folded into each provider that has an answer to them.
 */
export type ResolvedProviderOptions = {
  readonly wistia?: WistiaProviderOptions;
  readonly youtube?: YouTubeProviderOptions;
  readonly vimeo?: VimeoProviderOptions;
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
    const { createHlsProvider } = await import('@reely/provider-hls');
    return createHlsProvider(media, source, nativeOptions);
  }
  if (source.type === 'video') {
    if (!media || !(media instanceof HTMLVideoElement)) {
      throw new Error('The native provider requires a media mount.');
    }
    const { createNativeProvider } = await import('@reely/provider-native');
    return createNativeProvider(media, nativeOptions);
  }
  if (source.type === 'youtube') {
    if (!media) {
      throw new Error('The YouTube provider requires a media mount.');
    }
    const { createYouTubeProvider } = await import('@reely/provider-youtube');
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
    const { createVimeoProvider } = await import('@reely/provider-vimeo');
    return createVimeoProvider(media, source, providerOptions?.vimeo);
  }
  if (source.type === 'wistia') {
    if (!media) {
      throw new Error('The Wistia provider requires a media mount.');
    }
    const { createWistiaProvider } = await import('@reely/provider-wistia');
    return createWistiaProvider(media, source, providerOptions?.wistia);
  }
  // Every known source type is handled above, so `source` narrows to `never`
  // here; read the type defensively for a runtime-only unknown source.
  const unknownType = (source as { type?: string }).type ?? 'unknown';
  throw new Error(`No provider adapter is installed for ${unknownType}.`);
};
