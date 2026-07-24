import type {
  AutoplayMode,
  CommandResult,
  PlayerController,
  ProviderAdapter,
  ProviderStateListener,
  ProviderStatePatch,
  TextCue
} from '@reely/core';
import { Root, type PlayerHandle, type RootProps } from '@reely/react';
import type { Decorator } from '@storybook/react-vite';
import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Per-story knobs for the mock player, read from `parameters.player`.
 *
 * - `state` — a `Partial<PlayerState>` emitted through a fake provider after
 *   mount, so any player state can be dialed in without media or network.
 * - `autoplay` — configures the controller's autoplay mode; combine with a
 *   failing `playResult` (`{ ok: false, reason: 'blocked' }`) and a ready
 *   `state` to reproduce blocked autoplay.
 * - `playResult` — what the fake provider's `play()` resolves to.
 * - `cues` — active `TextCue[]` emitted through the fake provider's cue
 *   channel after mount, so a story can drive `Player.Captions` without a
 *   real track.
 * - `rootProps` — overrides for the `Player.Root` the decorator renders.
 *   Use the `autoplay` knob above rather than `rootProps.autoplay`: the Root
 *   prop re-applies its own `configureAutoplay` and collides with the mock.
 */
export type MockPlayerParameters = {
  readonly state?: ProviderStatePatch;
  readonly autoplay?: AutoplayMode;
  readonly playResult?: CommandResult;
  readonly cues?: readonly TextCue[];
  readonly rootProps?: Partial<Omit<RootProps, 'children' | 'ref'>>;
};

/** Never fetched: stories do not render `Player.Media`. */
const mockSource: RootProps['source'] = {
  type: 'video',
  sources: [{ src: 'mock://reely/video.mp4', mimeType: 'video/mp4' }]
};

/**
 * A `ProviderAdapter` with the same surface the contract tests fake: every
 * lifecycle hook is a no-op and state is pushed by emitting patches, so a
 * story renders no media element and issues no requests.
 */
const createMockAdapter = (playResult: CommandResult) => {
  const listeners = new Set<ProviderStateListener>();
  const cueListeners = new Set<(cues: readonly TextCue[]) => void>();
  const ok = async (): Promise<CommandResult> => ({ ok: true });
  const adapter: ProviderAdapter = {
    provider: 'native',
    attach: () => {},
    load: () => {},
    destroy: () => {},
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeCues: (listener) => {
      cueListeners.add(listener);
      return () => cueListeners.delete(listener);
    },
    play: async () => playResult,
    pause: ok,
    mute: ok,
    unmute: ok,
    setVolume: ok,
    setPlaybackRate: ok
  };
  return {
    adapter,
    emit: (patch: ProviderStatePatch) => {
      listeners.forEach((listener) => listener(patch));
    },
    emitCues: (cues: readonly TextCue[]) => {
      cueListeners.forEach((listener) => listener(cues));
    }
  };
};

const MockPlayerRoot = ({
  children,
  parameters
}: {
  readonly children: ReactNode;
  readonly parameters: MockPlayerParameters;
}) => {
  const handleRef = useRef<PlayerHandle>(null);
  const { autoplay, cues, playResult, rootProps, state } = parameters;

  useEffect(() => {
    if (autoplay === undefined && playResult === undefined && !state && !cues)
      return;
    // Player.Root's imperative handle is its PlayerController; the cast opens
    // the provider-facing surface (setProvider) that PlayerHandle omits.
    const controller = handleRef.current as PlayerController | null;
    if (!controller) return;
    const mock = createMockAdapter(playResult ?? { ok: true });
    controller.setProvider(mock.adapter);
    if (autoplay !== undefined) controller.configureAutoplay(autoplay);
    if (state) mock.emit(state);
    if (cues) mock.emitCues(cues);
    return () => {
      controller.setProvider(undefined);
    };
  }, [autoplay, cues, playResult, state]);

  return (
    <Root
      loading="interaction"
      ref={handleRef}
      source={mockSource}
      {...rootProps}
    >
      {children}
    </Root>
  );
};

/**
 * Wraps every story in a `Player.Root` backed by a mock provider. Stories
 * dial player state in through `parameters.player` (see
 * {@link MockPlayerParameters}); without it the player sits in its pristine
 * dormant state and interaction-driven activation works for `play` tests.
 */
export const withMockPlayer: Decorator = (Story, context) => {
  if (context.tags?.includes('real-playback')) return <Story />;
  return (
    <MockPlayerRoot
      parameters={(context.parameters.player ?? {}) as MockPlayerParameters}
    >
      <Story />
    </MockPlayerRoot>
  );
};
