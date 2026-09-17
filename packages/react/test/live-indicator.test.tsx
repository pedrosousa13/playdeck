// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createRef, type ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type {
  Availability,
  CommandResult,
  PlayerCapabilities,
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

const ok = async (): Promise<CommandResult> => ({ ok: true });

const createMockAdapter = () => {
  let stateListener: ProviderStateListener | undefined;
  const spies = {
    seekToLiveEdge: vi.fn(ok)
  };
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
    pause: ok,
    ...spies
  };
  return {
    adapter,
    spies,
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
    spies: mock.spies,
    emitState: (patch: ProviderStatePatch) => act(() => mock.emitState(patch))
  };
};

const atEdge: PlayerLiveState = {
  isLive: true,
  atLiveEdge: true,
  offsetFromEdge: 0
};
const behindEdge: PlayerLiveState = {
  isLive: true,
  atLiveEdge: false,
  offsetFromEdge: 12
};

// `PlayerState.capabilities` is replaced wholesale on a patch, never merged
// (`player-controller.ts`'s `#applyPatch`), so a test that wants one
// capability set needs a complete `PlayerCapabilities` -- the same shape
// `controls.test.tsx`'s `allNotReady`/`capabilities` helpers build.
const available: Availability = { status: 'available' };
const unavailable: Availability = { status: 'unavailable', reason: 'provider' };

const capabilitiesWith = (
  liveEdge: Availability
): PlayerCapabilities => {
  const notReady: Availability = { status: 'unknown', reason: 'not-ready' };
  return {
    seek: notReady,
    setVolume: notReady,
    setPlaybackRate: notReady,
    selectQuality: notReady,
    selectQualityAuto: notReady,
    selectTextTrack: notReady,
    selectAudioTrack: notReady,
    chapters: notReady,
    liveEdge,
    fullscreen: notReady,
    pictureInPicture: notReady,
    airPlay: notReady,
    customControls: notReady,
    providerPoster: notReady,
    remotePlayback: notReady
  };
};

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
  // CORRECTION: an earlier version of this comment claimed a red run of
  // "the `if (live === null) return null;` guard removed" that this test
  // caught alone, with 3 of the other 5 tests still green. That run was never
  // actually witnessed as described -- reproducing that exact mutation
  // throws `TypeError: Cannot read properties of null (reading
  // 'atLiveEdge')` on mount instead, which crashes every test in the file
  // (6 failed, not "1 failed | 3 passed"), because `live.atLiveEdge` is read
  // unguarded a few lines below the removed check. No assertion ever ran, so
  // the previous transcript was fabricated rather than recorded. Caught by a
  // Standards review that reproduced the mutation and got a different
  // result -- see docs/agents/demonstrated-red.md's own rule: "I ran it and
  // it was red" is a claim about a run nobody else witnessed, exactly this
  // case.
  //
  // Demonstrated red, substitute mutation, refined so it isolates this one
  // behaviour: the early return removed but the property read guarded
  // (`live?.atLiveEdge` in place of the guard'd `live.atLiveEdge`), so the
  // only change under test is "renders nothing when not live" -- every other
  // behaviour stays intact and stays green. Ran:
  //
  //   AssertionError: expected <button aria-label="Live" …(5)></button> to be null // Object.is equality
  //    ❯ packages/react/test/live-indicator.test.tsx:101:33
  //      99|   test('renders nothing when live state is null', () => {
  //     100|     const { container } = renderWithPlayer(<Player.LiveIndicator />);
  //     101|     expect(livePart(container)).toBe(null);
  //         |                                 ^
  //
  //   Test Files  1 failed (1)
  //        Tests  1 failed | 5 passed (6)
  //
  // Reverted, all 6 passed again.
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

  // -- press behaviour: capability `available` --------------------------

  // Demonstrated red, substitute mutation: the call to
  // `controller.seekToLiveEdge()` commented out inside the `onClick`
  // handler. Ran:
  //
  //   AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
  //    ❯ packages/react/test/live-indicator.test.tsx:313:34
  //      311|     });
  //      312|     fireEvent.click(livePart(container) as HTMLButtonElement);
  //      313|     expect(spies.seekToLiveEdge).toHaveBeenCalledTimes(1);
  //         |                                  ^
  //
  //   Test Files  1 failed (1)
  //        Tests  1 failed | 10 passed (11)
  //
  // Reverted, all 11 passed again.
  test('issues seekToLiveEdge on press once the capability is available', () => {
    const { container, emitState, spies } = renderWithPlayer(
      <Player.LiveIndicator />
    );
    emitState({
      live: behindEdge,
      capabilities: capabilitiesWith(available)
    });
    fireEvent.click(livePart(container) as HTMLButtonElement);
    expect(spies.seekToLiveEdge).toHaveBeenCalledTimes(1);
  });

  // Demonstrated red, substitute mutation: `disabled={!seekable}` hardcoded
  // to `disabled` (the pre-#180 behaviour, always disabled). That single
  // mutation fails this test AND the one above it -- a native `disabled`
  // button never dispatches a DOM click at all, so `fireEvent.click` above
  // never reaches the `onClick` handler either. Ran:
  //
  //   AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
  //    ❯ packages/react/test/live-indicator.test.tsx:313:34
  //   AssertionError: expected true to be false // Object.is equality
  //    ❯ packages/react/test/live-indicator.test.tsx:337:29
  //      335|     });
  //      336|     const button = livePart(container) as HTMLButtonElement;
  //      337|     expect(button.disabled).toBe(false);
  //         |                             ^
  //
  //   Test Files  1 failed (1)
  //        Tests  2 failed | 9 passed (11)
  //
  // Reverted, all 11 passed again.
  test('sheds disabled once the capability is available', () => {
    const { container, emitState } = renderWithPlayer(<Player.LiveIndicator />);
    emitState({
      live: atEdge,
      capabilities: capabilitiesWith(available)
    });
    const button = livePart(container) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  // A consumer `onClick` that calls `preventDefault` suppresses the command,
  // the same contract `AirPlayButton` and every other command-issuing part in
  // this package holds.
  //
  // Demonstrated red, substitute mutation: the `event.defaultPrevented ||`
  // half of the `onClick` guard dropped, leaving only the `!seekable` check.
  // Ran:
  //
  //   AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
  //    ❯ packages/react/test/live-indicator.test.tsx:372:38
  //      370|     fireEvent.click(livePart(container) as HTMLButtonElement);
  //      371|
  //      372|     expect(spies.seekToLiveEdge).not.toHaveBeenCalled();
  //         |                                      ^
  //
  //   Test Files  1 failed (1)
  //        Tests  1 failed | 10 passed (11)
  //
  // Reverted, all 11 passed again.
  test('a consumer onClick that prevents default suppresses seekToLiveEdge', () => {
    const { container, emitState, spies } = renderWithPlayer(
      <Player.LiveIndicator
        onClick={(event) => {
          event.preventDefault();
        }}
      />
    );
    emitState({
      live: behindEdge,
      capabilities: capabilitiesWith(available)
    });
    fireEvent.click(livePart(container) as HTMLButtonElement);

    expect(spies.seekToLiveEdge).not.toHaveBeenCalled();
  });

  // -- non-interactive badge: capability `unavailable` -------------------

  // The acceptance criterion this test exists for: applying the uniform
  // capability gate every other command-issuing part in this package uses
  // (`if (status !== 'available') return null;`) would delete this badge on
  // every provider that cannot seek to the edge -- the opposite of the
  // maintainer ruling recorded in the docstring above `LiveIndicator`.
  //
  // Demonstrated red, exactly that mutation: an early
  // `if (status !== 'available') return null;` added ahead of the
  // `live === null` check. Every other test in the file mounts without
  // driving `capabilities` at all, so its `liveEdge` status defaults to
  // `unknown`/`not-ready` -- also not `'available'` -- and the mutated gate
  // deletes the part for those too, well past this one test:
  //
  //   AssertionError: expected null not to be null // Object.is equality
  //    ❯ packages/react/test/live-indicator.test.tsx:401:37
  //      399|     const { container, emitState } = renderWithPlayer(<Player.LiveIndi…
  //      400|     emitState({ live: behindEdge, capabilities: capabilitiesWith(unava…
  //      401|     expect(livePart(container)).not.toBe(null);
  //         |                                     ^
  //
  //   Test Files  1 failed (1)
  //        Tests  7 failed | 4 passed (11)
  //
  // Reverted, all 11 passed again.
  test('stays a non-interactive LIVE badge, not null, when the capability is unavailable', () => {
    const { container, emitState } = renderWithPlayer(<Player.LiveIndicator />);
    emitState({ live: behindEdge, capabilities: capabilitiesWith(unavailable) });
    expect(livePart(container)).not.toBe(null);
    const button = livePart(container) as HTMLButtonElement;
    expect(button.tagName).toBe('BUTTON');
    expect(button.disabled).toBe(true);
  });

  // No separate "press while unavailable does nothing" test: a native
  // `disabled` button never dispatches a DOM click at all (confirmed above --
  // the always-`disabled` mutation left `fireEvent.click` unable to reach
  // `onClick` even with the capability `available`), so once "is a disabled
  // button, out of the tab order" and "stays a non-interactive LIVE badge"
  // above are both true, a press while unavailable already cannot reach
  // `controller.seekToLiveEdge()`. A test asserting that separately could
  // only be made to fail by ALSO removing `disabled`, which the two tests
  // above already cover -- the shape `docs/agents/demonstrated-red.md` calls
  // out as unfalsifiable in isolation, confirmed by actually trying it rather
  // than assumed: with `!seekable` dropped from the `onClick` guard alone,
  // `fireEvent.click` on the still-disabled button left `seekToLiveEdge`
  // uncalled and the file green at 11/11.
});
