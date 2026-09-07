import type { Availability, VimeoSource } from '@playdeck/core';
import { available, providerCheck } from './adapter-values.js';
import {
  createVimeoOembedRequest,
  type VimeoOembedOutcome,
  type VimeoOembedRequest
} from './oembed-availability.js';

// The probe races the embed's own load, and a verdict that arrives after the
// ready state has been published is no use to the consumer gating a control
// bar on it. Measured against the live oEmbed API, which answers well inside
// this.
export const CHROMELESS_PROBE_TIMEOUT_MS = 4000;

const planLimitedAccountTypes = new Set(['free', 'basic']);

// Tiers verified against the live oEmbed API plus Vimeo's documented paid
// lineups (legacy and 2023 rename). Unknown future tiers stay unresolved so a
// gated tier is never misreported as chromeless-capable.
const chromelessAccountTypes = new Set([
  'plus',
  'pro',
  'business',
  'premium',
  'enterprise',
  'custom',
  'starter',
  'standard',
  'advanced'
]);

// What a probe settled on, and whether it got to that answer or was stopped
// short of one. The verdict is the whole answer for the capability; the flag
// beside it is a separate fact, because `providerCheck` is the verdict on four
// different outcomes and only one of them is the consumer's own environment
// speaking (#235).
export type VimeoChromelessProbe = {
  readonly verdict: Availability;
  // A verdict Vimeo reported completes the probe, and so does one this seam
  // settled without asking: the two short circuits below, and an abandoned
  // probe, which withdraws the question rather than failing to get an answer.
  // Only a request that produced no response, and the deadline that gives up
  // on one, are incomplete — and those are the two the attachment reports as a
  // `configuration` notice, since a blocked or unreachable `vimeo.com` is
  // something the consumer can act on where an unusable tier is not.
  readonly completed: boolean;
};

const completed = (verdict: Availability): VimeoChromelessProbe => ({
  verdict,
  completed: true
});

// The one outcome worth a notice, and the same `providerCheck` verdict every
// other unresolved outcome carries: nothing about the fall-back changes with
// it (#235).
const incomplete: VimeoChromelessProbe = {
  verdict: providerCheck,
  completed: false
};

// Reads the shared oEmbed outcome the way this capability cares about it: a
// deliberate withdrawal reports the same as Vimeo answering -- the question
// was taken back, not left unanswered -- and only a genuine non-answer (the
// deadline, or a failure the request never recovered from) is `incomplete`.
const chromelessVerdictFromOutcome = (
  outcome: VimeoOembedOutcome
): VimeoChromelessProbe => {
  if (!outcome.responded)
    return outcome.withdrawn ? completed(providerCheck) : incomplete;
  const accountType =
    outcome.record !== undefined &&
    'account_type' in outcome.record &&
    typeof outcome.record.account_type === 'string'
      ? outcome.record.account_type
      : undefined;
  if (!accountType) return completed(providerCheck);
  if (planLimitedAccountTypes.has(accountType)) {
    return completed({ status: 'unavailable', reason: 'provider-plan' });
  }
  return completed(
    chromelessAccountTypes.has(accountType) ? available : providerCheck
  );
};

export type VimeoChromelessAvailabilityDeps = {
  readonly source: Pick<VimeoSource, 'videoId' | 'hash'>;
  // The host's options, read when the probe starts rather than snapshotted at
  // construction: an embed that draws Vimeo's own controls is never chromeless.
  readonly options: {
    readonly controls?: boolean;
    // Opt-in: without it, the probe never asks Vimeo's oEmbed endpoint about
    // the account tier, so no request discloses the viewer before anyone has
    // asked for the capability.
    readonly customControls?: boolean;
  };
  // The oEmbed request to probe through. Shared with `poster-availability.ts`
  // by `createVimeoProvider` so a source opting into both `customControls` and
  // `resolvePoster` pays for one GET, not two (#556, `oembed-availability.ts`).
  // Standalone construction (this package's own tests) omits it and gets a
  // private instance, which behaves exactly as this probe always has.
  readonly oembedRequest?: VimeoOembedRequest;
};

// The chromeless-availability seam: whether this embed will hand its controls
// over to Playdeck. Vimeo gates that on the owner's account tier and reports the
// tier nowhere in the player SDK, so the only way to know is the public oEmbed
// record — one request, raced against the attach it informs.
export type VimeoChromelessAvailability = {
  // Starts the probe. The attachment seam starts it before the player's own
  // ready settles, so the request is in flight while the embed loads. Answers
  // with the verdict and whether the probe completed, together: the caller
  // needs both, and one settled probe is the only thing that knows either.
  readonly probe: () => Promise<VimeoChromelessProbe>;
  // Records a probed verdict. Kept separate from `probe` so an attach that has
  // been superseded by the time its probe settles cannot overwrite the verdict
  // a live one adopted. Takes the whole probe result and reads the verdict off
  // it, so the caller never has to take the pair apart to record half of it.
  readonly adopt: (probe: VimeoChromelessProbe) => void;
  // Abandons the probe in flight: aborts its request and settles it on the
  // provisional verdict. The attachment calls this from its teardown, which
  // every path that discards a player already runs, so the request goes with
  // the player it informed instead of outliving it.
  readonly cancel: () => void;
  // The `customControls` facet of the host's capabilities.
  readonly customControlsAvailability: () => Availability;
};

export const createVimeoChromelessAvailability = ({
  source,
  options,
  oembedRequest = createVimeoOembedRequest(source)
}: VimeoChromelessAvailabilityDeps): VimeoChromelessAvailability => {
  let customControlsAvailability: Availability = providerCheck;

  return {
    // This narrows what probe() does, not when it is called: the eager call
    // site in attachment.ts still fires on every attach, unconditionally, so
    // the generation guard and the 4s race against the embed's own load both
    // keep applying to whichever branch below actually runs.
    probe: () => {
      // An embed showing Vimeo's own chrome is never chromeless whatever
      // else was asked for.
      if (options.controls === true) {
        return Promise.resolve(
          completed({ status: 'unavailable', reason: 'provider' })
        );
      }
      // Opt-in: without it, no request discloses the viewer to Vimeo before
      // anyone has asked for the capability.
      if (options.customControls !== true) {
        return Promise.resolve(completed(providerCheck));
      }
      return oembedRequest
        .request('chromeless')
        .then(chromelessVerdictFromOutcome);
    },
    adopt: ({ verdict }) => {
      customControlsAvailability = verdict;
    },
    cancel: () => {
      oembedRequest.cancel();
    },
    customControlsAvailability: () => customControlsAvailability
  };
};
