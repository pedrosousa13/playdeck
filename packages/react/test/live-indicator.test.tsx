// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react';
import { createRef, type ReactNode } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import type {
  PlayerLiveState,
  ProviderAdapter,
  ProviderStateListener,
  ProviderStatePatch
} from '@playdeck/core';
import {
  INTERNAL_CONTROLLER,
  type InternalControllerAccess
} from '../src/internal-controller';
import * as Player from '../src/index';

const ok = async () => ({ ok: true as const });

const createMockAdapter = () => {
  let stateListener: ProviderStateListener | undefined;
  const adapter: ProviderAdapter = {
    provider: 'native',
    attach: () => {},
    load: () => {},
    destroy: () => {},
    subscribe: (listener) => {
      stateListener = listener;
      return () => {
        stateListener = undefined;
      };
    },
    play: ok,
    pause: ok
  };
  return {
    adapter,
    emitState: (patch: ProviderStatePatch) => stateListener?.(patch)
  };
};

const renderWithPlayer = (ui: ReactNode) => {
  const handle = createRef<Player.PlayerHandle>();
  const utils = render(
    <Player.Root loading="interaction" ref={handle} source="/tracer.mp4">
      {ui}
    </Player.Root>
  );
  const controller = (handle.current as unknown as InternalControllerAccess)[
    INTERNAL_CONTROLLER
  ];
  const mock = createMockAdapter();
  act(() => {
    controller.setProvider(mock.adapter);
  });
  return {
    ...utils,
    emitState: (patch: ProviderStatePatch) => act(() => mock.emitState(patch))
  };
};

const atEdge: PlayerLiveState = { isLive: true, atLiveEdge: true };
const behindEdge: PlayerLiveState = { isLive: true, atLiveEdge: false };

const livePart = (container: HTMLElement) =>
  container.querySelector('[data-playdeck-part="live"]');

afterEach(() => {
  cleanup();
});

describe('Player.LiveIndicator', () => {
  // Demonstrated red (docs/agents/demonstrated-red.md): this is additive
  // code with no natural unfixed state to run these four against -- before
  // `live-indicator.tsx` existed, every one of them failed alike on
  // `Player.LiveIndicator` being `undefined`, which says nothing about
  // whether the assertion below it can tell a correct render from a wrong
  // one. What follows are substitute mutations against the finished
  // implementation, run and reverted.

  // The initial `PlayerState.live` is `null` (player-controller.ts), so this
  // is also the render on mount -- a component that always returned null
  // would pass this test too.
  //
  // Demonstrated red, substitute mutation: the `if (live === null) return
  // null;` guard removed from live-indicator.tsx. Ran:
  //
  //   AssertionError: expected <button aria-label="Live" …(5)></button> to be null // Object.is equality
  //    ❯ packages/react/test/live-indicator.test.tsx:79:33
  //      77|   test('renders nothing when live state is null', () => {
  //      78|     const { container } = renderWithPlayer(<Player.LiveIndicator />);
  //      79|     expect(livePart(container)).toBe(null);
  //         |                                 ^
  //
  //   Test Files  1 failed (1)
  //        Tests  1 failed | 3 passed (4)
  //
  // Reverted, all 4 passed again.
  test('renders nothing when live state is null', () => {
    const { container } = renderWithPlayer(<Player.LiveIndicator />);
    expect(livePart(container)).toBe(null);
  });

  // Demonstrated red, substitute mutation: `data-state` hardcoded to
  // `"behind-edge"` in place of the `live.atLiveEdge` ternary. Ran:
  //
  //   AssertionError: expected 'behind-edge' to be 'at-edge' // Object.is equality
  //    ❯ packages/react/test/live-indicator.test.tsx:87:61
  //      85|     );
  //      86|     emitState({ live: atEdge });
  //      87|     expect(livePart(container)?.getAttribute('data-state')).toBe('at-e…
  //
  //   Test Files  1 failed (1)
  //        Tests  1 failed | 3 passed (4)
  //
  // Reverted, all 4 passed again.
  test('renders a live part with data-state="at-edge" at the live edge', () => {
    const { container, emitState } = renderWithPlayer(<Player.LiveIndicator />);
    emitState({ live: atEdge });
    expect(livePart(container)?.getAttribute('data-state')).toBe('at-edge');
  });

  // Demonstrated red, substitute mutation: `data-state` hardcoded to
  // `"at-edge"` in place of the `live.atLiveEdge` ternary (the opposite
  // direction from the mutation above -- each hardcoded value leaves the
  // *other* test in this pair green, so both are needed to show the ternary
  // itself is what each assertion depends on). Ran:
  //
  //   AssertionError: expected 'at-edge' to be 'behind-edge' // Object.is equality
  //    ❯ packages/react/test/live-indicator.test.tsx:95:61
  //      93|     );
  //      94|     emitState({ live: behindEdge });
  //      95|     expect(livePart(container)?.getAttribute('data-state')).toBe(
  //
  //   Test Files  1 failed (1)
  //        Tests  1 failed | 3 passed (4)
  //
  // Reverted, all 4 passed again.
  test('renders data-state="behind-edge" once the viewer has fallen behind the edge', () => {
    const { container, emitState } = renderWithPlayer(<Player.LiveIndicator />);
    emitState({ live: behindEdge });
    expect(livePart(container)?.getAttribute('data-state')).toBe('behind-edge');
  });

  // Structural: `disabled` (not `aria-disabled`) is what makes it genuinely
  // non-interactive today -- out of the tab order and announced unavailable.
  //
  // Demonstrated red, substitute mutation: `disabled` swapped for
  // `aria-disabled` (the pattern this file deliberately does not use --
  // see the comment above `LiveIndicator`). Ran:
  //
  //   AssertionError: expected false to be true // Object.is equality
  //    ❯ packages/react/test/live-indicator.test.tsx:111:29
  //      109|     expect(button.tagName).toBe('BUTTON');
  //      110|     expect(button.type).toBe('button');
  //      111|     expect(button.disabled).toBe(true);
  //         |                             ^
  //
  //   Test Files  1 failed (1)
  //        Tests  1 failed | 3 passed (4)
  //
  // Reverted, all 4 passed again.
  test('is a disabled button, out of the tab order', () => {
    const { container, emitState } = renderWithPlayer(<Player.LiveIndicator />);
    emitState({ live: atEdge });
    const button = livePart(container) as HTMLButtonElement;
    expect(button.tagName).toBe('BUTTON');
    expect(button.type).toBe('button');
    expect(button.disabled).toBe(true);
    expect(button.hasAttribute('aria-disabled')).toBe(false);
  });

  // The accessible-name rule this package holds for every control
  // (transport-controls.tsx, above `PlayButtonProps`): destructure
  // `aria-label` and write `ariaLabel ?? <default>`, rather than leaving the
  // name to the props spread -- a literal written after a spread wins by
  // React's later-wins rule, and #437 shipped exactly that in `SeekSlider`.
  //
  // Demonstrated red: moving the explicit `aria-label={ariaLabel ?? 'Live'}`
  // ahead of `{...props}` turned out inert here -- `aria-label` is
  // destructured out of `props` above, so it is never in the spread for
  // either ordering to matter, and both orderings left all 6 tests green.
  // The mutation that actually reproduces the #437 class is the one the rule
  // names: a literal that ignores `ariaLabel`. With `aria-label={ariaLabel ??
  // 'Live'}` replaced by the literal `aria-label="Live"`, ran:
  //
  //   AssertionError: expected 'Live' to be 'Ao vivo' // Object.is equality
  //    ❯ packages/react/test/live-indicator.test.tsx:178:61
  //      176|     );
  //      177|     emitState({ live: atEdge });
  //      178|     expect(livePart(container)?.getAttribute('aria-label')).toBe('Ao v…
  //
  //   Test Files  1 failed (1)
  //        Tests  1 failed | 5 passed (6)
  //
  // Reverted, all 6 passed again.
  test('honours a consumer aria-label', () => {
    const { container, emitState } = renderWithPlayer(
      <Player.LiveIndicator aria-label="Ao vivo" />
    );
    emitState({ live: atEdge });
    expect(livePart(container)?.getAttribute('aria-label')).toBe('Ao vivo');
  });

  // Demonstrated red, substitute mutation: the default fallback changed from
  // `ariaLabel ?? 'Live'` to `ariaLabel ?? 'Ao vivo'`. Ran:
  //
  //   AssertionError: expected 'Ao vivo' to be 'Live' // Object.is equality
  //    ❯ packages/react/test/live-indicator.test.tsx:208:61
  //      206|     const { container, emitState } = renderWithPlayer(<Player.LiveIndi…
  //      207|     emitState({ live: atEdge });
  //      208|     expect(livePart(container)?.getAttribute('aria-label')).toBe('Live…
  //
  //   Test Files  1 failed (1)
  //        Tests  1 failed | 5 passed (6)
  //
  // Reverted, all 6 passed again.
  test('names itself Live when no consumer label is given', () => {
    const { container, emitState } = renderWithPlayer(<Player.LiveIndicator />);
    emitState({ live: atEdge });
    expect(livePart(container)?.getAttribute('aria-label')).toBe('Live');
  });
});
