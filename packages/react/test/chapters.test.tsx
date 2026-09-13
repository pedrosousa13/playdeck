// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createRef, type ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  type Availability,
  type Chapter,
  type CommandResult,
  type PlayerCapabilities,
  type ProviderAdapter,
  type ProviderStateListener,
  type ProviderStatePatch
} from '@playdeck/core';
import {
  INTERNAL_CONTROLLER,
  type InternalControllerAccess
} from '../src/internal-controller';
import * as Player from '../src/index';

const ok = async () => ({ ok: true as const });

const createMockAdapter = () => {
  let stateListener: ProviderStateListener | undefined;
  const seekTo = vi.fn(async (): Promise<CommandResult> => ({ ok: true }));
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
    seekTo
  };
  return {
    adapter,
    seekTo,
    emitState: (patch: ProviderStatePatch) => stateListener?.(patch),
    emit: (
      patch: ProviderStatePatch,
      event?: Parameters<ProviderStateListener>[1]
    ) => stateListener?.(patch, event)
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
    controller,
    seekTo: mock.seekTo,
    emitState: (patch: ProviderStatePatch) => act(() => mock.emitState(patch)),
    emit: (
      patch: ProviderStatePatch,
      event?: Parameters<ProviderStateListener>[1]
    ) => act(() => mock.emit(patch, event))
  };
};

const notReadyAvailability: Availability = {
  status: 'unknown',
  reason: 'not-ready'
};
const available: Availability = { status: 'available' };

const withChapters = (status: Availability): PlayerCapabilities => ({
  seek: notReadyAvailability,
  setVolume: notReadyAvailability,
  setPlaybackRate: notReadyAvailability,
  selectQuality: notReadyAvailability,
  selectQualityAuto: notReadyAvailability,
  selectTextTrack: notReadyAvailability,
  chapters: status,
  fullscreen: notReadyAvailability,
  pictureInPicture: notReadyAvailability,
  airPlay: notReadyAvailability,
  customControls: notReadyAvailability,
  providerPoster: notReadyAvailability
});

// Three chapters, matching the fixture `e2e/chapters.spec.ts` drives against
// the native chapters VTT: boundaries at 0, 20 and 45, the last open-ended.
const chapters: readonly Chapter[] = [
  { id: 'intro', title: 'Intro', startTime: 0, endTime: 20 },
  { id: 'main', title: 'The main event', startTime: 20, endTime: 45 },
  { id: 'outro', title: 'Outro', startTime: 45, endTime: null }
];

const openMenu = (container: HTMLElement): void => {
  fireEvent.click(
    container.querySelector(
      '[data-playdeck-part="settings-menu-trigger"]'
    ) as HTMLButtonElement
  );
};

afterEach(() => {
  cleanup();
});

describe('Player.ChaptersMenu', () => {
  // Demonstrated red (docs/agents/demonstrated-red.md): this is additive
  // code with no natural unfixed state, so what follows are substitute
  // mutations, run and reverted.
  //
  // Gutted the part's render -- an unconditional `return null` right after
  // the status/empty-list gate in chapters.tsx -- and ran this file:
  //
  //   × renders one item per chapter as menuitemradio, showing title and
  //     start time, marking the current chapter from currentTime
  //   × the current chapter marking moves when currentTime crosses a
  //     chapter boundary
  //   × selecting a chapter seeks to its start time, tagged with the user
  //     origin
  //   × carries an accessible label on its trigger
  //
  //   Test Files  1 failed | 25 passed (26)
  //        Tests  4 failed | 661 passed (665)
  //
  // Reverted, all 665 passed again. The two "renders nothing" tests below
  // are unaffected by that mutation (a gutted render still renders nothing),
  // so each carries its own substitute mutation instead.

  // Demonstrated red, substitute mutation: this native-provider fixture's
  // capabilities forced to `available` (`withChapters(available)` in place
  // of `withChapters(notReadyAvailability)`, chapters left non-empty) stands
  // in for a native adapter that incorrectly reported the capability. Ran:
  //
  //   AssertionError: expected <div …(3)>…(1)</div> to be null // Object.is equality
  //    ❯ packages/react/test/chapters.test.tsx:159:7
  //
  //   Test Files  1 failed | 25 passed (26)
  //        Tests  1 failed | 664 passed (665)
  //
  // Reverted, all 665 passed again.
  test('renders nothing when the chapters capability is not available', () => {
    const { container, emitState } = renderWithPlayer(<Player.ChaptersMenu />);
    emitState({ capabilities: withChapters(notReadyAvailability), chapters });
    expect(
      container.querySelector('[data-playdeck-part="settings-menu-root"]')
    ).toBe(null);
  });

  // Demonstrated red, substitute mutation: `chapters: []` replaced with
  // `chapters` (the non-empty fixture list) in place of the empty array,
  // with the capability left `available` -- standing in for a provider that
  // resolved the capability but published no chapters. Ran the same
  // assertion above and got the same shape of failure: a non-null
  // `settings-menu-root` where the test expects `null`.
  //
  //   Test Files  1 failed | 25 passed (26)
  //        Tests  1 failed | 664 passed (665)
  //
  // Reverted, all 665 passed again.
  test('renders nothing when chapters is available but the published list is empty', () => {
    const { container, emitState } = renderWithPlayer(<Player.ChaptersMenu />);
    emitState({ capabilities: withChapters(available), chapters: [] });
    expect(
      container.querySelector('[data-playdeck-part="settings-menu-root"]')
    ).toBe(null);
  });

  test('renders one item per chapter as menuitemradio, showing title and start time, marking the current chapter from currentTime', () => {
    const { container, emitState } = renderWithPlayer(<Player.ChaptersMenu />);
    emitState({
      capabilities: withChapters(available),
      chapters,
      currentTime: 25
    });
    openMenu(container);
    const items = Array.from(
      container.querySelectorAll('[role="menuitemradio"]')
    );
    expect(items.map((item) => item.textContent)).toEqual([
      'Intro · 0:00',
      'The main event · 0:20',
      'Outro · 0:45'
    ]);
    // currentTime: 25 falls in "The main event" (20 <= 25 < 45).
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false'
    ]);
  });

  test('the current chapter marking moves when currentTime crosses a chapter boundary', () => {
    const { container, emitState } = renderWithPlayer(<Player.ChaptersMenu />);
    emitState({
      capabilities: withChapters(available),
      chapters,
      currentTime: 10
    });
    openMenu(container);
    expect(
      container.querySelector('[role="menuitemradio"][aria-checked="true"]')
        ?.textContent
    ).toBe('Intro · 0:00');

    emitState({ currentTime: 46 });
    expect(
      container.querySelector('[role="menuitemradio"][aria-checked="true"]')
        ?.textContent
    ).toBe('Outro · 0:45');
  });

  test('selecting a chapter seeks to its start time, tagged with the user origin', () => {
    const { container, controller, emit, seekTo } = renderWithPlayer(
      <Player.ChaptersMenu />
    );
    emit({ capabilities: withChapters(available), chapters, currentTime: 0 });
    openMenu(container);
    const mainEvent = Array.from(
      container.querySelectorAll('[role="menuitemradio"]')
    ).find((item) => item.textContent === 'The main event · 0:20');
    fireEvent.click(mainEvent as HTMLButtonElement);
    expect(seekTo).toHaveBeenCalledWith(20);

    // `seekTo`'s own promise settling does not by itself confirm an origin
    // -- `PlayerState.seekOrigin` is only non-null while a seek is in flight
    // (`patch.seeking` truthy) AND the provider reports a `'seeking'`/
    // `'seeked'` event alongside the patch, the same way
    // `render-gating.test.tsx`'s own dedicated `seekOrigin` test confirms a
    // real `seekToWithOrigin('user')` call.
    emit(
      { seeking: true, currentTime: 20 },
      { type: 'seeking', detail: { currentTime: 20 }, origin: 'provider' }
    );
    expect(controller.getState().seekOrigin).toBe('user');
  });

  test('carries an accessible label on its trigger', () => {
    const { container, emitState } = renderWithPlayer(<Player.ChaptersMenu />);
    emitState({ capabilities: withChapters(available), chapters });
    const trigger = container.querySelector(
      '[data-playdeck-part="settings-menu-trigger"]'
    );
    expect(trigger?.getAttribute('aria-label')).toBe('Chapters');
  });
});
