import type { Availability, VimeoSource } from '@reely/core';
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

const chromelessAvailability = async (
  source: Pick<VimeoSource, 'videoId' | 'hash'>,
  signal: AbortSignal
): Promise<Availability> => {
  try {
    const response = await fetch(
      `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(
        vimeoWatchUrl(source)
      )}`,
      { signal }
    );
    if (!response.ok) return providerCheck;
    const data: unknown = await response.json();
    const accountType =
      typeof data === 'object' &&
      data !== null &&
      'account_type' in data &&
      typeof data.account_type === 'string'
        ? data.account_type
        : undefined;
    if (!accountType) return providerCheck;
    if (planLimitedAccountTypes.has(accountType)) {
      return { status: 'unavailable', reason: 'provider-plan' };
    }
    return chromelessAccountTypes.has(accountType) ? available : providerCheck;
  } catch {
    return providerCheck;
  }
};

// Settles on whichever comes first: the request, the deadline above, or a
// cancel. The last two both abort the request rather than leaving it running
// beside a fallback verdict, and the caller receives that same fallback in
// either case — an abandoned probe stops talking to Vimeo instead of merely
// having its answer ignored. An abort makes the request reject, which lands on
// the fallback here the way any other failure does, so nothing rejects at the
// caller.
const settleWithFallback = <Value>(
  promise: Promise<Value>,
  fallback: Value,
  milliseconds: number,
  controller: AbortController
): Promise<Value> =>
  new Promise((resolve) => {
    const settle = (value: Value): void => {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', abandon);
      resolve(value);
    };
    const abandon = (): void => settle(fallback);
    const timer = setTimeout(() => controller.abort(), milliseconds);
    controller.signal.addEventListener('abort', abandon);
    promise.then(settle, abandon);
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
// over to Reely. Vimeo gates that on the owner's account tier and reports the
// tier nowhere in the player SDK, so the only way to know is the public oEmbed
// record — one request, raced against the attach it informs.
export type VimeoChromelessAvailability = {
  // Starts the probe. The attachment seam starts it before the player's own
  // ready settles, so the request is in flight while the embed loads.
  readonly probe: () => Promise<Availability>;
  // Records a probed verdict. Kept separate from `probe` so an attach that has
  // been superseded by the time its probe settles cannot overwrite the verdict
  // a live one adopted.
  readonly adopt: (verdict: Availability) => void;
  // Abandons the probe in flight: aborts its request and settles it on the
  // provisional verdict. The attachment calls this wherever it already bumps
  // the start generation, so the counter that decides which verdict is adopted
  // also decides which request keeps running.
  readonly cancel: () => void;
  // The `customControls` facet of the host's capabilities.
  readonly customControlsAvailability: () => Availability;
};

export const createVimeoChromelessAvailability = ({
  source,
  options
}: VimeoChromelessAvailabilityDeps): VimeoChromelessAvailability => {
  let customControlsAvailability: Availability = providerCheck;
  // The request in flight, or the last one that ran: aborting one that has
  // already settled is inert, so `cancel` needs no separate record of that.
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
        return Promise.resolve<Availability>({
          status: 'unavailable',
          reason: 'provider'
        });
      }
      // Opt-in: without it, no request discloses the viewer to Vimeo before
      // anyone has asked for the capability.
      if (options.customControls !== true) {
        return Promise.resolve<Availability>(providerCheck);
      }
      const controller = new AbortController();
      activeRequest = controller;
      return settleWithFallback(
        chromelessAvailability(source, controller.signal),
        providerCheck,
        CHROMELESS_PROBE_TIMEOUT_MS,
        controller
      );
    },
    adopt: (verdict) => {
      customControlsAvailability = verdict;
    },
    cancel: () => {
      activeRequest?.abort();
    },
    customControlsAvailability: () => customControlsAvailability
  };
};
