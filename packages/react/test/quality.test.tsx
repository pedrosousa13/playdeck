// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createRef, type ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  type Availability,
  type CommandResult,
  type PlayerCapabilities,
  type PlayerQuality,
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
  const selectQuality = vi.fn(async (): Promise<CommandResult> => ({
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
    selectQuality
  };
  return {
    adapter,
    selectQuality,
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
    selectQuality: mock.selectQuality,
    emitState: (patch: ProviderStatePatch) => act(() => mock.emitState(patch))
  };
};

const notReadyAvailability: Availability = {
  status: 'unknown',
  reason: 'not-ready'
};
const available: Availability = { status: 'available' };

// `autoStatus` defaults to `status`: every existing caller below passes one
// Availability meaning "quality selection itself", and until the Vimeo-shaped
// test below, selection and auto have always agreed.
const withSelectQuality = (
  status: Availability,
  autoStatus: Availability = status
): PlayerCapabilities => ({
  seek: notReadyAvailability,
  setVolume: notReadyAvailability,
  setPlaybackRate: notReadyAvailability,
  selectQuality: status,
  selectQualityAuto: autoStatus,
  selectTextTrack: notReadyAvailability,
  selectAudioTrack: notReadyAvailability,
  chapters: notReadyAvailability,
  fullscreen: notReadyAvailability,
  pictureInPicture: notReadyAvailability,
  airPlay: notReadyAvailability,
  customControls: notReadyAvailability,
  providerPoster: notReadyAvailability
});

const quality = (
  id: string,
  height: number | null,
  bitrate: number | null = null
): PlayerQuality => ({ id, height, width: null, bitrate });

const p1080 = quality('1080p', 1080, 5_000_000);
const p720 = quality('720p', 720, 2_500_000);

afterEach(() => {
  cleanup();
});

describe('Player.QualityMenu', () => {
  // Demonstrated red (docs/agents/demonstrated-red.md): this is additive
  // code with no natural unfixed state, so what follows are substitute
  // mutations, run and reverted.
  //
  // Gutted the part's render -- an unconditional `return null` right after
  // the status gate in quality.tsx -- and ran this file:
  //
  //   × lists each quality plus Auto as menuitemradio with aria-checked reflecting selection
  //   × the Auto row is checked, and labelled from the playing level, when selectedQualityId is null
  //   × the Auto row reads plain "Auto" before a playing level is known
  //   × selecting a quality calls controller.selectQuality with its id
  //   × selecting Auto calls controller.selectQuality with null
  //   × carries an accessible label on its trigger
  //
  //   Test Files  1 failed | 23 passed (24)
  //        Tests  6 failed | 647 passed (653)
  //
  // Reverted, all 653 passed again. The test right below --
  // "renders nothing when the selectQuality capability is not available" --
  // is unaffected by that mutation (a gutted render still renders nothing),
  // so it carries its own substitute mutation just above it instead.

  // Demonstrated red, substitute mutation: this native-provider fixture's
  // capabilities forced to `available` (`withSelectQuality(available)` in
  // place of `withSelectQuality(notReadyAvailability)` below) stands in for
  // a native adapter that incorrectly reported the capability. Ran:
  //
  //   AssertionError: expected <div …(3)>…(1)</div> to be null // Object.is equality
  //    ❯ packages/react/test/quality.test.tsx:114:7
  //      112|     expect(
  //      113|       container.querySelector('[data-playdeck-part="settings-menu-root…
  //      114|     ).toBe(null);
  //         |       ^
  //
  //   Test Files  1 failed | 23 passed (24)
  //        Tests  1 failed | 652 passed (653)
  //
  // Reverted, all 653 passed again.
  test('renders nothing when the selectQuality capability is not available', () => {
    const { container, emitState } = renderWithPlayer(<Player.QualityMenu />);
    emitState({
      capabilities: withSelectQuality(notReadyAvailability),
      qualities: [p1080, p720]
    });
    expect(
      container.querySelector('[data-playdeck-part="settings-menu-root"]')
    ).toBe(null);
  });

  // Demonstrated red (docs/agents/demonstrated-red.md), substitute mutation:
  // #653's maintainer ruling -- a provider can report `selectQuality`
  // available while refusing `selectQuality(null)` for auto, the shape
  // `@playdeck/provider-vimeo` takes for a ladder with no `auto` entry.
  // Reverted the `autoStatus === 'available'` guard in quality.tsx to `true`
  // (rendering the Auto row unconditionally, the pre-#653 behaviour) and ran
  // this file:
  //
  //   × renders no Auto row when selectQualityAuto is unavailable, on a
  //     ladder that still has rungs
  //
  //   Test Files  1 failed | 90 passed (91)
  //        Tests  1 failed | 2302 passed (2303)
  //
  // Reverted, all 2303 passed again.
  test('renders no Auto row when selectQualityAuto is unavailable, on a ladder that still has rungs', () => {
    const { container, emitState } = renderWithPlayer(<Player.QualityMenu />);
    emitState({
      capabilities: withSelectQuality(available, {
        status: 'unavailable',
        reason: 'source'
      }),
      qualities: [p1080, p720],
      quality: p1080,
      selectedQualityId: '1080p'
    });
    const trigger = container.querySelector(
      '[data-playdeck-part="settings-menu-trigger"]'
    ) as HTMLButtonElement;
    fireEvent.click(trigger);
    const items = Array.from(
      container.querySelectorAll('[role="menuitemradio"]')
    );
    // Both rungs render -- proving the menu itself mounted with content, not
    // merely that "no Auto row" passed vacuously because nothing rendered at
    // all (docs/agents/demonstrated-red.md's "criterion whose subject is
    // capability-gated" trap).
    expect(items.map((item) => item.textContent)).toEqual(['1080p', '720p']);
    expect(items.some((item) => item.textContent?.startsWith('Auto'))).toBe(
      false
    );
  });

  test('lists each quality plus Auto as menuitemradio with aria-checked reflecting selection', () => {
    const { container, emitState } = renderWithPlayer(<Player.QualityMenu />);
    emitState({
      capabilities: withSelectQuality(available),
      qualities: [p1080, p720],
      quality: p1080,
      selectedQualityId: '720p'
    });
    const trigger = container.querySelector(
      '[data-playdeck-part="settings-menu-trigger"]'
    ) as HTMLButtonElement;
    fireEvent.click(trigger);
    const items = Array.from(
      container.querySelectorAll('[role="menuitemradio"]')
    );
    expect(items.map((item) => item.textContent)).toEqual([
      'Auto (1080p)',
      '1080p',
      '720p'
    ]);
    const auto = items.find((item) => item.textContent === 'Auto (1080p)');
    const r1080 = items.find((item) => item.textContent === '1080p');
    const r720 = items.find((item) => item.textContent === '720p');
    expect(auto?.getAttribute('aria-checked')).toBe('false');
    expect(r1080?.getAttribute('aria-checked')).toBe('false');
    expect(r720?.getAttribute('aria-checked')).toBe('true');
  });

  // The comment above `PlayerState.qualities` (types.ts) names the split this
  // guards: `quality` is the level actually playing, `selectedQualityId` is
  // what the consumer chose. `null` means auto, and the auto row's own label
  // names the playing level rather than just reading "Auto" -- distinct from
  // the selection check above, which is `selectedQualityId` alone.
  test('the Auto row is checked, and labelled from the playing level, when selectedQualityId is null', () => {
    const { container, emitState } = renderWithPlayer(<Player.QualityMenu />);
    emitState({
      capabilities: withSelectQuality(available),
      qualities: [p1080, p720],
      quality: p720,
      selectedQualityId: null
    });
    fireEvent.click(
      container.querySelector(
        '[data-playdeck-part="settings-menu-trigger"]'
      ) as HTMLButtonElement
    );
    const auto = Array.from(
      container.querySelectorAll('[role="menuitemradio"]')
    ).find((item) => item.textContent === 'Auto (720p)');
    expect(auto).toBeDefined();
    expect(auto?.getAttribute('aria-checked')).toBe('true');
  });

  test('the Auto row reads plain "Auto" before a playing level is known', () => {
    const { container, emitState } = renderWithPlayer(<Player.QualityMenu />);
    emitState({
      capabilities: withSelectQuality(available),
      qualities: [p1080],
      quality: null,
      selectedQualityId: null
    });
    fireEvent.click(
      container.querySelector(
        '[data-playdeck-part="settings-menu-trigger"]'
      ) as HTMLButtonElement
    );
    expect(container.querySelector('[role="menuitemradio"]')?.textContent).toBe(
      'Auto'
    );
  });

  test('selecting a quality calls controller.selectQuality with its id', () => {
    const { container, emitState, selectQuality } = renderWithPlayer(
      <Player.QualityMenu />
    );
    emitState({
      capabilities: withSelectQuality(available),
      qualities: [p1080, p720],
      quality: p1080,
      selectedQualityId: '1080p'
    });
    fireEvent.click(
      container.querySelector(
        '[data-playdeck-part="settings-menu-trigger"]'
      ) as HTMLButtonElement
    );
    const rung720 = Array.from(
      container.querySelectorAll('[role="menuitemradio"]')
    ).find((item) => item.textContent === '720p') as HTMLButtonElement;
    fireEvent.click(rung720);
    expect(selectQuality).toHaveBeenCalledWith('720p');
  });

  test('selecting Auto calls controller.selectQuality with null', () => {
    const { container, emitState, selectQuality } = renderWithPlayer(
      <Player.QualityMenu />
    );
    emitState({
      capabilities: withSelectQuality(available),
      qualities: [p1080, p720],
      quality: p1080,
      selectedQualityId: '1080p'
    });
    fireEvent.click(
      container.querySelector(
        '[data-playdeck-part="settings-menu-trigger"]'
      ) as HTMLButtonElement
    );
    const auto = Array.from(
      container.querySelectorAll('[role="menuitemradio"]')
    ).find((item) => item.textContent?.startsWith('Auto')) as HTMLButtonElement;
    fireEvent.click(auto);
    expect(selectQuality).toHaveBeenCalledWith(null);
  });

  test('carries an accessible label on its trigger', () => {
    const { container, emitState } = renderWithPlayer(<Player.QualityMenu />);
    emitState({
      capabilities: withSelectQuality(available),
      qualities: [p1080],
      quality: p1080,
      selectedQualityId: null
    });
    const trigger = container.querySelector(
      '[data-playdeck-part="settings-menu-trigger"]'
    );
    expect(trigger?.getAttribute('aria-label')).toBe('Quality');
  });
});
