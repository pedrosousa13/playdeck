import type { Availability, VimeoSource } from '@playdeck/core';
import { available, providerCheck } from './adapter-values.js';
import {
  createVimeoOembedRequest,
  type VimeoOembedOutcome,
  type VimeoOembedRequest
} from './oembed-availability.js';

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

// Reads the shared oEmbed outcome the way this capability cares about it: a
// request that never answered -- whatever the cause -- reports the same as
// never having asked, since a later attempt is still free to resolve it, and
// only a record Vimeo actually returned can say there is no thumbnail.
const posterFromOutcome = (outcome: VimeoOembedOutcome): VimeoPosterProbe => {
  if (!outcome.responded || outcome.record === undefined) return unresolved;
  const thumbnailUrl =
    'thumbnail_url' in outcome.record &&
    typeof outcome.record.thumbnail_url === 'string' &&
    outcome.record.thumbnail_url.length > 0
      ? outcome.record.thumbnail_url
      : undefined;
  if (!thumbnailUrl) {
    return {
      availability: { status: 'unavailable', reason: 'source' },
      url: null
    };
  }
  return { availability: available, url: thumbnailUrl };
};

export type VimeoPosterAvailabilityDeps = {
  readonly source: Pick<VimeoSource, 'videoId' | 'hash'>;
  // Opt-in: without it, this seam never asks Vimeo's oEmbed endpoint for a
  // thumbnail, so no request discloses the viewer before a consumer has asked
  // for the provider's own poster.
  readonly options: {
    readonly resolvePoster?: boolean;
  };
  // The oEmbed request to probe through. Shared with
  // `chromeless-availability.ts` by `createVimeoProvider` so a source opting
  // into both `resolvePoster` and `customControls` pays for one GET, not two
  // (#556, `oembed-availability.ts`). Standalone construction (this package's
  // own tests) omits it and gets a private instance, which behaves exactly as
  // this probe always has.
  readonly oembedRequest?: VimeoOembedRequest;
};

// The poster-availability seam: whether this embed can supply its own still,
// and what it is. Modelled on `chromeless-availability.ts` -- an oEmbed probe
// rather than the customControls probe's response, because a consumer asking
// for the poster alone must not depend on `customControls` also being opted
// into; the two now share the same request when both are, through
// `oembedRequest`.
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
  options,
  oembedRequest = createVimeoOembedRequest(source)
}: VimeoPosterAvailabilityDeps): VimeoPosterAvailability => {
  let availability: Availability = providerCheck;
  let url: string | null = null;

  return {
    probe: () => {
      if (options.resolvePoster !== true) return Promise.resolve(unresolved);
      return oembedRequest.request('poster').then(posterFromOutcome);
    },
    adopt: (probe) => {
      availability = probe.availability;
      url = probe.url;
    },
    cancel: () => {
      oembedRequest.cancel();
    },
    availability: () => availability,
    url: () => url
  };
};
