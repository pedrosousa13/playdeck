import type { Availability, VimeoSource } from '@playdeck/core';
import { available, providerCheck } from './adapter-values.js';

// The probe races the embed's own load, and a verdict that arrives after the
// ready state has been published is no use to the consumer gating a control
// bar on it. Measured against the live oEmbed API, which answers well inside
// this.
export const CHROMELESS_PROBE_TIMEOUT_MS = 4000;

const vimeoWatchUrl = (source: Pick<VimeoSource, 'videoId' | 'hash'>): string =>
  `https://vimeo.com/${source.videoId}${source.hash ? `/${source.hash}` : ''}`;

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

const chromelessAvailability = async (
  source: Pick<VimeoSource, 'videoId' | 'hash'>,
  signal: AbortSignal
): Promise<VimeoChromelessProbe> => {
  // Set the moment a response exists, whatever it turns out to say. A refused
  // status and a body that will not parse are both Vimeo answering, so the
  // `catch` below can tell a read that failed after the answer arrived from a
  // request that never produced one at all (#235). That is what a cancel
  // interrupting the body read reports: `responded` is already `true`, so the
  // read failing there completes the probe. A read the deadline interrupts
  // instead reports the opposite, incomplete and worth a notice — not because
  // `responded` disagrees, but because `settleWithFallback`'s abort handler
  // resolves the outer promise first, ahead of this function's own return.
  let responded = false;
  try {
    const response = await fetch(
      `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(
        vimeoWatchUrl(source)
      )}`,
      { signal }
    );
    responded = true;
    if (!response.ok) return completed(providerCheck);
    const data: unknown = await response.json();
    const accountType =
      typeof data === 'object' &&
      data !== null &&
      'account_type' in data &&
      typeof data.account_type === 'string'
        ? data.account_type
        : undefined;
    if (!accountType) return completed(providerCheck);
    if (planLimitedAccountTypes.has(accountType)) {
      return completed({ status: 'unavailable', reason: 'provider-plan' });
    }
    return completed(
      chromelessAccountTypes.has(accountType) ? available : providerCheck
    );
  } catch {
    return responded ? completed(providerCheck) : incomplete;
  }
};

// Settles on whichever comes first: the request, the deadline above, or a
// cancel. The last two both abort the request rather than leaving it running
// beside a fallback verdict, and the caller receives that same fallback in
// either case — an abandoned probe stops talking to Vimeo instead of merely
// having its answer ignored. An abort makes the request reject, which lands on
// the fallback here the way any other failure does, so nothing rejects at the
// caller.
//
// Which is exactly why the deadline has to be told apart from the cancel here
// rather than downstream: both arrive as the same abort on the same signal,
// and the fallback verdict they settle on is the same too. Only the completion
// fact separates them — the deadline is the probe failing to get an answer,
// while a cancel (and the supersede in `probe` below) is the caller taking the
// question back, which is teardown and not worth a notice (#235).
export const settleWithFallback = (
  request: Promise<VimeoChromelessProbe>,
  milliseconds: number,
  controller: AbortController
): Promise<VimeoChromelessProbe> =>
  new Promise((resolve) => {
    let timedOut = false;
    const settle = (value: VimeoChromelessProbe): void => {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', abandon);
      resolve(value);
    };
    // The abort listener, and the only consumer of `timedOut`: fired by the
    // deadline below and by `cancel()` (and the supersede in `probe`), never
    // by the request itself rejecting, which `onRequestRejected` below
    // settles on its own (#235).
    const abandon = (): void =>
      settle(timedOut ? incomplete : completed(providerCheck));
    // A rejected request produced no answer at all -- unlike an abort, which
    // withdraws a question that could still have been answered -- so it
    // settles the same way the deadline does, incomplete, rather than reusing
    // `abandon` and defaulting to `completed` the way this once did. Nothing
    // rejects at the caller: `chromelessAvailability` catches its own
    // failures today and this path is unreachable, but the fallback must mean
    // what a rejection means if that ever stops holding (#235).
    const onRequestRejected = (): void => settle(incomplete);
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, milliseconds);
    controller.signal.addEventListener('abort', abandon);
    request.then(settle, onRequestRejected);
  });

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
  options
}: VimeoChromelessAvailabilityDeps): VimeoChromelessAvailability => {
  let customControlsAvailability: Availability = providerCheck;
  // The request in flight, and nothing once its probe has settled — so a
  // `cancel` after the fact holds no handle on a request that is already done.
  let activeRequest: AbortController | undefined;

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
      // One request at a time, held here rather than in the caller's ordering:
      // a probe that starts while another is running abandons it, whether or
      // not whoever started this one remembered to cancel first.
      activeRequest?.abort();
      const controller = new AbortController();
      activeRequest = controller;
      return settleWithFallback(
        chromelessAvailability(source, controller.signal),
        CHROMELESS_PROBE_TIMEOUT_MS,
        controller
      ).finally(() => {
        if (activeRequest === controller) activeRequest = undefined;
      });
    },
    adopt: ({ verdict }) => {
      customControlsAvailability = verdict;
    },
    cancel: () => {
      activeRequest?.abort();
    },
    customControlsAvailability: () => customControlsAvailability
  };
};
