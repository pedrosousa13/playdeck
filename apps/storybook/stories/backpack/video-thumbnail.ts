import { useEffect, useState } from 'react';

/**
 * Backpack's Shorts normalisation (`useVideoData.ts`'s `normalizeVideoUrl`) —
 * YouTube's oEmbed endpoint rejects the Shorts URL shape, so a Shorts link is
 * rewritten to the `watch?v=` shape before it is looked up.
 */
const normalizeYouTubeUrl = (url: string): string => {
  const shortsMatch = url.match(/youtube\.com\/shorts\/([^/?&]+)/);
  return shortsMatch
    ? `https://www.youtube.com/watch?v=${shortsMatch[1]}`
    : url;
};

const isYouTubeUrl = (url: string): boolean =>
  /youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/shorts\//.test(url);

const isVimeoUrl = (url: string): boolean => /vimeo\.com\//.test(url);

/**
 * Maps a video source to the oEmbed endpoint that returns its thumbnail.
 * `undefined` for anything with no such lookup — Wistia carries its own
 * preview, native files and HLS have no oEmbed concept, and an unrecognised
 * URL simply has none.
 */
export const thumbnailEndpoint = (url: string): string | undefined => {
  if (isYouTubeUrl(url)) {
    const normalised = normalizeYouTubeUrl(url);
    return `https://www.youtube.com/oembed?url=${encodeURIComponent(normalised)}&format=json`;
  }
  if (isVimeoUrl(url)) {
    return `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}&width=1280`;
  }
  return undefined;
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
 * missing or non-string `thumbnail_url` — resolves to `undefined` rather than
 * surfacing an error.
 */
export const useVideoThumbnail = (
  url: string | undefined,
  placeholderImageSrc?: string
): string | undefined => {
  // A caller that already has a cover never pays for a lookup, and a `url`
  // with no endpoint has nothing to fetch — both are derived synchronously,
  // so the effect below only ever runs for a source actually worth fetching.
  const endpoint =
    placeholderImageSrc || !url ? undefined : thumbnailEndpoint(url);
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
    if (!endpoint) return;

    const controller = new AbortController();

    fetch(endpoint, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((data: unknown) => {
        // Guards against a response landing after this `endpoint` is no
        // longer the current one.
        if (controller.signal.aborted) return;
        const thumbnailUrl = (data as { thumbnail_url?: unknown } | undefined)
          ?.thumbnail_url;
        setFetched({
          endpoint,
          thumbnail: typeof thumbnailUrl === 'string' ? thumbnailUrl : undefined
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFetched({ endpoint, thumbnail: undefined });
        }
      });

    return () => controller.abort();
  }, [endpoint]);

  if (placeholderImageSrc) return placeholderImageSrc;
  if (!endpoint) return undefined;
  return fetchedThumbnail;
};
