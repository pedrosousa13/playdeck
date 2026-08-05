import { detectSource } from '@reely/core';
import { useEffect, useState } from 'react';

/**
 * What `thumbnailEndpoint` needs beyond the endpoint itself: which provider's
 * image-host allowlist a response from it must be checked against. Kept
 * internal — the exported surface stays the plain `string | undefined` it
 * was before `detectSource` backed it.
 */
type ThumbnailSource = {
  readonly provider: 'youtube' | 'vimeo';
  readonly endpoint: string;
};

/**
 * Resolves a URL to the oEmbed endpoint that returns its thumbnail, by
 * deferring entirely to `@reely/core`'s `detectSource` rather than matching
 * the URL a second time. `undefined` for anything `detectSource` rejects, and
 * for every resolved source with no oEmbed concept — Wistia carries its own
 * preview, native files and HLS have none. Both provider endpoints are built
 * from `detectSource`'s parsed `videoId` (and Vimeo's optional `hash`), not
 * from the input URL, so a Shorts or `youtu.be` link produces the same
 * canonical `watch?v=` endpoint as the watch URL it points at.
 */
const resolveThumbnailSource = (url: string): ThumbnailSource | undefined => {
  const result = detectSource(url);
  if (result.status !== 'success') return undefined;
  const { source } = result;

  if (source.type === 'youtube') {
    const canonicalUrl = `https://www.youtube.com/watch?v=${source.videoId}`;
    return {
      provider: 'youtube',
      endpoint: `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`
    };
  }

  if (source.type === 'vimeo') {
    const canonicalUrl = `https://vimeo.com/${source.videoId}${source.hash ? `/${source.hash}` : ''}`;
    return {
      provider: 'vimeo',
      endpoint: `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(canonicalUrl)}&width=1280`
    };
  }

  return undefined;
};

export const thumbnailEndpoint = (url: string): string | undefined =>
  resolveThumbnailSource(url)?.endpoint;

const isYouTubeImageHost = (hostname: string): boolean =>
  hostname === 'img.youtube.com' ||
  hostname === 'ytimg.com' ||
  hostname.endsWith('.ytimg.com');

const isVimeoImageHost = (hostname: string): boolean =>
  hostname === 'vimeocdn.com' || hostname.endsWith('.vimeocdn.com');

/**
 * Whether a `thumbnail_url` from an oEmbed response is safe to hand to an
 * `<img src>`: `https:` and a hostname on the queried provider's own image
 * hosts. Anything else — a non-string value, an unparseable URL, `http:`, or
 * a host outside the allowlist (including the *other* provider's hosts) —
 * resolves to `undefined` like every other failure in this hook. Validated
 * rather than escaped: the renderer is a plain `<img src>`
 * (`video-cover-image.tsx`) with no inline style and no `background-image`,
 * so the risk closed here is an arbitrary cross-origin fetch, not script
 * execution.
 */
const trustedThumbnailUrl = (
  value: unknown,
  provider: 'youtube' | 'vimeo'
): string | undefined => {
  if (typeof value !== 'string') return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:') return undefined;
  const isAllowedHost =
    provider === 'youtube'
      ? isYouTubeImageHost(parsed.hostname)
      : isVimeoImageHost(parsed.hostname);
  return isAllowedHost ? value : undefined;
};

// Keyed by endpoint so a second mount of the same source reuses the
// in-flight or settled promise instead of paying for another round trip.
// `clearThumbnailCache` exists only because this module-level cache
// otherwise leaks a thumbnail (or its absence) between test files that
// share an endpoint string; nothing in the app calls it.
const thumbnailCache = new Map<string, Promise<string | undefined>>();

export const clearThumbnailCache = (): void => {
  thumbnailCache.clear();
};

const fetchThumbnail = (
  source: ThumbnailSource
): Promise<string | undefined> => {
  const cached = thumbnailCache.get(source.endpoint);
  if (cached) return cached;

  const promise = fetch(source.endpoint)
    .then((response) => (response.ok ? response.json() : undefined))
    .then((data: unknown) =>
      trustedThumbnailUrl(
        (data as { thumbnail_url?: unknown } | undefined)?.thumbnail_url,
        source.provider
      )
    )
    .catch(() => undefined)
    .then((thumbnail) => {
      // A transient failure should not poison every future mount, so only a
      // resolved thumbnail stays cached.
      if (thumbnail === undefined) thumbnailCache.delete(source.endpoint);
      return thumbnail;
    });

  thumbnailCache.set(source.endpoint, promise);
  return promise;
};

/**
 * The cover Backpack's `light` prop shows before the player mounts: a
 * caller-supplied image if there is one, otherwise a thumbnail fetched from
 * the source's oEmbed endpoint. Mirrors Backpack's `useVideoData`, minus its
 * duration tracking — Reely reports duration through the player itself once
 * mounted, so a cover-only hook has no use for it.
 *
 * A thumbnail is decoration, never a requirement: anything that goes wrong —
 * no endpoint, a rejected fetch, a non-OK response, unparseable JSON, a
 * missing or untrusted `thumbnail_url` — resolves to `undefined` rather than
 * surfacing an error.
 *
 * `light: true` costs one request to the provider's oEmbed endpoint at
 * mount, before any interaction, and this cannot be deferred until the click
 * without defeating the cover — the cover *is* the pre-click surface, so a
 * thumbnail fetched after the click would never be seen. Backpack's own
 * default has the same shape for the same reason.
 */
export const useVideoThumbnail = (
  url: string | undefined,
  placeholderImageSrc?: string
): string | undefined => {
  // A caller that already has a cover never pays for a lookup, and a `url`
  // with no endpoint has nothing to fetch — both are derived synchronously,
  // so the effect below only ever runs for a source actually worth fetching.
  const source =
    placeholderImageSrc || !url ? undefined : resolveThumbnailSource(url);
  const endpoint = source?.endpoint;
  // Keyed by the endpoint it was fetched for, so a thumbnail can never outlive
  // the source it belongs to. The reset happens during render rather than from
  // the effect below — the workbench exposes `url` as a control, and an effect
  // would leave the previous provider's image on screen for a frame before the
  // new lookup even starts.
  const [fetched, setFetched] = useState<{
    readonly endpoint: string | undefined;
    readonly thumbnail: string | undefined;
  }>({ endpoint, thumbnail: undefined });
  if (fetched.endpoint !== endpoint) {
    setFetched({ endpoint, thumbnail: undefined });
  }
  const fetchedThumbnail =
    fetched.endpoint === endpoint ? fetched.thumbnail : undefined;

  useEffect(() => {
    if (!source) return;

    // No `AbortController`: the promise is now shared across mounts via
    // `thumbnailCache`, so aborting it for this unmount would poison it for
    // every other mount awaiting the same endpoint. A late result for a
    // source this hook has since moved on from is instead ignored here.
    let cancelled = false;

    fetchThumbnail(source).then((thumbnail) => {
      if (cancelled) return;
      setFetched({ endpoint: source.endpoint, thumbnail });
    });

    return () => {
      cancelled = true;
    };
    // `source` is a fresh object every render; depending on it would refetch
    // on every render rather than only when the resolved source actually
    // changes, so its two primitive fields are the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.endpoint, source?.provider]);

  if (placeholderImageSrc) return placeholderImageSrc;
  if (!endpoint) return undefined;
  return fetchedThumbnail;
};
