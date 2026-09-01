import * as Player from '@playdeck/react';
import {
  createInitialPlayerState,
  type Availability,
  type PlayerCapabilities,
  type ProviderStatePatch
} from '@playdeck/core';
import type { ReactNode } from 'react';
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

/**
 * A fixed-size dark viewport to stage a story in. The poster stories share it
 * because they sit adjacent in the docs and a difference in frame size would
 * read as a difference in the primitive.
 */
export const Frame = ({ children }: { readonly children: ReactNode }) => (
  <Player.Viewport style={{ width: 480, height: 270, background: '#0b0e13' }}>
    {children}
  </Player.Viewport>
);

/**
 * The poster bitmap in a rendered story, or a throw. A `querySelector` returns
 * `null` for a part that never rendered, and a `null` dereferenced inside an
 * assertion reports a missing property rather than a missing part.
 */
export const posterImage = (root: HTMLElement): HTMLElement => {
  const element = root.querySelector<HTMLElement>(
    '[data-playdeck-part="poster-image"]'
  );
  if (!element) throw new Error('Expected a poster image in the story.');
  return element;
};
