import {
  createInitialPlayerState,
  type PlayerController,
  type ProviderAdapter
} from '@reely/core';
import type { PlayerHandle } from '@reely/react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createElement, useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BackpackVideoHoverPreview,
  type BackpackVideoHoverPreviewProps
} from './backpack-video-hover-preview';
import {
  ControlledIntersectionObserver,
  installObserver,
  restoreObserver
} from './controlled-intersection-observer';
import { createReportingProvider } from './reporting-provider';

/**
 * SIDEPRO-204: `BackpackVideoHoverPreview`, the composition standing in for
 * Backpack's `VideoHoverPreview`
 * (`/Users/pedrosousa/Documents/apps/backpack/beta/src/components/Video/VideoHoverPreview.tsx:44-178`).
 *
 * Everything below stages a provider straight onto the controller over a
 * `mock://` source, the way `off-screen-pause.contract.test.ts` and
 * `backpack-autoplay-video.contract.test.ts` do: this suite forbids the
 * network, and a dormant interaction-loading player cannot reach a real
 * provider without it (`external-control.contract.test.ts:30-39`, from
 * `Reaching a genuinely` `dormant` player, writes the constraint up at length).
 *
 * Two of the composition's defaults are deliberately not pinned anywhere below,
 * because this rig cannot observe them: `muted` and `loop` both need a provider,
 * and no provider attaches to a source that fails detection. `muted` is
 * reconciled by issuing `mute`/`unmute` at the controller
 * (`packages/react/src/root.tsx:178`, `value ? controller.mute() :
 * controller.unmute()`, from the reconcile at `:250-265`) and, on
 * the native path only, by setting the property on a media element (`:333`,
 * `media.muted = controlledMuted.current ?? desiredMuted.current`);
 * `loop` travels in the `nativeOptions` handed to the loader (`:439`,
 * `nativeOptions: { endTime, loop, startTime }`); and
 * `Player.Media` renders no element at all for a source that fails detection
 * (`packages/react/src/viewport-media.tsx:181-183,227-229`). The `mute` command
 * `backpack-autoplay-video.contract.test.ts` watches for is not available either:
 * `#attemptAutoplay` issues it only for `autoplay: 'muted'`
 * (`packages/core/src/player-controller.ts:657-695`), and nothing here autoplays.
 * A real-playback story is where those two become observable.
 */

/** Every provider command issued, in order. */
type CommandLog = string[];

/**
 * Every position the composition seeked to, in order — which is the whole of
 * the restart behaviour, told apart from playback deliberately.
 *
 * The play and pause commands are *not* asserted directly anywhere below, and
 * the reason is `BackpackVideo`'s echo: it folds the player's own report back
 * in and re-issues the command that produced it, a deliberate idempotent no-op
 * (`backpack-video.tsx:319-324`, the `useOnChange` that drives the player). So
 * one hover reaches the provider as two `play` calls, and — since the echo
 * arrives on the provider's confirmation rather than synchronously — a hover
 * that ends puts its `seekTo` *between* the pause and the pause's echo. Neither
 * the count nor the position of a repeat means anything here.
 *
 * `onPlayChange` is the playback narrative instead, and it is a better witness
 * than the log: the wrapper reports only transitions (`backpack-video.tsx:327`,
 * `useOnChange(isPlaying, onPlayChange)`),
 * so the echo cannot appear in it, and a reported `false` is the *provider* having
 * confirmed the pause rather than merely the command having been issued.
 */
const seekedPositions = (commands: CommandLog): number[] =>
  commands
    .filter((command) => command.startsWith('seekTo:'))
    .map((command) => Number(command.slice('seekTo:'.length)));

/**
 * {@link createReportingProvider}'s adapter with its commands logged and a
 * `seekTo` added. Decorating the shared provider rather than writing a second
 * one, as `backpack-autoplay-video.contract.test.ts:80-97` does with its own
 * `logCommands` — which is also why the delegations are asserted non-null:
 * `ProviderAdapter` leaves them optional and this one defines both
 * (`reporting-provider.ts:43-50`, its `play` and `pause`).
 *
 * `seekTo` is this file's own addition, because the shared provider has none
 * (`reporting-provider.ts:34-55` stops at `setPlaybackRate`) and
 * `PlayerController` refuses a command the adapter cannot perform. It reports
 * the position back, which is what makes the restart observable as a state
 * change rather than only as a call.
 */
const instrument = (
  adapter: ProviderAdapter,
  emit: (patch: { readonly currentTime: number }) => void,
  commands: CommandLog
): ProviderAdapter => ({
  ...adapter,
  pause: async () => {
    commands.push('pause');
    return adapter.pause!();
  },
  play: async () => {
    commands.push('play');
    return adapter.play!();
  },
  seekTo: async (time: number) => {
    commands.push(`seekTo:${time}`);
    emit({ currentTime: time });
    return { ok: true };
  }
});

/**
 * The staged provider, attached through the handle the composition forwards.
 * Not `useReportingProvider` (`reporting-provider.ts:67-86`), because both the
 * command log and the position emitter have to be reachable from the test body,
 * and that hook keeps its provider to itself.
 */
const useStagedProvider = (
  adapter: ProviderAdapter,
  ready: () => void
): React.RefObject<PlayerHandle | null> => {
  const handle = useRef<PlayerHandle>(null);
  useEffect(() => {
    // `Player.Root`'s imperative handle is its `PlayerController`; the cast
    // opens the provider-facing `setProvider` that `PlayerHandle` omits.
    const controller = handle.current as PlayerController | null;
    if (!controller) return;
    controller.setProvider(adapter);
    ready();
    return () => controller.setProvider(undefined);
  }, [adapter, ready]);
  return handle;
};

const StagedPreview = ({
  adapter,
  ready,
  ...props
}: BackpackVideoHoverPreviewProps & {
  readonly adapter: ProviderAdapter;
  readonly ready: () => void;
}) =>
  createElement(BackpackVideoHoverPreview, {
    ...props,
    ref: useStagedProvider(adapter, ready)
  });

/**
 * The composition over a provider that is already attached and ready, so every
 * transition below is the composition's own hover machine and nothing else.
 */
const renderPreview = (
  overrides: Partial<BackpackVideoHoverPreviewProps> = {}
) => {
  const commands: CommandLog = [];
  const provider = createReportingProvider();
  const adapter = instrument(provider.adapter, provider.emit, commands);
  const ready = () =>
    provider.emit({
      activation: 'ready',
      capabilities: createInitialPlayerState().capabilities,
      lifecycle: 'ready',
      playback: 'paused',
      provider: 'native'
    });
  const onPlayChange = vi.fn<(isPlaying: boolean) => void>();
  let props: BackpackVideoHoverPreviewProps = {
    onPlayChange,
    url: 'mock://reely/unresolvable.mp4',
    ...overrides
  };
  const element = () =>
    createElement(StagedPreview, { ...props, adapter, ready });
  const view = render(element());
  const root = () =>
    view.container.querySelector<HTMLElement>('.ef-video-hover-preview')!;

  return {
    ...view,
    /** Every cover image on the surface — plural, so a second one shows up. */
    covers: () =>
      Array.from(view.container.querySelectorAll('.ef-video-cover-image')).map(
        (image) => image.getAttribute('src')
      ),
    /** Settles the command chain a hover starts. */
    flush: () => act(async () => {}),
    /**
     * The pointer arriving over the surface. `pointerOver` rather than
     * `pointerEnter`, because React synthesises `onPointerEnter` from the
     * bubbling `pointerover`/`pointerout` pair and never listens for
     * `pointerenter` itself; `relatedTarget` outside the root is what makes the
     * synthesis an enter rather than a move within it.
     */
    hover: (pointerType = 'mouse') => {
      act(() => {
        fireEvent.pointerOver(root(), {
          pointerType,
          relatedTarget: document.body
        });
      });
    },
    /** The pointer leaving the surface. */
    unhover: (pointerType = 'mouse') => {
      act(() => {
        fireEvent.pointerOut(root(), {
          pointerType,
          relatedTarget: document.body
        });
      });
    },
    /** The provider reporting playback having reached `time`, as it would. */
    playTo: (time: number) => {
      act(() => {
        provider.emit({ currentTime: time });
      });
    },
    /** Every `onPlayChange` the composition has reported, in order. */
    reported: () => onPlayChange.mock.calls.map(([isPlaying]) => isPlaying),
    root,
    /** Every position the composition seeked to, in order. */
    seeks: () => seekedPositions(commands),
    /** Feeds the composition a new set of props, as a parent re-render would. */
    setProps: (next: Partial<BackpackVideoHoverPreviewProps>) => {
      props = { ...props, ...next };
      view.rerender(element());
    }
  };
};

describe('BackpackVideoHoverPreview', () => {
  beforeEach(installObserver);
  afterEach(() => {
    cleanup();
    restoreObserver();
  });

  // Criterion 1: the pointer arriving is the whole of the interaction, and it
  // starts playback from the start of the video.
  it('starts playing when the pointer arrives over it', async () => {
    const { flush, hover, reported } = renderPreview();

    hover();
    await flush();

    expect(reported()).toEqual([true]);
  });

  // The other half of criterion 1, and the half the first revision of this
  // component got wrong: "from the start of the video" is a promise about the
  // position, not only about playback, and a position can be non-zero before any
  // pointer has arrived. The play/pause control is the one focusable thing on the
  // surface, so a keyboard viewer can play, watch and pause with no hover at all;
  // a preview then starting where they left off is not a preview. Backpack cannot
  // reach this state — its `light={!isPlaying}` unmounts its player on hover end,
  // so every hover mounts a fresh one at zero (`VideoHoverPreview.tsx:167`) — so
  // the rewind that costs it nothing has to be asked for here.
  it('starts a preview from the start of the video', async () => {
    const { flush, hover, playTo, reported, seeks } = renderPreview();
    playTo(7);
    await flush();

    hover();
    await flush();

    expect(seeks()).toEqual([0]);
    expect(reported()).toEqual([true]);
  });

  // The same cause reached through criterion 2: the window is a crossing, and a
  // preview that began past `duration` has no crossing left to make, so without
  // the rewind above it would run to the end of the video without ever
  // restarting.
  it('restarts a preview that began past the window', async () => {
    const { flush, hover, playTo, seeks } = renderPreview({ duration: 2 });
    playTo(7);
    await flush();

    hover();
    await flush();
    playTo(8);
    await flush();

    // The rewind, then the restart the rewind made reachable.
    expect(seeks()).toEqual([0, 0]);
  });

  // The limit of that rewind, and Backpack's own limit too: a video already
  // playing is left where it is. There the hover sets an `isPlaying` that is
  // already `true`, so nothing remounts and nothing rewinds
  // (`VideoHoverPreview.tsx:81-87`); here the guard is explicit. With a mouse the
  // case cannot arise — the control cannot be clicked without hovering the
  // surface first, so `previewing` is already true and this transition never
  // happens — but a keyboard viewer who plays and is then joined by the pointer
  // must not have the video yanked back under them.
  it('leaves a video that is already playing where it is', async () => {
    const { container, flush, hover, playTo, reported, seeks } =
      renderPreview();
    await flush();
    act(() => {
      fireEvent.click(container.querySelector('.ef-video-controller')!);
    });
    // Mid-video and playing, so the assertion below is the guard's doing rather
    // than there being nothing to rewind.
    playTo(7);
    await flush();

    hover();
    await flush();

    expect(seeks()).toEqual([]);
    expect(reported()).toEqual([true]);
  });

  // Criterion 2, and the divergence from Backpack that the component's own
  // JSDoc records: the restart is driven by the position the player reports,
  // not by a wall clock started when playback was requested. Backpack's
  // `setInterval(duration * 1000)` (`VideoHoverPreview.tsx:89-103`) would have
  // fired at five seconds of real time regardless of where the video had
  // actually got to.
  it('returns to the start once the preview window has elapsed', async () => {
    const { flush, hover, playTo, reported, seeks } = renderPreview();
    hover();
    await flush();

    playTo(4.9);
    await flush();
    // The rewind hover start issues, and nothing else: 4.9 has not crossed.
    expect(seeks()).toEqual([0]);

    playTo(5);
    await flush();

    // The opening rewind, then the restart.
    expect(seeks()).toEqual([0, 0]);
    // Still playing: the preview loops back rather than stopping, and nothing
    // was reported to the parent because playback never changed.
    expect(reported()).toEqual([true]);
  });

  // The window is a position, so a video that stalls short of it is never
  // restarted — which is the whole point of reading the player rather than a
  // clock. Backpack's interval would have seeked here.
  it('leaves a video that has not reached the window alone', async () => {
    const { flush, hover, playTo, reported, seeks } = renderPreview();
    hover();
    await flush();

    playTo(1);
    playTo(2);
    playTo(4.999);
    await flush();

    // The opening rewind alone: three reports climbing to within a thousandth of
    // the window, and not one of them restarted anything.
    expect(seeks()).toEqual([0]);
    // Playing throughout, so the absence of a second seek above is the guard
    // doing its job rather than a preview that never started.
    expect(reported()).toEqual([true]);
  });

  it('takes the preview window from duration', async () => {
    const { flush, hover, playTo, seeks } = renderPreview({ duration: 2 });
    hover();
    await flush();

    playTo(1.9);
    await flush();
    expect(seeks()).toEqual([0]);

    playTo(2);
    await flush();

    // 2 crosses a window of 2 where 5 did not, which is the whole of the prop.
    expect(seeks()).toEqual([0, 0]);
  });

  // The restart repeats for as long as the hover does: `seekTo` reports the
  // position back, so the next pass over the window is a fresh crossing rather
  // than a second reading of the same one.
  it('restarts again on every pass over the window', async () => {
    const { flush, hover, playTo, seeks } = renderPreview({ duration: 2 });
    hover();
    await flush();

    playTo(2);
    await flush();
    playTo(1);
    playTo(2);
    await flush();

    // The opening rewind, then one restart per pass.
    expect(seeks()).toEqual([0, 0, 0]);
  });

  // A player that reports its way past the window without the seek landing must
  // not be seeked once per report. `loop` is separately on by default, so such a
  // video still wraps at its own end.
  it('asks for one restart per crossing', async () => {
    const { flush, hover, playTo, seeks } = renderPreview({ duration: 2 });
    hover();
    await flush();

    playTo(2);
    playTo(2.5);
    playTo(3);
    await flush();

    // The opening rewind and exactly one restart, from three reports at or past
    // the window.
    expect(seeks()).toEqual([0, 0]);
  });

  // Criterion 3. Both halves of "resets the video": playback stops, and the
  // position goes back to the start so the next hover previews from the
  // beginning rather than from wherever the last one stopped.
  it('pauses and rewinds when the pointer leaves', async () => {
    const { flush, hover, playTo, reported, seeks, unhover } = renderPreview();
    hover();
    await flush();
    playTo(3);

    unhover();
    await flush();

    expect(reported()).toEqual([true, false]);
    // Two rewinds, opening and closing. The second is the one under test, and it
    // is a rewind from 3 rather than from the window: the position goes back
    // because the hover ended, not because anything crossed.
    expect(seeks()).toEqual([0, 0]);
  });

  // The window belongs to the hover. A position report arriving over a video
  // nobody is hovering is somebody else's playback — the viewer clicked the
  // play control — and yanking that back to the start every few seconds would
  // make the video unwatchable. Backpack scopes it the same way, its interval
  // being keyed on the hover-derived `isPlaying` alone
  // (`VideoHoverPreview.tsx:90`).
  it('does not restart playback it is not previewing', async () => {
    const { flush, playTo, reported, seeks } = renderPreview({ duration: 2 });
    await flush();

    playTo(5);
    await flush();

    expect(seeks()).toEqual([]);
    expect(reported()).toEqual([]);
  });
});

/**
 * The cover layer. This is the half of the component `BackpackVideo` cannot do
 * for it: the wrapper's own cover is gated on `!startedPlaying`
 * (`backpack-video.tsx:333`, its `const showsCover`), so it can never come back — and
 * it could not even if that gate were relaxed, because it renders inside
 * `Player.Poster`, which Reely turns `visibility: hidden` on the first reported
 * playback and never restores for the same source
 * (`packages/react/src/poster.tsx:75`, against `root.tsx:471-476`, the
 * `setHiddenTransition` on `playback === 'playing'`).
 *
 * So the layer is the composition's own, exactly as it is Backpack's own
 * (`VideoHoverPreview.tsx:144-155`, a `VideoCoverImage` outside the
 * `VideoPlayer`). What it reuses is the resolution hook and the class names, not
 * a second copy of either.
 */
describe('BackpackVideoHoverPreview cover image', () => {
  beforeEach(installObserver);
  afterEach(() => {
    cleanup();
    restoreObserver();
  });

  it('shows the cover image at rest', () => {
    const { covers } = renderPreview({
      placeholderImageSrc: 'https://reely.dev/cover.jpg'
    });

    expect(covers()).toEqual(['https://reely.dev/cover.jpg']);
  });

  it('uncovers the video while the preview plays', async () => {
    const { covers, flush, hover } = renderPreview({
      placeholderImageSrc: 'https://reely.dev/cover.jpg'
    });

    hover();
    await flush();

    expect(covers()).toEqual([]);
  });

  // Criterion 3, the half `BackpackVideo` cannot reach on its own.
  it('brings the cover image back when the pointer leaves', async () => {
    const { covers, flush, hover, unhover } = renderPreview({
      placeholderImageSrc: 'https://reely.dev/cover.jpg'
    });
    hover();
    await flush();
    expect(covers()).toEqual([]);

    unhover();
    await flush();

    expect(covers()).toEqual(['https://reely.dev/cover.jpg']);
  });

  // The brief's "reuse rather than adding a second cover implementation", as an
  // assertion: `BackpackVideo` renders a cover of its own whenever it is given
  // one, so a composition that passed `placeholderImageSrc` straight through
  // would stack two images over the same video — visually identical at rest and
  // wrong the moment they disagree.
  it('puts exactly one cover image on the surface', async () => {
    const { container, covers, flush, hover, unhover } = renderPreview({
      placeholderImageSrc: 'https://reely.dev/cover.jpg'
    });

    expect(container.querySelectorAll('.ef-video-cover')).toHaveLength(1);
    // `Player.Poster` is what `BackpackVideo`'s own cover renders inside, so its
    // absence is the specific evidence that only one implementation is in play.
    expect(
      container.querySelectorAll('[data-reely-part="poster"]')
    ).toHaveLength(0);

    hover();
    await flush();
    unhover();
    await flush();

    expect(covers()).toEqual(['https://reely.dev/cover.jpg']);
  });

  // The play icon is the other half of the resting surface, and this composition
  // adds none of its own — `BackpackVideo`'s already returns on a pause, because
  // with `controls` at its default `false` its condition reduces to
  // `!isPlaying && showPlayIcon` (`backpack-video.tsx`'s
  // `!isPlaying && !controls && showPlayIcon` gate).
  // Backpack renders its
  // own icon unconditionally on `showPlayIcon` (`VideoHoverPreview.tsx:156-158`),
  // so a second one here would be the same duplication as a second cover.
  it('brings the play icon back with the cover', async () => {
    const { container, flush, hover, unhover } = renderPreview({
      placeholderImageSrc: 'https://reely.dev/cover.jpg'
    });
    const icons = () => container.querySelectorAll('.ef-video-play-icon');

    expect(icons()).toHaveLength(1);

    hover();
    await flush();
    expect(icons()).toHaveLength(0);

    unhover();
    await flush();

    expect(icons()).toHaveLength(1);
  });

  it('has no cover layer at all without an image to show', () => {
    const { container } = renderPreview();

    expect(container.querySelector('.ef-video-cover')).toBe(null);
  });

  // `renderCustomImage` is Backpack's own escape hatch and it has to reach this
  // layer, since this layer is the only cover the composition has
  // (`VideoHoverPreview.tsx:150`).
  it('renders the cover through renderCustomImage', () => {
    const { container } = renderPreview({
      alt: 'A city at night',
      placeholderImageSrc: 'https://reely.dev/cover.jpg',
      renderCustomImage: 'picture'
    });
    const cover = container.querySelector('.ef-video-cover-image')!;

    expect(cover.tagName).toBe('PICTURE');
    expect(cover.getAttribute('alt')).toBe('A city at night');
    expect(cover.getAttribute('src')).toBe('https://reely.dev/cover.jpg');
  });

  // Unlike `BackpackVideo`'s cover, which sits inside an `aria-hidden`
  // `Player.Poster` and so cannot expose its own text at all
  // (`packages/react/src/poster.tsx:66`, and the argument at
  // `backpack-video.tsx:366-375`, from ``Player.Poster` is the container`, and the whole of it in
  // `video-cover-image.tsx`'s own JSDoc). Here the cover is the resting representation
  // of the video rather than an overlay on a playing one, so `alt` is worth
  // reaching the accessibility tree — and Backpack's default `alt = ''`
  // (`VideoHoverPreview.tsx:56`) keeps an unlabelled cover decorative, which is
  // what an empty `alt` already means to a screen reader.
  it('exposes the cover’s alt text', () => {
    const { container } = renderPreview({
      alt: 'A city at night',
      placeholderImageSrc: 'https://reely.dev/cover.jpg'
    });
    const cover = container.querySelector('.ef-video-cover')!;

    expect(cover.getAttribute('aria-hidden')).toBe(null);
    expect(
      container.querySelector('.ef-video-cover-image')!.getAttribute('alt')
    ).toBe('A city at night');
  });
});

/**
 * What starts a preview, and what must not. A touch device has no hover state at
 * all, so the resting cover is the correct behaviour there — and `isHovered` is
 * the way in for a parent that wants one anyway.
 */
describe('BackpackVideoHoverPreview hover sources', () => {
  beforeEach(installObserver);
  afterEach(() => {
    cleanup();
    restoreObserver();
  });

  // A tap raises a `pointerenter` a mouse never would, and no `pointerleave`
  // after it — so a preview started from one would play on until the next tap
  // somewhere else, over a cover that never came back.
  it('ignores a touch pointer', async () => {
    const { covers, flush, hover, reported } = renderPreview({
      placeholderImageSrc: 'https://reely.dev/cover.jpg'
    });

    hover('touch');
    await flush();

    expect(reported()).toEqual([]);
    expect(covers()).toEqual(['https://reely.dev/cover.jpg']);
  });

  it('previews a pen pointer, which hovers like a mouse', async () => {
    const { flush, hover, reported } = renderPreview();

    hover('pen');
    await flush();

    expect(reported()).toEqual([true]);
  });

  // Backpack's `isHovered`, OR'd with the pointer rather than replacing it
  // (`VideoHoverPreview.tsx:79`). No story exercises it, so this is the only
  // thing holding it up.
  it('previews while a parent holds isHovered', async () => {
    const { covers, flush, reported, setProps } = renderPreview({
      placeholderImageSrc: 'https://reely.dev/cover.jpg'
    });

    setProps({ isHovered: true });
    await flush();
    expect(reported()).toEqual([true]);
    expect(covers()).toEqual([]);

    setProps({ isHovered: false });
    await flush();

    expect(reported()).toEqual([true, false]);
    expect(covers()).toEqual(['https://reely.dev/cover.jpg']);
  });

  // The OR, not a replacement: a pointer leaving must not end a preview the
  // parent is still asking for.
  it('keeps previewing while isHovered outlasts the pointer', async () => {
    const { flush, hover, reported, setProps, unhover } = renderPreview();
    setProps({ isHovered: true });
    await flush();

    hover();
    unhover();
    await flush();

    expect(reported()).toEqual([true]);
  });

  // The restart is driven for an externally-held preview too, since it is the
  // same state — a parent driving `isHovered` gets the whole behaviour, not just
  // playback. The opening rewind included, which is the same promise: a preview a
  // parent asks for starts at the start.
  it('restarts an externally-held preview at the window', async () => {
    const { flush, playTo, seeks, setProps } = renderPreview({ duration: 2 });
    setProps({ isHovered: true });
    await flush();

    playTo(2);
    await flush();

    expect(seeks()).toEqual([0, 0]);
  });
});

/**
 * The surface's own shape: what is focusable, what it is called, and where the
 * caller's class lands. The keyboard story is the component's largest deliberate
 * divergence from Backpack, and its JSDoc carries the argument — this is what
 * holds the result in place.
 */
describe('BackpackVideoHoverPreview surface', () => {
  beforeEach(installObserver);
  afterEach(() => {
    cleanup();
    restoreObserver();
  });

  // Backpack's root is a `role='button'` with `tabIndex={0}` enclosing three more
  // tab stops, one of them nameless (`VideoHoverPreview.tsx:134-143`,
  // `VideoCoverImage.tsx:97-103`, `VideoPlayer.tsx:354-355,368`). This asserts the
  // shape that replaces it: one tab stop on the whole surface, and a name on it.
  it('puts exactly one named control in the tab order', () => {
    const { container, root } = renderPreview({
      placeholderImageSrc: 'https://reely.dev/cover.jpg'
    });
    const focusable = container.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]'
    );

    expect(focusable).toHaveLength(1);
    expect(focusable[0]!.getAttribute('aria-label')).toBe('Play video');
    // The preview root is a plain container: a `role='button'` here would swallow
    // the control above, and a `tabIndex` would add a stop with nothing to do.
    expect(root().getAttribute('role')).toBe(null);
    expect(root().getAttribute('tabindex')).toBe(null);
  });

  // The cover sits over that control, so it has to let clicks through or the
  // resting surface would have no working affordance at all. The rule lives in
  // `backpack-video-styles.ts`; this pins that the layer is not given a handler
  // or a tab stop of its own to compete with.
  it('leaves the cover layer out of the interaction', () => {
    const { container } = renderPreview({
      placeholderImageSrc: 'https://reely.dev/cover.jpg'
    });
    const cover = container.querySelector('.ef-video-cover')!;

    expect(cover.getAttribute('tabindex')).toBe(null);
    expect(cover.getAttribute('role')).toBe(null);
  });

  // That control is the keyboard and touch path, so the hover machine must leave
  // playback started through it alone: nothing here ever hovers, so `previewing`
  // never changes and the pause-and-rewind on hover end must not run. A pointer
  // that hovers and leaves *does* end playback, as it does in Backpack — there
  // `isPlaying` reaches its player as `playing={isPlaying}`
  // (`VideoHoverPreview.tsx:162`), so a hover ending pauses a clicked video too —
  // but a hover that never happened cannot end.
  it('leaves playback started through the control alone', async () => {
    const { container, flush, reported, seeks } = renderPreview();
    await flush();

    act(() => {
      fireEvent.click(container.querySelector('.ef-video-controller')!);
    });
    await flush();

    expect(reported()).toEqual([true]);
    expect(seeks()).toEqual([]);
  });

  // Backpack's spread order: `ef-video-hover-preview` is `cn`'s first argument and
  // the caller's `className` its last (`VideoHoverPreview.tsx:115`), on the
  // preview root rather than on the player box (`:135`).
  it('composes its own class ahead of the caller’s, on its own root', () => {
    const { container, root } = renderPreview({ className: 'story-preview' });

    expect(root().className).toBe('ef-video-hover-preview story-preview');
    expect(container.querySelector('.ef-video-player')!.className).toBe(
      'ef-video-player'
    );
  });
});

/**
 * `pauseOnOutOfViewport`, which Backpack switches off for the player it composes
 * (`VideoHoverPreview.tsx:171`) and leaves overridable behind its prop spread
 * (`:172`).
 */
describe('BackpackVideoHoverPreview off-screen pause', () => {
  beforeEach(installObserver);
  afterEach(() => {
    cleanup();
    restoreObserver();
  });

  /** The off-screen-pause hook's observer, the only one an interaction-loading
   * player has: viewport activation is what constructs the other, and this
   * composition does not use it. */
  const scrollTo = (visible: boolean) => {
    const { instances } = ControlledIntersectionObserver;
    act(() => {
      instances[instances.length - 1]!.emit(visible);
    });
  };

  it('leaves a preview alone when the surface scrolls out of view', async () => {
    const { flush, hover, reported } = renderPreview();
    hover();
    await flush();

    scrollTo(true);
    scrollTo(false);
    await flush();

    expect(reported()).toEqual([true]);
  });

  it('lets a caller switch the off-screen pause back on', async () => {
    const { flush, hover, reported } = renderPreview({
      pauseOnOutOfViewport: true
    });
    hover();
    await flush();

    scrollTo(true);
    scrollTo(false);
    await flush();

    expect(reported()).toEqual([true, false]);
  });
});

/**
 * The three props this composition refuses, which is the half of ADR-0003's
 * "a prop the component cannot honour is better absent" that only the compiler
 * can enforce. `tsc -b` covers this file, so a barrier removed fails the
 * typecheck here rather than going unnoticed — the shape
 * `backpack-autoplay-video.contract.test.ts:388-406`,
 * `'refuses the internal loading-strategy prop on the public component'`, sets for
 * `autoplayOnViewportEntry`.
 */
describe('BackpackVideoHoverPreview refused props', () => {
  beforeEach(installObserver);
  afterEach(() => {
    cleanup();
    restoreObserver();
  });

  // The compile-time half is the content of this test. Its runtime half cannot be
  // observed here: `light` only ever adds a cover by way of a thumbnail lookup
  // (`backpack-video.tsx:501-504`, its `useVideoThumbnail` call), which needs an
  // oEmbed request this suite
  // forbids, and over a `mock://` source there is no endpoint to fetch from
  // (`video-thumbnail.ts:26-35`). What holds the runtime side up instead is the
  // forcing after the spread and "puts exactly one cover image on the surface"
  // above, which is the outcome `light` would break.
  it('refuses light, which would stack a second cover image', async () => {
    const { container, covers, flush } = renderPreview({
      placeholderImageSrc: 'https://reely.dev/cover.jpg',
      // @ts-expect-error `light` is no part of `BackpackVideoHoverPreviewProps`.
      light: true
    });
    await flush();

    expect(covers()).toEqual(['https://reely.dev/cover.jpg']);
    expect(container.querySelector('[data-reely-part="poster"]')).toBe(null);
  });

  it('refuses hoverEffect, whose cover does not exist here', () => {
    const { container } = renderPreview({
      placeholderImageSrc: 'https://reely.dev/cover.jpg',
      // @ts-expect-error `hoverEffect` is no part of
      // `BackpackVideoHoverPreviewProps`.
      hoverEffect: true
    });

    expect(
      container
        .querySelector('.ef-video-cover')!
        .getAttribute('data-hover-effect')
    ).toBe(null);
  });

  it('refuses playing, which the hover decides', async () => {
    const { flush, reported } = renderPreview({
      // @ts-expect-error `playing` is no part of
      // `BackpackVideoHoverPreviewProps`.
      playing: true
    });
    await flush();

    // Nothing started: the prop is not forwarded, so it cannot reach the loading
    // strategy `BackpackVideo` picks from it either.
    expect(reported()).toEqual([]);
  });
});
