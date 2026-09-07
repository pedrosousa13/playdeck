import type { Availability, WistiaSource } from '@playdeck/core';
import { available, providerCheck } from './adapter-values.js';

// What a poster probe settled on: the capability verdict for
// `PlayerCapabilities.providerPoster` and the still it found, together, since
// a `null` url only means something once paired with the verdict that
// explains it (pending, or genuinely absent).
export type WistiaPosterProbe = {
  readonly availability: Availability;
  readonly url: string | null;
};

const unresolved: WistiaPosterProbe = {
  availability: providerCheck,
  url: null
};

// The probe joins the ready patch's own async work (`attachment.ts`), so an
// oEmbed request that never answers must not hold `ready` open forever --
// the same reasoning, and the same figure, as Vimeo's poster probe
// (`provider-vimeo/src/poster-availability.ts`).
export const POSTER_PROBE_TIMEOUT_MS = 4000;

// oEmbed matching is host-agnostic (docs.wistia.com/docs/wistia-and-oembed):
// any subdomain in the `url` parameter resolves the same media, so `home` --
// Wistia's own documented example -- needs no per-account subdomain on hand.
const wistiaMediaUrl = (mediaId: string): string =>
  `https://home.wistia.com/medias/${mediaId}`;

const resolveWistiaPoster = async (
  mediaId: string,
  signal: AbortSignal
): Promise<WistiaPosterProbe> => {
  try {
    const response = await fetch(
      `https://fast.wistia.com/oembed?url=${encodeURIComponent(
        wistiaMediaUrl(mediaId)
      )}&format=json`,
      { signal }
    );
    if (!response.ok) return unresolved;
    const data: unknown = await response.json();
    const thumbnailUrl =
      typeof data === 'object' &&
      data !== null &&
      'thumbnail_url' in data &&
      typeof data.thumbnail_url === 'string' &&
      data.thumbnail_url.length > 0
        ? data.thumbnail_url
        : undefined;
    if (!thumbnailUrl) {
      return {
        availability: { status: 'unavailable', reason: 'source' },
        url: null
      };
    }
    return { availability: available, url: thumbnailUrl };
  } catch {
    // A request that never produced an answer -- rejected, or aborted by
    // `cancel()` or the deadline below -- reports the same as never having
    // asked: `unknown` rather than a false `unavailable`, so a later attempt
    // is still free to resolve it.
    return unresolved;
  }
};

export type WistiaPosterAvailabilityDeps = {
  readonly source: Pick<WistiaSource, 'mediaId'>;
  // Opt-in: without it, this seam never asks Wistia's oEmbed endpoint for a
  // thumbnail, so no request discloses the viewer before a consumer has asked
  // for the provider's own poster.
  readonly options: {
    readonly resolvePoster?: boolean;
  };
};

// The poster-availability seam: whether this embed can supply its own still,
// and what it is. Modelled on `provider-vimeo`'s seam of the same name -- a
// dedicated oEmbed request, opt-in, cancelled on teardown and bounded by its
// own deadline so it can never hold the ready patch open indefinitely.
export type WistiaPosterAvailability = {
  // Starts the probe. Resolves immediately, without a request, unless
  // `resolvePoster` was opted into.
  readonly probe: () => Promise<WistiaPosterProbe>;
  // Records a probed verdict. Kept separate from `probe` so an attach that has
  // been superseded by the time its probe settles cannot overwrite the verdict
  // a live one adopted.
  readonly adopt: (probe: WistiaPosterProbe) => void;
  // Abandons the probe in flight: aborts its request so a discarded embed
  // stops talking to Wistia.
  readonly cancel: () => void;
  readonly availability: () => Availability;
  readonly url: () => string | null;
};

export const createWistiaPosterAvailability = ({
  source,
  options
}: WistiaPosterAvailabilityDeps): WistiaPosterAvailability => {
  let availability: Availability = providerCheck;
  let url: string | null = null;
  let activeRequest: AbortController | undefined;

  return {
    probe: () => {
      if (options.resolvePoster !== true) return Promise.resolve(unresolved);
      activeRequest?.abort();
      const controller = new AbortController();
      activeRequest = controller;
      const request = resolveWistiaPoster(
        source.mediaId,
        controller.signal
      ).finally(() => {
        if (activeRequest === controller) activeRequest = undefined;
      });
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          controller.abort();
          resolve(unresolved);
        }, POSTER_PROBE_TIMEOUT_MS);
        request.then((result) => {
          clearTimeout(timer);
          resolve(result);
        });
      });
    },
    adopt: (probe) => {
      availability = probe.availability;
      url = probe.url;
    },
    cancel: () => {
      activeRequest?.abort();
    },
    availability: () => availability,
    url: () => url
  };
};
