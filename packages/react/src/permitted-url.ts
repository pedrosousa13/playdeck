import { isPermittedSourceUrl, resolveNetworkPath } from '@playdeck/core';

// Internal to packages/react -- not exported from the package's entry point
// (`index.tsx`). Every consumer-supplied URL prop the React layer renders
// (poster `src`, poster `srcSet` candidates, `nativePoster`, text-track
// `src`) funnels through the shared allowlist this way rather than each site
// repeating its own check-then-resolve pair (#236). `undefined` is passed for
// `isPermittedSourceUrl`'s `type` inline below, not taken as a parameter here:
// no call site in this package is the explicit-object `type: 'video'` path,
// so a parameter for it would be speculative, and `blob:` is refused for
// every one of these props as a result.
export const permittedUrl = (url: string | undefined): string | undefined =>
  url !== undefined && isPermittedSourceUrl(url, undefined)
    ? resolveNetworkPath(url)
    : undefined;
