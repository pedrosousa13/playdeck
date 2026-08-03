import type { ProviderAdapter, ResolvedPlayerSource } from '@reely/core';
import type { NativePlaybackOptions } from '@reely/provider-native';

export type PlayerMediaMount = HTMLVideoElement | HTMLDivElement;

export type ProviderLoaderRequest = {
  readonly source: ResolvedPlayerSource;
  readonly media: PlayerMediaMount | null;
  readonly nativeOptions: NativePlaybackOptions;
};

export const loadProvider = async ({
  media,
  nativeOptions,
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
    return createWistiaProvider(media, source);
  }
  // Every known source type is handled above, so `source` narrows to `never`
  // here; read the type defensively for a runtime-only unknown source.
  const unknownType = (source as { type?: string }).type ?? 'unknown';
  throw new Error(`No provider adapter is installed for ${unknownType}.`);
};
