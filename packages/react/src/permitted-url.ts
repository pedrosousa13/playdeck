import {
  isPermittedSourceUrl,
  resolveNetworkPath,
  type ResolvedPlayerSource
} from '@reely/core';

// Internal to packages/react -- not exported from the package's entry point
// (`index.tsx`). Every consumer-supplied URL prop the React layer renders
// (poster `src`, poster `srcSet` candidates, `nativePoster`) funnels through
// the shared allowlist this way rather than each site repeating its own
// check-then-resolve pair (#236). `type` defaults to `undefined` because
// none of this package's call sites is the explicit-object `type: 'video'`
// path, so `blob:` is refused unless a caller passes that type explicitly.
export const permittedUrl = (
  url: string | undefined,
  type: ResolvedPlayerSource['type'] | undefined = undefined
): string | undefined =>
  url !== undefined && isPermittedSourceUrl(url, type)
    ? resolveNetworkPath(url)
    : undefined;
