import type { ProviderAdapter, ResolvedPlayerSource } from '@reely/core';
import type { NativePlaybackOptions } from '@reely/provider-native';
import type { WistiaProviderOptions } from '@reely/provider-wistia';

export type PlayerMediaMount = HTMLVideoElement | HTMLDivElement;

/**
 * Options a single provider accepts that no Reely prop covers, keyed by
 * provider. Wistia is the only entry: its embed carries presentation options
 * -- a player colour, a swatch, a poster -- that only that provider has. The
 * native, HLS, YouTube and Vimeo providers wait on their own issues, so a
 * missing key here is a deliberate absence rather than an oversight.
 *
 * Where a Reely prop and a provider option share a name, the overlap is only
 * nominal. `Root`'s `loop` travels in `NativePlaybackOptions`, which
 * `loadProvider` hands to the native and HLS providers and to no others, so it
 * never reaches a Wistia embed; `packages/core` has no notion of looping at
 * all. `loop` in this bag is therefore not redundant -- it is the only way to
 * make a Wistia embed loop, by setting `endVideoBehavior`
 * (`provider-wistia/src/attachment.ts:209`, `if (options.loop === true)`).
 */
export type PlayerProviderOptions = {
  readonly wistia?: WistiaProviderOptions;
};

export type ProviderLoaderRequest = {
  readonly source: ResolvedPlayerSource;
  readonly media: PlayerMediaMount | null;
  readonly nativeOptions: NativePlaybackOptions;
  readonly providerOptions?: PlayerProviderOptions;
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
    return createYouTubeProvider(media, source.videoId);
  }
  if (source.type === 'vimeo') {
    if (!media) {
      throw new Error('The Vimeo provider requires a media mount.');
    }
    const { createVimeoProvider } = await import('@reely/provider-vimeo');
    return createVimeoProvider(media, source);
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
