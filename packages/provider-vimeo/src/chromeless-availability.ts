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
  source: Pick<VimeoSource, 'videoId' | 'hash'>
): Promise<Availability> => {
  try {
    const response = await fetch(
      `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(
        vimeoWatchUrl(source)
      )}`
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

const settleWithFallback = <Value>(
  promise: Promise<Value>,
  fallback: Value,
  milliseconds: number
): Promise<Value> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });

export type VimeoChromelessAvailabilityDeps = {
  readonly source: Pick<VimeoSource, 'videoId' | 'hash'>;
  // The host's options, read when the probe starts rather than snapshotted at
  // construction: an embed that draws Vimeo's own controls is never chromeless.
  readonly options: { readonly controls?: boolean };
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
  // The `customControls` facet of the host's capabilities.
  readonly customControlsAvailability: () => Availability;
};

export const createVimeoChromelessAvailability = ({
  source,
  options
}: VimeoChromelessAvailabilityDeps): VimeoChromelessAvailability => {
  let customControlsAvailability: Availability = providerCheck;

  return {
    probe: () =>
      options.controls === true
        ? Promise.resolve<Availability>({
            status: 'unavailable',
            reason: 'provider'
          })
        : settleWithFallback(
            chromelessAvailability(source),
            providerCheck,
            CHROMELESS_PROBE_TIMEOUT_MS
          ),
    adopt: (verdict) => {
      customControlsAvailability = verdict;
    },
    customControlsAvailability: () => customControlsAvailability
  };
};
