import type { Availability, VimeoSource } from '@playdeck/core';
import { available, providerCheck } from './adapter-values.js';
import { vimeoWatchUrl } from './chromeless-availability.js';

// What a poster probe settled on: the capability verdict for
// `PlayerCapabilities.providerPoster` and the still it found, together, since
// a `null` url only means something once paired with the verdict that
// explains it (pending, or genuinely absent).
export type VimeoPosterProbe = {
  readonly availability: Availability;
  readonly url: string | null;
};

const unresolved: VimeoPosterProbe = { availability: providerCheck, url: null };

// The poster probe joins the same `Promise.all` the ready patch awaits
// (`attachment.ts`), so an oEmbed request that never answers must not hold
// `ready` open forever -- the same reasoning `CHROMELESS_PROBE_TIMEOUT_MS`
// bounds the plan probe with, and the same figure: both ask the same
// endpoint and are well inside it on a live request.
export const POSTER_PROBE_TIMEOUT_MS = 4000;

const resolveVimeoPoster = async (
  source: Pick<VimeoSource, 'videoId' | 'hash'>,
  signal: AbortSignal
): Promise<VimeoPosterProbe> => {
  try {
    const response = await fetch(
      `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(
        vimeoWatchUrl(source)
      )}`,
      // Same policy the chromeless probe declares, and for the same reason:
      // this keeps the origin an unrestricted embed's domain check reads while
      // dropping the path and query a wider page policy would otherwise leak
      // (#334, see "What referrer each embed sends" in
      // docs/third-party-requests.md).
      { signal, referrerPolicy: 'strict-origin-when-cross-origin' }
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
    // `cancel()` below -- reports the same as never having asked: `unknown`
    // rather than a false `unavailable`, so a later attempt is still free to
    // resolve it.
    return unresolved;
  }
};

export type VimeoPosterAvailabilityDeps = {
  readonly source: Pick<VimeoSource, 'videoId' | 'hash'>;
  // Opt-in: without it, this seam never asks Vimeo's oEmbed endpoint for a
  // thumbnail, so no request discloses the viewer before a consumer has asked
  // for the provider's own poster.
  readonly options: {
    readonly resolvePoster?: boolean;
  };
};

// The poster-availability seam: whether this embed can supply its own still,
// and what it is. Modelled on `chromeless-availability.ts` -- a dedicated
// oEmbed request rather than the customControls probe's response, because
// that probe only fires when `customControls` is opted into and a consumer
// asking for the poster alone must not depend on that.
export type VimeoPosterAvailability = {
  // Starts the probe. Resolves immediately, without a request, unless
  // `resolvePoster` was opted into.
  readonly probe: () => Promise<VimeoPosterProbe>;
  // Records a probed verdict. Kept separate from `probe` so an attach that has
  // been superseded by the time its probe settles cannot overwrite the verdict
  // a live one adopted.
  readonly adopt: (probe: VimeoPosterProbe) => void;
  // Abandons the probe in flight, the way `chromeless.cancel()` does: aborts
  // its request so a discarded embed stops talking to Vimeo.
  readonly cancel: () => void;
  readonly availability: () => Availability;
  readonly url: () => string | null;
};

export const createVimeoPosterAvailability = ({
  source,
  options
}: VimeoPosterAvailabilityDeps): VimeoPosterAvailability => {
  let availability: Availability = providerCheck;
  let url: string | null = null;
  let activeRequest: AbortController | undefined;

  return {
    probe: () => {
      if (options.resolvePoster !== true) return Promise.resolve(unresolved);
      activeRequest?.abort();
      const controller = new AbortController();
      activeRequest = controller;
      const request = resolveVimeoPoster(source, controller.signal).finally(
        () => {
          if (activeRequest === controller) activeRequest = undefined;
        }
      );
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
