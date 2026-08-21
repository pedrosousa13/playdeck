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
 * Never fetched. `Player.Media` renders nothing until the root it sits in has
 * committed its source — the `sourceCommitted` gate in the react package's
 * `viewport-media.tsx` — and under `loading="interaction"` the one thing that
 * commits it is an `activateFromInteraction` call. So a story that never
 * activates mounts no `<video>` and no embed, whatever it composes: the source
 * below is read, but nothing carrying it reaches the document.
 *
 * `activateFromInteraction` is not unreachable here: `ActivationButton` calls
 * it (`packages/react/src/loading-error.tsx`) and `Player/ActivationButton`'s
 * `ActivatesOnClick` presses it. That story composes the overlay alone. The
 * decorator-wrapped stories that do render a `Player.Media` are the
 * `Reference/Player` set, and every one of them stages an activation through
 * the mock instead of pressing for one — which moves the controller's state,
 * not this root's commit. Every story that both renders media and plays it is
 * tagged `real-playback`, and `withMockPlayer` hands those back undecorated.
 *
 * A reserved `.invalid` host over `https:` rather than an invented `mock:`
 * scheme (#331): the shared allowlist refuses every scheme but `http:`,
 * `https:` and the scheme-less forms, so `mock:` was a source the library was
 * turning down, and every story here rode on `loading="interaction"` being the
 * one strategy that said nothing about it. `.invalid` is reserved by RFC 2606
 * and resolves nowhere, so the source stays as unfetchable as it reads.
 */
const mockSource: RootProps['source'] = {
  type: 'video',
  sources: [
    { src: 'https://provider.invalid/mock-video.mp4', mimeType: 'video/mp4' }
  ]
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
    // The handle carries exactly what `PlayerHandle` declares, and
    // `setProvider`/`configureAutoplay` are deliberately not on it (#328).
    // Staging a fake provider is the one job that needs the controller itself,
    // and this is the one sanctioned way back to it.
    //
    // The symbol is spelled out rather than imported so that this file keeps
    // consuming `@playdeck/react` through its package entry, the way an
    // outside consumer does, instead of reaching into `packages/react/src/`
    // for a module (`internal-controller.ts`) that entry deliberately does not
    // export. That is a convention and not a rule here -- eslint.config.js
    // scopes `no-restricted-imports` to `stories/reference/**`, so nothing
    // would stop a deep import from this directory. It is what the global
    // symbol registry buys: the hatch has one name, the string below, and
    // naming it is the whole of reaching it -- no deep import here, no new
    // published export there, and grepping the string puts both ends on
    // screen.
    //
    // Misspell it and this reads `undefined` and the mock is never staged, so
    // the story gets a player with no provider. `mock-player.contract.test.ts`
    // catches that in the node suite rather than the e2e run: its `seekTo`
    // cases drive a real `Player.Root` through this hook, and go red with
    // `reason: 'not-ready'` -- measured by mangling the string, not assumed.
    const controller = (
      handleRef.current as unknown as Record<symbol, PlayerController> | null
    )?.[Symbol.for('playdeck.internal.controller')];
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
