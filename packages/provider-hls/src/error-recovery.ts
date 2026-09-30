import type { PlayerError } from '@playdeck/core';
import type { HlsConstructorLike, HlsInstanceLike } from './adapter-values.js';

const MAX_FATAL_NETWORK_RECOVERIES = 2;
const MAX_FATAL_MEDIA_RECOVERIES = 2;

// How long a raw element `error` on the hls.js path is held, unpublished,
// before it is treated as unowned and surfaced as the same errored/paused
// state the embedded native adapter would have reported on its own. hls.js
// does not listen for the media element's own `error` event at all -- it
// detects and recovers from MSE failures through its own append/loader error
// path -- so the two signals arrive independently, in no guaranteed order,
// and this bound only has to outlast the gap before hls.js's own path would
// react if it is going to. hls.js 1.6.16's shipped defaults
// (`Hls.DefaultConfig`, `node_modules/hls.js/src/config.ts`) put
// `fragLoadingRetryDelay`/`levelLoadingRetryDelay` -- the fastest cadence at
// which hls.js's own loaders re-act to a failure -- at 1000ms, backing off
// toward a `fragLoadingMaxRetryTimeout`/`levelLoadingMaxRetryTimeout` ceiling
// of 64000ms across up to `fragLoadingMaxRetry` (6) / `levelLoadingMaxRetry`
// (4) attempts. Three times that fastest cadence gives an hls.js path that is
// actually going to notice and act on the same failure a couple of cycles'
// worth of scheduling jitter to do so in, while staying two orders of
// magnitude short of the 64000ms ceiling hls.js reserves for exhausting its
// own retries outright.
export const HLS_JS_ELEMENT_ERROR_TIMEOUT_MS = 3000;

// The slice of the engine instance the recovery policy drives: the three
// hls.js recovery entry points, nothing else.
export type HlsRecoverableInstance = Pick<
  HlsInstanceLike,
  'startLoad' | 'recoverMediaError' | 'swapAudioCodec'
>;

export type HlsErrorRecoveryDeps = {
  // True once the host has been destroyed or the instance superseded; a
  // stale engine's errors must not drive recovery.
  readonly isStale: (instance: HlsRecoverableInstance) => boolean;
  // Tears the engine down and publishes the fatal error state.
  readonly surfaceFatal: (error: PlayerError) => void;
};

// The fatal-error recovery policy: hls.js's bounded recovery contract, with
// the network and media budgets held here and nowhere else. Non-fatal errors
// are hls.js's own business; fatal ones get a bounded number of in-place
// recovery attempts per category before the error surfaces.
export type HlsErrorRecovery = {
  readonly handleError: (
    instance: HlsRecoverableInstance,
    Hls: Pick<HlsConstructorLike, 'ErrorTypes'>,
    data: unknown
  ) => void;
  // Re-arms both recovery budgets; called on retry.
  readonly reset: () => void;
};

export const createHlsErrorRecovery = ({
  isStale,
  surfaceFatal
}: HlsErrorRecoveryDeps): HlsErrorRecovery => {
  let networkRecoveries = 0;
  let mediaRecoveries = 0;

  return {
    handleError: (instance, Hls, data) => {
      if (isStale(instance)) return;
      const errorData = data as {
        type?: string;
        details?: string;
        fatal?: boolean;
      };
      if (!errorData.fatal) return;
      if (errorData.type === Hls.ErrorTypes.NETWORK_ERROR) {
        if (networkRecoveries < MAX_FATAL_NETWORK_RECOVERIES) {
          networkRecoveries += 1;
          instance.startLoad();
          return;
        }
        surfaceFatal({
          category: 'network',
          fatal: true,
          recoverable: true,
          message: 'HLS playback failed after bounded network error recovery.',
          cause: data
        });
        return;
      }
      if (errorData.type === Hls.ErrorTypes.MEDIA_ERROR) {
        if (mediaRecoveries < MAX_FATAL_MEDIA_RECOVERIES) {
          mediaRecoveries += 1;
          // Per the hls.js recovery contract, a repeated fatal media error
          // needs an audio codec swap before the next recovery attempt.
          if (mediaRecoveries > 1) instance.swapAudioCodec();
          instance.recoverMediaError();
          return;
        }
        surfaceFatal({
          category: 'decode',
          fatal: true,
          recoverable: true,
          message: 'HLS playback failed after bounded media error recovery.',
          cause: data
        });
        return;
      }
      surfaceFatal({
        category: 'provider',
        fatal: true,
        recoverable: true,
        message: errorData.details
          ? `hls.js reported an unrecoverable fatal error: ${errorData.details}`
          : 'hls.js reported an unrecoverable fatal error.',
        cause: data
      });
    },
    reset: () => {
      networkRecoveries = 0;
      mediaRecoveries = 0;
    }
  };
};
