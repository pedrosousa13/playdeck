import type { PlayerController, PreProviderActivation } from '@reely/core';
import type * as Player from '@reely/react';
import { act, cleanup, render } from '@testing-library/react';
import { createElement, createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackpackVideo } from './backpack-video';

/**
 * SIDEPRO-212: once `state.activation` is `'error'`, the wrapper's own
 * contribution to `Player.ActivationButton` is absence — no `aria-label` and
 * no children — so the primitive's own "Retry loading video" and "Retry"
 * apply instead of the wrapper's "Play video"/"Pause video" and empty string
 * (`backpack-video.tsx`'s `isActivationError` branches;
 * `packages/react/src/loading-error.tsx:45,62`, the fallbacks that only take
 * over when a caller passes nothing).
 *
 * Same interception as `backpack-video-controls.contract.test.ts`:
 * `@reely/react`'s own `ActivationButton` is intercepted to record the props
 * it receives, then the genuine component renders underneath so
 * `BackpackVideoSurface`'s hooks still run against a real
 * `PlayerContext.Provider`. `external-control.contract.test.ts` reaches its
 * own assertions a different way — a real controller staged through
 * `useReportingProvider`, per its own header — not a `vi.mock`.
 *
 * `reporting-provider.ts`'s fake stages an already-`ready` player and cannot
 * reach `'error'` from there: `PlayerController.setActivation` refuses to
 * touch a player once a provider has attached
 * (`packages/core/src/player-controller.ts`'s `if (this.#provider) return;`).
 * A real failed load never attaches one either — `use-activation.ts`'s
 * `loadProvider(...).catch` branch calls the very same method while
 * `this.#provider` is still `null` — so this test calls `setActivation`
 * directly instead of writing a new fake provider.
 */

const { capturedActivationButtonProps } = vi.hoisted(() => ({
  capturedActivationButtonProps: [] as Player.ActivationButtonProps[]
}));

vi.mock('@reely/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@reely/react')>();
  return {
    ...actual,
    ActivationButton: (props: Player.ActivationButtonProps) => {
      capturedActivationButtonProps.push(props);
      return createElement(actual.ActivationButton, props);
    }
  };
});

/** The last `Player.ActivationButton` render's props. */
const activationButtonProps = (): Player.ActivationButtonProps =>
  capturedActivationButtonProps.at(-1)!;

const activationError: PreProviderActivation = {
  activation: 'error',
  error: {
    category: 'provider',
    fatal: false,
    recoverable: true,
    message: 'Unable to load the player provider.'
  }
};

describe('BackpackVideo activation error labelling', () => {
  afterEach(() => {
    cleanup();
    capturedActivationButtonProps.length = 0;
  });

  it('hands Player.ActivationButton no aria-label and no children once activation errors', () => {
    const ref = createRef<Player.PlayerHandle>();
    render(
      createElement(BackpackVideo, {
        muted: true,
        ref,
        url: 'mock://reely/unresolvable.mp4'
      })
    );

    expect(activationButtonProps()['aria-label']).toBe('Play video');
    expect(activationButtonProps().children).toBe('');

    act(() => {
      (ref.current as unknown as PlayerController).setActivation(
        activationError
      );
    });

    expect(activationButtonProps()['aria-label']).toBeUndefined();
    expect(activationButtonProps().children).toBeUndefined();
  });
});
