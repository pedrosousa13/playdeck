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

const withSelectQuality = (status: Availability): PlayerCapabilities => ({
  seek: notReadyAvailability,
  setVolume: notReadyAvailability,
  setPlaybackRate: notReadyAvailability,
  selectQuality: status,
  selectTextTrack: notReadyAvailability,
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
