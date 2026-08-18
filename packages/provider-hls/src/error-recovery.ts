import type { PlayerError } from '@playdeck/core';
import type { HlsConstructorLike, HlsInstanceLike } from './adapter-values.js';

const MAX_FATAL_NETWORK_RECOVERIES = 2;
const MAX_FATAL_MEDIA_RECOVERIES = 2;

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
