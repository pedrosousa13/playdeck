// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createRef, type ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  type AudioTrack,
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
  const selectAudioTrack = vi.fn(async (): Promise<CommandResult> => ({
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
    selectAudioTrack
  };
  return {
    adapter,
    selectAudioTrack,
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
    selectAudioTrack: mock.selectAudioTrack,
    emitState: (patch: ProviderStatePatch) => act(() => mock.emitState(patch))
  };
};

const notReadyAvailability: Availability = {
  status: 'unknown',
  reason: 'not-ready'
};
const available: Availability = { status: 'available' };

const withSelectAudioTrack = (status: Availability): PlayerCapabilities => ({
  seek: notReadyAvailability,
  setVolume: notReadyAvailability,
  setPlaybackRate: notReadyAvailability,
  selectQuality: notReadyAvailability,
  selectQualityAuto: notReadyAvailability,
  selectTextTrack: notReadyAvailability,
  selectAudioTrack: status,
  chapters: notReadyAvailability,
  liveEdge: notReadyAvailability,
  fullscreen: notReadyAvailability,
  pictureInPicture: notReadyAvailability,
  airPlay: notReadyAvailability,
  remotePlayback: notReadyAvailability,
  customControls: notReadyAvailability,
  providerPoster: notReadyAvailability
});

const track = (
  id: string,
  label: string,
  language: string | null,
  active: boolean
): AudioTrack => ({ id, label, language, active });

const english = track('en', 'English', 'en', true);
const spanish = track('es', 'Español', 'es', false);

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

describe('Player.AudioTrackMenu', () => {
  // Demonstrated red (docs/agents/demonstrated-red.md): this is additive
  // code with no natural unfixed state, so what follows are substitute
  // mutations, run and reverted.
  //
  // Gutted the part's render -- an unconditional `return null` right after
  // the status gate in audio-tracks.tsx -- and ran the whole package's test
  // suite:
  //
  //   × lists each audio track as menuitemradio, marking the active one from
  //     AudioTrack.active
  //   × marks whichever entry carries active: true, not always the first
  //   × selecting a track calls controller.selectAudioTrack with its id
  //   × carries an accessible label on its trigger
  //
  //   Test Files  1 failed | 26 passed (27)
  //        Tests  4 failed | 666 passed (670)
  //
  // Reverted, all 670 passed again. The test right below -- "renders nothing
  // when the selectAudioTrack capability is not available" -- is unaffected
  // by that mutation (a gutted render still renders nothing), so it carries
  // its own substitute mutation just above it instead.

  // Demonstrated red, substitute mutation: this native-provider fixture's
  // capabilities forced to `available` (`withSelectAudioTrack(available)` in
  // place of `withSelectAudioTrack(notReadyAvailability)` below) stands in
  // for a native adapter that incorrectly reported the capability. Ran:
  //
  //   AssertionError: expected <div …(3)>…(1)</div> to be null // Object.is equality
  //    ❯ packages/react/test/audio-tracks.test.tsx:161:7
  //      159|     expect(
  //      160|       container.querySelector('[data-playdeck-part="settings-menu-root…
  //      161|     ).toBe(null);
  //         |       ^
  //
  //   Test Files  1 failed | 26 passed (27)
  //        Tests  1 failed | 669 passed (670)
  //
  // Reverted, all 670 passed again.
  test('renders nothing when the selectAudioTrack capability is not available', () => {
    const { container, emitState } = renderWithPlayer(
      <Player.AudioTrackMenu />
    );
    emitState({
      capabilities: withSelectAudioTrack(notReadyAvailability),
      audioTracks: [english, spanish]
    });
    expect(
      container.querySelector('[data-playdeck-part="settings-menu-root"]')
    ).toBe(null);
  });

  test('lists each audio track as menuitemradio, marking the active one from AudioTrack.active', () => {
    const { container, emitState } = renderWithPlayer(
      <Player.AudioTrackMenu />
    );
    emitState({
      capabilities: withSelectAudioTrack(available),
      audioTracks: [english, spanish]
    });
    openMenu(container);
    const items = Array.from(
      container.querySelectorAll('[role="menuitemradio"]')
    );
    expect(items.map((item) => item.textContent)).toEqual([
      'English',
      'Español'
    ]);
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual([
      'true',
      'false'
    ]);
  });

  // `MenuRadioGroup`'s `value` is read off the active entry rather than a
  // sibling `selectedAudioTrackId` field (`audio-tracks.tsx`'s comment above
  // `activeId`) -- this proves the active row moves when a different entry
  // carries `active: true`, not merely that the first entry happens to.
  //
  // Demonstrated red, substitute mutation: `activeId` changed to
  // `audioTracks[0]?.id ?? ''` (always the first entry, the bug this test
  // exists to catch) and this file run:
  //
  //   AssertionError: expected [ 'true', 'false' ] to deeply equal [ 'false', 'true' ]
  //    ❯ packages/react/test/audio-tracks.test.tsx:217:68
  //      215|       container.querySelectorAll('[role="menuitemradio"]')
  //      216|     );
  //      217|     expect(items.map((item) => item.getAttribute('aria-checked'))).toE…
  //         |                                                                    ^
  //      218|       'false',
  //
  //   Test Files  1 failed | 26 passed (27)
  //        Tests  1 failed | 669 passed (670)
  //
  // Reverted, all 670 passed again.
  test('marks whichever entry carries active: true, not always the first', () => {
    const { container, emitState } = renderWithPlayer(
      <Player.AudioTrackMenu />
    );
    emitState({
      capabilities: withSelectAudioTrack(available),
      audioTracks: [
        track('en', 'English', 'en', false),
        track('es', 'Español', 'es', true)
      ]
    });
    openMenu(container);
    const items = Array.from(
      container.querySelectorAll('[role="menuitemradio"]')
    );
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual([
      'false',
      'true'
    ]);
  });

  test('selecting a track calls controller.selectAudioTrack with its id', () => {
    const { container, emitState, selectAudioTrack } = renderWithPlayer(
      <Player.AudioTrackMenu />
    );
    emitState({
      capabilities: withSelectAudioTrack(available),
      audioTracks: [english, spanish]
    });
    openMenu(container);
    const rungEs = Array.from(
      container.querySelectorAll('[role="menuitemradio"]')
    ).find((item) => item.textContent === 'Español') as HTMLButtonElement;
    fireEvent.click(rungEs);
    expect(selectAudioTrack).toHaveBeenCalledWith('es');
  });

  test('carries an accessible label on its trigger', () => {
    const { container, emitState } = renderWithPlayer(
      <Player.AudioTrackMenu />
    );
    emitState({
      capabilities: withSelectAudioTrack(available),
      audioTracks: [english]
    });
    const trigger = container.querySelector(
      '[data-playdeck-part="settings-menu-trigger"]'
    );
    expect(trigger?.getAttribute('aria-label')).toBe('Audio track');
  });
});

// Keyboard operability itself -- ArrowDown opening the menu onto its first
// item, roving focus, Enter activating a focused menuitemradio -- is
// `SettingsMenu`'s own and already covered generically
// (`settings-menu.test.tsx`); `e2e/audio-tracks.spec.ts`'s "opens and
// selects a track by keyboard" exercises it through this composition
// end-to-end, the same split `quality.test.tsx`/`e2e/quality.spec.ts` and
// `playback-rate.test.tsx`'s siblings use.
