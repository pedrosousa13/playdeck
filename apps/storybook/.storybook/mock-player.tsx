import type {
  AutoplayMode,
  CommandResult,
  MediaDimensions,
  PlayerController,
  ProviderAdapter,
  ProviderStateListener,
  ProviderStatePatch,
  TextCue
} from '@playdeck/core';
import { Root, type PlayerHandle, type RootProps } from '@playdeck/react';
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
 * - `reportsPlayback` — makes the fake provider's `play`/`pause` emit a
 *   confirming `playback` patch instead of doing nothing, so a story can
 *   drive playback through the `PlayerHandle` ref it already gets back —
 *   `activateFromInteraction` then `play`, or `pause` on its own — and see
 *   `onPlayChange` and the surface follow. `playResult` still decides
 *   what `play()` resolves to, and a failing one still emits nothing: a
 *   command that did not succeed has nothing to confirm. `seekTo` is reported
 *   under the same knob — it emits the new `currentTime` when set and is a
 *   silent `ok` when not — so "not set" still means a mock that answers
 *   commands and reports nothing at all.
 * - `cues` — active `TextCue[]` emitted through the fake provider's cue
 *   channel after mount, so a story can drive `Player.Captions` without a
 *   real track.
 * - `dimensions` — intrinsic media size published through the fake provider's
 *   dimension channel after mount, so a story can drive
 *   `--playdeck-media-aspect-ratio` on the viewport without real media. Omit it
 *   to leave the property unwritten, which is the `var()` fallback case.
 * - `rootProps` — overrides for the `Player.Root` the decorator renders.
 *   Use the `autoplay` knob above rather than `rootProps.autoplay`: the Root
 *   prop re-applies its own `configureAutoplay` and collides with the mock.
 */
export type MockPlayerParameters = {
  readonly state?: ProviderStatePatch;
  readonly autoplay?: AutoplayMode;
  readonly playResult?: CommandResult;
  readonly reportsPlayback?: boolean;
  readonly cues?: readonly TextCue[];
  readonly dimensions?: MediaDimensions;
  readonly rootProps?: Partial<Omit<RootProps, 'children' | 'ref'>>;
};

/**
 * Never fetched. The decorator's root commits no source — nothing calls
 * `activateFromInteraction` on it — so `Player.Media` mounts nothing even in a
 * story whose component renders one.
 */
const mockSource: RootProps['source'] = {
  type: 'video',
  sources: [{ src: 'mock://playdeck/video.mp4', mimeType: 'video/mp4' }]
};

/**
 * A `ProviderAdapter` with the same surface the contract tests fake: every
 * lifecycle hook is a no-op and state is pushed by emitting patches, so a
 * story renders no media element and issues no requests. `reportsPlayback`
 * is the one command surface that is not a plain no-op when set: `play` and
 * `pause` emit the `playback` patch a real provider would confirm a command
 * with, rather than emitting nothing, so a story driving them through the
 * `PlayerHandle` ref sees `onPlayChange` and the surface follow.
 */
const createMockAdapter = (
  playResult: CommandResult,
  reportsPlayback: boolean
) => {
  const listeners = new Set<ProviderStateListener>();
  const cueListeners = new Set<(cues: readonly TextCue[]) => void>();
  const dimensionListeners = new Set<
    (dimensions: MediaDimensions | undefined) => void
  >();
  const emit = (patch: ProviderStatePatch) => {
    listeners.forEach((listener) => listener(patch));
  };
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
    subscribeDimensions: (listener) => {
      dimensionListeners.add(listener);
      return () => dimensionListeners.delete(listener);
    },
    play: async () => {
      // A failed command has nothing to confirm.
      if (reportsPlayback && playResult.ok) emit({ playback: 'playing' });
      return playResult;
    },
    pause: reportsPlayback
      ? async () => {
          emit({ playback: 'paused' });
          return { ok: true };
        }
      : ok,
    // Always answers — a real provider can seek whether or not a story wants to
    // watch the result, and reporting `unsupported` here would misdescribe the
    // player's capabilities — but reports the new position only under
    // `reportsPlayback`, alongside `play` and `pause`. The knob is named for
    // playback and this is a position, so the generalisation is deliberate: what
    // it really selects is whether commands confirm themselves, and a mock left
    // without it stays one that emits nothing at all. Otherwise a story that
    // asked for a non-reporting player would quietly get `currentTime` updates it
    // never staged.
    //
    // Reporting it is what lets a story put a position on the player at all —
    // nothing here decodes, so no position arrives by itself, which matters
    // for a story that enforces a preview window by position rather than by
    // a clock.
    seekTo: reportsPlayback
      ? async (time: number) => {
          emit({ currentTime: time });
          return { ok: true };
        }
      : ok,
    mute: ok,
    unmute: ok,
    setVolume: ok,
    setPlaybackRate: ok
  };
  return {
    adapter,
    emit,
    emitCues: (cues: readonly TextCue[]) => {
      cueListeners.forEach((listener) => listener(cues));
    },
    emitDimensions: (dimensions: MediaDimensions) => {
      dimensionListeners.forEach((listener) => listener(dimensions));
    }
  };
};

/**
 * A ref to hand to a `Player.Root`, which stages {@link MockPlayerParameters}
 * into that root's controller once it mounts. `withMockPlayer` uses it for the
 * root it renders itself; a story whose component owns its own `Player.Root`
 * (because a prop of its own decides the source) reaches for it directly, so
 * both paths stage state through one implementation.
 */
export const useMockPlayer = (parameters: MockPlayerParameters) => {
  const handleRef = useRef<PlayerHandle>(null);
  const { autoplay, cues, dimensions, playResult, reportsPlayback, state } =
    parameters;

  useEffect(() => {
    if (
      autoplay === undefined &&
      playResult === undefined &&
      !reportsPlayback &&
      !state &&
      !cues &&
      !dimensions
    )
      return;
    // Player.Root's imperative handle is its PlayerController; the cast opens
    // the provider-facing surface (setProvider) that PlayerHandle omits.
    const controller = handleRef.current as PlayerController | null;
    if (!controller) return;
    const mock = createMockAdapter(
      playResult ?? { ok: true },
      reportsPlayback ?? false
    );
    controller.setProvider(mock.adapter);
    if (autoplay !== undefined) controller.configureAutoplay(autoplay);
    if (state) mock.emit(state);
    if (cues) mock.emitCues(cues);
    if (dimensions) mock.emitDimensions(dimensions);
    return () => {
      controller.setProvider(undefined);
    };
  }, [autoplay, cues, dimensions, playResult, reportsPlayback, state]);

  return handleRef;
};

const MockPlayerRoot = ({
  children,
  parameters
}: {
  readonly children: ReactNode;
  readonly parameters: MockPlayerParameters;
}) => (
  <Root
    loading="interaction"
    ref={useMockPlayer(parameters)}
    source={mockSource}
    {...parameters.rootProps}
  >
    {children}
  </Root>
);

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
