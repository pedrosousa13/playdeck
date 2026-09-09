import type { ProviderAdapter } from '@playdeck/core';
import { createNativeProvider } from '@playdeck/provider-native';
import type { ProviderRegistration } from '@playdeck/react';
import { assetUrl } from './asset-url';

// A test-local provider for a source kind `@playdeck/react` ships no loader
// for, built for #662's own e2e coverage. The tracker's dependency edge is
// #663 blocked_by #662, so #663's own compiled example and workbench story
// land after this one — #662 supplies its own, and this file is it.
//
// Not a first-party provider: it lives only in this Storybook app, is never
// published, and its own playback is entirely `@playdeck/provider-native`'s
// real, already-tested adapter, wrapped rather than reimplemented -- so the
// e2e spec this drives exercises the `providers` seam itself (`detect`,
// `load`, and the div mount `viewport-media.tsx` renders for a supplied kind)
// against a real `<video>` element and real playback events, rather than a
// second, parallel implementation of native playback nobody would maintain.
export type AcmeSource = { readonly type: 'acme'; readonly videoId: string };

// A host `detectSource`'s own five built-in kinds recognise nothing about --
// no YouTube/Vimeo/Wistia host, no `.mp4`/`.webm`/`.m3u8` extension -- so
// core's own detection always refuses it first and this registration's
// `detect` is what resolves it, exactly the order `Root`'s `providers` doc
// comment promises.
const ACME_URL_PREFIX = 'https://acme.example/videos/';

export const detectAcmeUrl = (url: string): AcmeSource | undefined => {
  if (!url.startsWith(ACME_URL_PREFIX)) return undefined;
  const videoId = url.slice(ACME_URL_PREFIX.length);
  return videoId.length > 0 ? { type: 'acme', videoId } : undefined;
};

// `videoId` selects nothing about which asset plays -- every id resolves to
// the same local tracer clip -- it only has to survive the round trip through
// `detect` and back out through `load`'s own factory for the e2e spec to read
// it off `window.playdeckHandle`.
const createAcmeAdapter = (
  mount: HTMLDivElement | HTMLVideoElement | null
): ProviderAdapter => {
  if (!(mount instanceof HTMLDivElement)) {
    throw new Error('The acme test provider requires a div mount.');
  }
  const video = document.createElement('video');
  video.playsInline = true;
  video.style.width = '100%';
  video.style.height = '100%';
  const source = document.createElement('source');
  source.src = assetUrl('tracer.mp4');
  source.type = 'video/mp4';
  video.append(source);
  mount.append(video);

  // `createNativeProvider` is the real, already-tested adapter every native
  // and HLS source already runs through `loadProvider` -- reused here rather
  // than reimplemented so this fixture proves the `providers` seam, not a
  // second copy of native playback. Its own `destroy` tears down its
  // listeners and the media element's own state; the `<video>` this factory
  // created is this wrapper's own responsibility to remove.
  const inner = createNativeProvider(video, {});
  return {
    ...inner,
    destroy: async () => {
      await inner.destroy();
      video.remove();
    }
  };
};

export const acmeProvider: ProviderRegistration<AcmeSource> = {
  detect: detectAcmeUrl,
  load: () => Promise.resolve(createAcmeAdapter)
};
