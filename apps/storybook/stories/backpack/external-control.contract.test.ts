import type { PlayerHandle } from '@reely/react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createElement, createRef, useCallback, type Ref } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackpackVideo, type BackpackVideoProps } from './backpack-video';
import { useReportingProvider } from './reporting-provider';

/**
 * SIDEPRO-201: external play-state control for `BackpackVideo`, through the
 * mechanism already settled rather than a new prop — the `PlayerHandle` ref
 * the wrapper already forwards (`backpack-video.tsx:108-112`, its
 * `readonly ref?: Ref<Player.PlayerHandle>`, forwarded at `:539`, `ref={ref}`), plus
 * `activateFromInteraction`, which Task 1 put on that handle so a dormant
 * interaction-loading player can be started from outside
 * (`packages/react/src/use-activation.ts:324-356`, its
 * `const activateFromInteraction = useCallback`). External commands arrive
 * as ordinary player reports, so what every test below actually exercises is
 * the wrapper's existing three-deep playback fold (`backpack-video.tsx:300-317`,
 * the three `requestPlayback` branches) and its `onPlayChange` reporting
 * (`:322-327`, the two `useOnChange` calls) — nothing here adds a fourth
 * source of playback truth.
 *
 * Every player below is staged already `ready`, the way
 * `off-screen-pause.contract.test.ts` stages its own `StagedVideo`: a
 * {@link useReportingProvider} installed straight onto the controller through
 * the wrapper's own ref, bypassing real activation. `activateFromInteraction`
 * is exercised too — it is half of the external "play" command — but only in
 * its no-op branch, which is what a `ready` player puts it in
 * (`packages/react/src/use-activation.ts:354`, its
 * `if (activation !== 'dormant') return`). Reaching a genuinely
 * `dormant` player through to a real `play` would need `Player.Root` to load
 * an actual provider through `@reely/react`'s own, unmocked `loadProvider`
 * (`packages/react/src/provider-loaders.ts`): an http(s) source would touch
 * the network for real, which this suite forbids, and a `mock://` source
 * fails detection before `loadProvider` is ever called
 * (`packages/react/src/use-activation.ts:512`, its
 * `source.status !== 'success'` early return). Mocking that module from
 * outside the package it belongs to would be the kind of private-boundary
 * reach this repository does not make elsewhere. That half is already
 * pinned inside `packages/react/test/activation.test.tsx`, against the real
 * pipeline with `loadProvider` mocked at the package's own boundary:
 * `'interaction plays once when installation synchronously becomes ready'`
 * (`:473-509`), `'interaction queues its play behind load when attach
 * reports readiness'` (`:511-554`), and `'interaction plays exactly once
 * after asynchronous readiness'` (`:1160-1188`).
 */

/**
 * `BackpackVideo` with {@link useReportingProvider}'s staged provider, plus a
 * second ref exposing the same handle to the test body as the external
 * controller a carousel would hold — distinct from the staging harness that
 * installs the provider. The wrapper forwards one `ref` position, so the two
 * have to land on it together. Both targets are plain object refs this file
 * creates itself, so writing into both `.current`s through {@link assignHandle}
 * is the whole of the merge; the general case, with a callback ref's own
 * cleanup, is `assignRef` (`packages/react/src/viewport-media.tsx:51-61`),
 * which is not part of `@reely/react`'s public surface and more than either
 * target here needs.
 */
const assignHandle = (
  ref: Ref<PlayerHandle> | undefined,
  handle: PlayerHandle | null
): void => {
  if (typeof ref === 'function') ref(handle);
  else if (ref) ref.current = handle;
};

const ExternallyControlledVideo = ({
  external,
  ...props
}: BackpackVideoProps & { readonly external: Ref<PlayerHandle> }) => {
  const stagedRef = useReportingProvider();
  const mergedRef = useCallback(
    (handle: PlayerHandle | null) => {
      assignHandle(stagedRef, handle);
      assignHandle(external, handle);
    },
    [external, stagedRef]
  );
  return createElement(BackpackVideo, { ...props, ref: mergedRef });
};

/**
 * Mounts the wrapper already `ready` and hands back the test's own handle to
 * drive it externally. `pauseOnOutOfViewport: false` keeps the off-screen-pause
 * machinery out of these tests explicitly, rather than resting on this file
 * running under happy-dom's own `IntersectionObserver` (the root
 * `vitest.config.ts:32,39` runs every `*.contract.test.ts` file under that
 * environment) never reporting a visibility change on its own — leaving the
 * default on would make these assertions depend on that instead of on
 * anything the wrapper actually decides.
 */
const renderExternallyControlled = (
  overrides: Partial<BackpackVideoProps> = {}
) => {
  const onPlayChange = vi.fn<(isPlaying: boolean) => void>();
  const external = createRef<PlayerHandle>();
  const props: BackpackVideoProps = {
    muted: true,
    onPlayChange,
    pauseOnOutOfViewport: false,
    url: 'mock://reely/unresolvable.mp4',
    ...overrides
  };
  const view = render(
    createElement(ExternallyControlledVideo, { ...props, external })
  );
  return {
    ...view,
    external,
    /** Every `onPlayChange` the wrapper has reported, in order. */
    reported: () => onPlayChange.mock.calls.map(([isPlaying]) => isPlaying),
    /** The viewer clicking the wrapper's own play/pause toggle. */
    toggle: () => {
      fireEvent.click(view.container.querySelector('.ef-video-controller')!);
    }
  };
};

describe('BackpackVideo external play-state control', () => {
  afterEach(() => {
    cleanup();
  });

  // Criterion 1, at the level this rig can reach — see the file-level comment
  // for the dormant half it cannot. `{ ok: true }` rather than a state read is
  // the assertion the brief calls for: a `state.playback` change could in
  // principle come from anywhere, but a `CommandResult` of `{ ok: true }` is
  // only ever the reporting provider's own `play` having actually run
  // (`packages/core/src/player-controller.ts:383-384,727-744`).
  it('starts the video with one external command, without a second call or double activation', async () => {
    const { external, reported } = renderExternallyControlled();

    // A no-op: activation is already `ready`, not `dormant`
    // (`packages/react/src/use-activation.ts:354`,
    // `if (activation !== 'dormant') return`), so this returns without
    // touching anything. Pinned so the assertion below is about the `play`
    // call alone, not this having quietly done part of the work.
    external.current!.activateFromInteraction();
    expect(reported()).toEqual([]);

    const result = await act(() => external.current!.play());

    expect(result).toEqual({ ok: true });
    expect(reported()).toEqual([true]);

    // The same two-call command again: `activateFromInteraction` is still a
    // no-op, and a repeated `play` against an already-playing provider is
    // what "no second call" promises will not double.
    external.current!.activateFromInteraction();
    await act(() => external.current!.play());

    expect(reported()).toEqual([true]);
  });

  // Criterion 2 — Backpack's own regression under a different mechanism: a
  // guard that stopped syncing an external instruction once a video had
  // played (`useVideoPlayerState.ts:53-55`, its jotai-atom equivalent of this
  // wrapper's player-report fold). Nothing here plays a comparable role, but
  // this test is what would catch it if one crept in.
  it('honours an external pause issued after the viewer started playback by hand', async () => {
    const { external, reported, toggle } = renderExternallyControlled();

    toggle();
    expect(reported()).toEqual([true]);

    const result = await act(() => external.current!.pause());

    expect(result).toEqual({ ok: true });
    expect(reported()).toEqual([true, false]);
  });

  // Criterion 3, both halves: each direction reported, and a repeated command
  // does not report twice — `usePlayerState`'s selector already returns the
  // same `playerPlaying` boolean for a second `play` against a provider that
  // was already playing, so the wrapper's `useChanged` fold
  // (`backpack-video.tsx:277`, `const playerReported`) never sees a change to fold in.
  it('reports each externally caused transition once, in both directions', async () => {
    const { external, reported } = renderExternallyControlled();

    await act(() => external.current!.play());
    await act(() => external.current!.play());
    expect(reported()).toEqual([true]);

    await act(() => external.current!.pause());
    await act(() => external.current!.pause());
    expect(reported()).toEqual([true, false]);
  });

  // Criterion 4 (the issue's acceptance criterion 3): release retains
  // nothing, so there is no third call belonging here — the assertion is
  // built from the two calls that exist either side of where a release would
  // have gone, proving the gap is safe rather than merely leaving it as prose.
  it('still takes a later external command after the no-op reset', async () => {
    const { external, reported } = renderExternallyControlled();

    await act(() => external.current!.play());
    await act(() => external.current!.pause());
    // The no-op reset itself: nothing to call.
    await act(() => external.current!.play());

    expect(reported()).toEqual([true, false, true]);
  });
});
