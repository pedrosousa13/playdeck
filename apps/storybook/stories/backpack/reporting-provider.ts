import {
  createInitialPlayerState,
  type PlayerController,
  type ProviderAdapter,
  type ProviderStateListener,
  type ProviderStatePatch
} from '@reely/core';
import type { PlayerHandle } from '@reely/react';
import { useEffect, useRef } from 'react';

/**
 * A provider that reports playback back: with no provider attached, nothing
 * ever moves `state.playback`, so the wrapper's player-report fold
 * (`backpack-video.tsx:300-304`, the `playerReported` branch) never runs and the
 * only way in is its own
 * toggle. Under `controls: true` the toggle is not on the surface at all —
 * the click target is `Player.Controls`, which drives the controller
 * directly and reaches the wrapper only as a report.
 *
 * Everything else is a no-op, as in `.storybook/mock-player.tsx`'s adapter
 * without its `reportsPlayback` knob set (`mock-player.tsx:24-35`): the two
 * commands that emit are the two a sequence under test issues.
 *
 * Shared by `off-screen-pause.contract.test.ts` and
 * `external-control.contract.test.ts`, both of which need a provider that can
 * confirm playback without a real network attach.
 */
export const createReportingProvider = () => {
  const listeners = new Set<ProviderStateListener>();
  const emit = (patch: ProviderStatePatch): void => {
    listeners.forEach((listener) => listener(patch));
  };
  const ok = async (): Promise<{ readonly ok: true }> => ({ ok: true });
  const adapter: ProviderAdapter = {
    provider: 'native',
    attach: () => {},
    load: () => {},
    destroy: () => {},
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    play: async () => {
      emit({ playback: 'playing' });
      return { ok: true };
    },
    pause: async () => {
      emit({ playback: 'paused' });
      return { ok: true };
    },
    mute: ok,
    unmute: ok,
    setVolume: ok,
    setPlaybackRate: ok
  };
  return { adapter, emit };
};

/**
 * The wrapper with {@link createReportingProvider} staged into its own
 * `Player.Root` — the trick `MockedBackpackVideo` uses in the stories
 * (`backpack-video.stories.tsx:164-169`, its `const MockedBackpackVideo`), by way of the `ref` the wrapper
 * forwards. Reported ready, so `awaitingActivation` is false and the surface
 * hands over to `Player.Controls`; no `playing` prop, so the root loads on
 * interaction and nothing commits the inert `mock://` source.
 */
export const useReportingProvider = () => {
  const handle = useRef<PlayerHandle>(null);
  useEffect(() => {
    // `Player.Root`'s imperative handle is its `PlayerController`; the cast
    // opens the provider-facing `setProvider` that `PlayerHandle` omits.
    const controller = handle.current as PlayerController | null;
    if (!controller) return;
    const provider = createReportingProvider();
    controller.setProvider(provider.adapter);
    provider.emit({
      activation: 'ready',
      capabilities: createInitialPlayerState().capabilities,
      lifecycle: 'ready',
      playback: 'paused',
      provider: 'native'
    });
    return () => controller.setProvider(undefined);
  }, []);
  return handle;
};
