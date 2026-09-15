// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createRef, type ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  type Availability,
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
  const setPlaybackRate = vi.fn(async (): Promise<CommandResult> => ({
    ok: true
  }));
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
    setPlaybackRate
  };
  return {
    adapter,
    setPlaybackRate,
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
    controller,
    setPlaybackRate: mock.setPlaybackRate,
    emitState: (patch: ProviderStatePatch) => act(() => mock.emitState(patch))
  };
};

const notReadyAvailability: Availability = {
  status: 'unknown',
  reason: 'not-ready'
};
const available: Availability = { status: 'available' };

const withSetPlaybackRate = (status: Availability): PlayerCapabilities => ({
  seek: notReadyAvailability,
  setVolume: notReadyAvailability,
  setPlaybackRate: status,
  selectQuality: notReadyAvailability,
  selectQualityAuto: notReadyAvailability,
  selectTextTrack: notReadyAvailability,
  selectAudioTrack: notReadyAvailability,
  chapters: notReadyAvailability,
  liveEdge: notReadyAvailability,
  fullscreen: notReadyAvailability,
  pictureInPicture: notReadyAvailability,
  airPlay: notReadyAvailability,
  remotePlayback: notReadyAvailability,
  customControls: notReadyAvailability,
  providerPoster: notReadyAvailability
});

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

describe('Player.PlaybackRateMenu', () => {
  // Demonstrated red (docs/agents/demonstrated-red.md): this is additive
  // code with no natural unfixed state, so what follows are substitute
  // mutations, run and reverted.
  //
  // Gutted the part's render -- an unconditional `return null` right after
  // the status gate in playback-rate.tsx -- and ran this file:
  //
  //   × renders the default rate list as menuitemradio, marking the active
  //     one from state.playbackRate
  //   × the rates prop overrides the default list
  //   × choosing a rate calls controller.setPlaybackRate with the right
  //     number
  //   × carries an accessible label on its trigger
  //
  //   Test Files  1 failed | 24 passed (25)
  //        Tests  4 failed | 655 passed (659)
  //
  // Reverted, all 659 passed again. The test right below -- "renders nothing
  // when the setPlaybackRate capability is not available" -- is unaffected
  // by that mutation (a gutted render still renders nothing), so it carries
  // its own substitute mutation just above it instead.

  // Demonstrated red, substitute mutation: this native-provider fixture's
  // capabilities forced to `available` (`withSetPlaybackRate(available)` in
  // place of `withSetPlaybackRate(notReadyAvailability)` below) stands in
  // for a native adapter that incorrectly reported the capability. Ran:
  //
  //   AssertionError: expected <div …(3)>…(1)</div> to be null // Object.is equality
  //    ❯ packages/react/test/playback-rate.test.tsx:151:7
  //
  //   Test Files  1 failed | 24 passed (25)
  //        Tests  1 failed | 658 passed (659)
  //
  // Reverted, all 659 passed again.
  test('renders nothing when the setPlaybackRate capability is not available', () => {
    const { container, emitState } = renderWithPlayer(
      <Player.PlaybackRateMenu />
    );
    emitState({
      capabilities: withSetPlaybackRate(notReadyAvailability),
      playbackRate: 1
    });
    expect(
      container.querySelector('[data-playdeck-part="settings-menu-root"]')
    ).toBe(null);
  });

  test('renders the default rate list as menuitemradio, marking the active one from state.playbackRate', () => {
    const { container, emitState } = renderWithPlayer(
      <Player.PlaybackRateMenu />
    );
    emitState({
      capabilities: withSetPlaybackRate(available),
      playbackRate: 1.5
    });
    openMenu(container);
    const items = Array.from(
      container.querySelectorAll('[role="menuitemradio"]')
    );
    expect(items.map((item) => item.textContent)).toEqual([
      '0.5×',
      '1×',
      '1.5×',
      '2×'
    ]);
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'true',
      'false'
    ]);
  });

  test('the rates prop overrides the default list', () => {
    const { container, emitState } = renderWithPlayer(
      <Player.PlaybackRateMenu rates={[1, 2, 4]} />
    );
    emitState({
      capabilities: withSetPlaybackRate(available),
      playbackRate: 2
    });
    openMenu(container);
    const items = Array.from(
      container.querySelectorAll('[role="menuitemradio"]')
    );
    expect(items.map((item) => item.textContent)).toEqual(['1×', '2×', '4×']);
    expect(
      items
        .find((item) => item.textContent === '2×')
        ?.getAttribute('aria-checked')
    ).toBe('true');
  });

  test('choosing a rate calls controller.setPlaybackRate with the right number', () => {
    const { container, emitState, setPlaybackRate } = renderWithPlayer(
      <Player.PlaybackRateMenu />
    );
    emitState({
      capabilities: withSetPlaybackRate(available),
      playbackRate: 1
    });
    openMenu(container);
    const rung2x = Array.from(
      container.querySelectorAll('[role="menuitemradio"]')
    ).find((item) => item.textContent === '2×') as HTMLButtonElement;
    fireEvent.click(rung2x);
    expect(setPlaybackRate).toHaveBeenCalledWith(2);
  });

  test('carries an accessible label on its trigger', () => {
    const { container, emitState } = renderWithPlayer(
      <Player.PlaybackRateMenu />
    );
    emitState({
      capabilities: withSetPlaybackRate(available),
      playbackRate: 1
    });
    const trigger = container.querySelector(
      '[data-playdeck-part="settings-menu-trigger"]'
    );
    expect(trigger?.getAttribute('aria-label')).toBe('Playback rate');
  });
});
