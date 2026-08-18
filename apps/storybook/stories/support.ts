import {
  createInitialPlayerState,
  type Availability,
  type PlayerCapabilities,
  type ProviderStatePatch
} from '@playdeck/core';
import type { MockPlayerParameters } from '../.storybook/mock-player';

export const available: Availability = { status: 'available' };
export const notReady: Availability = {
  status: 'unknown',
  reason: 'not-ready'
};
export const unavailable: Availability = {
  status: 'unavailable',
  reason: 'provider'
};

/**
 * A ready player-state patch with the given capability overrides. The base
 * capability set is derived from the real core contract
 * (`createInitialPlayerState().capabilities`) rather than hand-listed, so a
 * new core capability surfaces here automatically instead of silently
 * missing. Unspecified capabilities stay `unknown` (`not-ready`), which is
 * what capability-absent stories rely on to prove a control renders nothing
 * until its capability resolves.
 */
export const ready = (
  overrides: Partial<PlayerCapabilities> = {},
  patch: ProviderStatePatch = {}
): { player: MockPlayerParameters } => ({
  player: {
    state: {
      lifecycle: 'ready',
      activation: 'ready',
      provider: 'native',
      capabilities: {
        ...createInitialPlayerState().capabilities,
        ...overrides
      },
      ...patch
    }
  }
});
