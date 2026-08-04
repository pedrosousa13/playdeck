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
  BackpackAutoplayVideo,
  type BackpackAutoplayVideoProps
} from './backpack-autoplay-video';
import { BackpackVideo } from './backpack-video';
import {
  ControlledIntersectionObserver,
  installObserver,
  restoreObserver
} from './controlled-intersection-observer';
import { createReportingProvider } from './reporting-provider';

/**
 * SIDEPRO-203: `BackpackAutoplayVideo`, the composition standing in for
 * Backpack's `AutoplayVideo`
 * (`/Users/pedrosousa/Documents/apps/backpack/beta/src/components/Video/AutoplayVideo.tsx:21-38`).
 *
 * Its whole job is the configuration it hands `Player.Root` — viewport
 * activation plus muted autoplay — so what these tests watch is the two
 * observable consequences of that configuration: nothing loads until the player
 * box is on screen, and once a provider is attached playback starts by itself,
 * muted, with nothing clicked.
 *
 * The two halves cannot be pinned in one rig, because Reely's own source
 * detection stands between them. A `mock://` source fails detection
 * (`packages/react/src/use-activation.ts:330-336`), so viewport activation
 * errors instead of observing; an `http(s)` source observes, but intersecting
 * it would load a real provider and this suite forbids the network — the
 * constraint `external-control.contract.test.ts:28-36` writes up at length. So
 * the playback tests stage a provider straight onto the controller over a
 * `mock://` source, exactly as that file and `off-screen-pause.contract.test.ts`
 * do, and the activation tests use an `http(s)` source and never report an
 * intersection.
 */

/**
 * The observers Reely's own viewport activation made, told from the
 * off-screen-pause hook's by the options each side constructs with: activation
 * passes `{ rootMargin }` alone (`packages/react/src/use-activation.ts:399`),
 * the hook passes `{ root, threshold }` (`off-screen-pause.ts:224`).
 */
const activationObservers = (): ControlledIntersectionObserver[] =>
  ControlledIntersectionObserver.instances.filter(
    (observer) => observer.init.rootMargin !== undefined
  );

/** The observer the off-screen-pause hook is using. */
const pauseObserver = (): ControlledIntersectionObserver =>
  ControlledIntersectionObserver.instances.filter(
    (observer) => observer.init.rootMargin === undefined
  )[0]!;

/**
 * Every provider command issued, in order — which is how these tests tell a
 * muted autoplay attempt from an audible one. `#attemptAutoplay` awaits a
 * `mute` before it plays only for `autoplay: 'muted'`
 * (`packages/core/src/player-controller.ts:657-695`), so the sequence is the
 * mode, observed rather than asserted about the props that chose it.
 */
type CommandLog = string[];

/**
 * {@link createReportingProvider}'s adapter with its commands logged.
 * Delegating rather than reimplementing, so what confirms playback here is the
 * same shared provider the other two contract tests use — which is also why the
 * three delegations are asserted non-null: `ProviderAdapter` leaves them
 * optional for a provider that cannot do them, and this one defines all three
 * (`reporting-provider.ts:43-51`, its `play`, `pause` and `mute`).
 */
const logCommands = (
  adapter: ProviderAdapter,
  commands: CommandLog
): ProviderAdapter => ({
  ...adapter,
  mute: async () => {
    commands.push('mute');
    return adapter.mute!();
  },
  pause: async () => {
    commands.push('pause');
    return adapter.pause!();
  },
  play: async () => {
    commands.push('play');
    return adapter.play!();
  }
});

/**
 * `useReportingProvider` (`reporting-provider.ts:67-86`) with a command log
 * wrapped around the adapter. Not that hook itself, because the log has to be
 * installed between the adapter and the controller, which is inside it.
 */
const useLoggingProvider = (commands: CommandLog) => {
  const handle = useRef<PlayerHandle>(null);
  useEffect(() => {
    const controller = handle.current as PlayerController | null;
    if (!controller) return;
    const provider = createReportingProvider();
    controller.setProvider(logCommands(provider.adapter, commands));
    provider.emit({
      activation: 'ready',
      capabilities: createInitialPlayerState().capabilities,
      lifecycle: 'ready',
      playback: 'paused',
      provider: 'native'
    });
    return () => controller.setProvider(undefined);
  }, [commands]);
  return handle;
};

const StagedAutoplayVideo = ({
  commands,
  ...props
}: BackpackAutoplayVideoProps & { readonly commands: CommandLog }) =>
  createElement(BackpackAutoplayVideo, {
    ...props,
    ref: useLoggingProvider(commands)
  });

/**
 * The composition over a provider that is already attached and ready, so every
 * transition below is autoplay or the wrapper's own machine and nothing else.
 * The `mock://` source keeps Reely's real loader out of it.
 */
const renderStaged = (overrides: Partial<BackpackAutoplayVideoProps> = {}) => {
  const commands: CommandLog = [];
  const onPlayChange = vi.fn<(isPlaying: boolean) => void>();
  let props: BackpackAutoplayVideoProps = {
    onPlayChange,
    url: 'mock://reely/unresolvable.mp4',
    ...overrides
  };
  const element = () =>
    createElement(StagedAutoplayVideo, { ...props, commands });
  const view = render(element());

  return {
    ...view,
    commands,
    /** The cover image's source, or `undefined` when no cover is on screen. */
    coverSrc: () =>
      view.container
        .querySelector('.ef-video-cover-image')
        ?.getAttribute('src') ?? undefined,
    /**
     * Settles the autoplay attempt, which is a chain of microtasks: the staged
     * `load()` resolves, `#synchronizeAutoplay` runs
     * (`packages/core/src/player-controller.ts:297-300`), and its `mute` and
     * `play` are each awaited.
     */
    flush: () => act(async () => {}),
    /** Every `onPlayChange` the wrapper has reported, in order. */
    reported: () => onPlayChange.mock.calls.map(([isPlaying]) => isPlaying),
    /** Reports the player's viewport as on or off screen, as a scroll would. */
    scrollTo: (visible: boolean) => {
      act(() => {
        pauseObserver().emit(visible);
      });
    },
    /** The viewer clicking the wrapper's own play/pause toggle. */
    toggle: () => view.container.querySelector('.ef-video-controller')!,
    /** Feeds the wrapper a new set of props, as a parent re-render would. */
    setProps: (next: Partial<BackpackAutoplayVideoProps>) => {
      props = { ...props, ...next };
      view.rerender(element());
    }
  };
};

describe('BackpackAutoplayVideo', () => {
  beforeEach(installObserver);
  afterEach(() => {
    cleanup();
    restoreObserver();
  });

  // Criterion 1, on the half a staged provider can reach: nothing in this test
  // clicks anything, and playback starts. The `mute` in front of the `play` is
  // criterion 4 — an audible attempt would skip it
  // (`packages/core/src/player-controller.ts:663`) — and it is also what a
  // caller-supplied `muted: false` could no longer reach, since the prop is
  // gone from the type.
  it('plays muted with nothing clicked once the player is ready', async () => {
    const { commands, flush, reported } = renderStaged();

    await flush();

    // The autoplay attempt, whole: mute then play. A third command follows it —
    // the wrapper folding the player's own report back in and issuing the play
    // again, which it documents as a deliberate idempotent no-op
    // (`backpack-video.tsx:326-330`, the `useOnChange` that drives the player) —
    // and is left out of the assertion rather
    // than pinned here, so a future change to that echo fails its own test and
    // not this one.
    expect(commands.slice(0, 2)).toEqual(['mute', 'play']);
    expect(reported()).toEqual([true]);
  });

  // `playing: false` is Backpack's own escape hatch on its autoplay component
  // (`AutoplayVideo.tsx:10-14`), and it has to hold: an autoplay the caller
  // asked not to happen must not be configured on the root at all, rather than
  // being started and paused back.
  it('starts nothing while playing is false', async () => {
    const { commands, flush, reported } = renderStaged({ playing: false });

    await flush();

    expect(commands).toEqual([]);
    expect(reported()).toEqual([]);
  });

  // A video held paused still has to be startable by hand, and under the
  // viewport strategy the wrapper's own toggle is the only thing that can do it:
  // `Player.ActivationButton` renders nothing outside interaction loading
  // (`packages/react/src/loading-error.tsx:40`), so a surface that thought it
  // was waiting for activation would offer no click target at all.
  it('leaves the viewer a play control while playing is false', async () => {
    const { commands, flush, reported, toggle } = renderStaged({
      playing: false
    });
    await flush();

    expect(toggle().getAttribute('aria-label')).toBe('Play video');
    act(() => {
      fireEvent.click(toggle());
    });
    await flush();

    expect(commands).toEqual(['play']);
    expect(reported()).toEqual([true]);
  });

  it('starts the video when a parent flips playing to true', async () => {
    const { commands, flush, reported, setProps } = renderStaged({
      playing: false
    });
    await flush();

    setProps({ playing: true });
    await flush();

    expect(commands).toEqual(['play']);
    expect(reported()).toEqual([true]);
  });

  // Criterion 3. The cover comes off on the playback the *player* reports,
  // which is the only moment that means "autoplay started" — a cover removed
  // any earlier would uncover a still frame nothing had played yet.
  it('keeps the placeholder image up until autoplay starts', async () => {
    const { coverSrc, flush } = renderStaged({
      placeholderImageSrc: 'https://reely.dev/cover.jpg'
    });

    expect(coverSrc()).toBe('https://reely.dev/cover.jpg');
    await flush();

    expect(coverSrc()).toBeUndefined();
  });

  it('leaves the placeholder image up while playing is false', async () => {
    const { coverSrc, flush } = renderStaged({
      placeholderImageSrc: 'https://reely.dev/cover.jpg',
      playing: false
    });

    await flush();

    expect(coverSrc()).toBe('https://reely.dev/cover.jpg');
  });

  // Criterion 2, at the composition's own level: the behaviour is
  // `BackpackVideo`'s `pauseOnOutOfViewport`, already pinned in
  // `off-screen-pause.contract.test.ts`, and what this test adds is that the
  // composition leaves it switched on over an autoplaying video.
  it('pauses when it scrolls out of view and resumes when it comes back', async () => {
    const { flush, reported, scrollTo } = renderStaged();
    await flush();

    scrollTo(true);
    scrollTo(false);
    await flush();
    expect(reported()).toEqual([true, false]);

    scrollTo(true);
    await flush();

    expect(reported()).toEqual([true, false, true]);
  });

  // Backpack's spread order: `ef-autoplay-video` is `cn`'s first argument and
  // the caller's `className` its second (`AutoplayVideo.tsx:28`).
  it('composes its own class ahead of the caller’s', () => {
    const { container } = renderStaged({ className: 'story-video' });

    expect(container.querySelector('.ef-video-player')!.className).toBe(
      'ef-video-player ef-autoplay-video story-video'
    );
  });
});

/**
 * The other half of criterion 1: *when* the player loads, and that no click is
 * required to get there. Observed through Reely's own activation observer,
 * because that observer existing at all is what `loading: 'viewport'` means —
 * `eager` activates from an effect (`use-activation.ts:299-315`) and
 * `interaction` waits for `Player.ActivationButton`, and neither constructs
 * one. An `http(s)` source is needed for the observer to be reached at all
 * (`:330-336`), and no intersection is ever reported, so nothing loads and the
 * network stays out of it.
 */
describe('BackpackAutoplayVideo viewport activation', () => {
  beforeEach(installObserver);
  afterEach(() => {
    cleanup();
    restoreObserver();
  });

  it('waits for the player box to scroll into view, with no preload margin', () => {
    const view = render(
      createElement(BackpackAutoplayVideo, {
        url: 'https://reely.dev/autoplay.mp4'
      })
    );
    const box = view.container.querySelector('.ef-video-player');

    expect(activationObservers()).toHaveLength(1);
    // No margin, where `Player.Root` defaults to `'200px 0px'`
    // (`packages/react/src/root.tsx:91`): activation is what starts playback
    // here, since the provider autoplays as soon as it is ready, so a margin
    // that loads early would also play early — off screen, which is the flaw
    // this composition exists to avoid.
    expect(activationObservers()[0]!.init).toEqual({ rootMargin: '0px' });
    expect(activationObservers()[0]!.observe).toHaveBeenCalledWith(box);
    // Nothing to click, and nothing that would need clicking.
    expect(view.container.querySelector('[data-reely-part="activation"]')).toBe(
      null
    );
  });

  // Exactly two observers per video: this one and the off-screen-pause hook's.
  // A wrapper-level observer of its own would be a third answer to the same
  // question, free to disagree with both.
  it('adds no observer of its own', () => {
    render(
      createElement(BackpackAutoplayVideo, {
        url: 'https://reely.dev/autoplay.mp4'
      })
    );

    expect(ControlledIntersectionObserver.instances).toHaveLength(2);
  });

  // The seam this composition needed is off by default, so every existing
  // `BackpackVideo` caller keeps the strategy it had: no activation observer,
  // and a button that loads the provider on the first click.
  it('leaves BackpackVideo loading on interaction', () => {
    const view = render(
      createElement(BackpackVideo, { url: 'https://reely.dev/autoplay.mp4' })
    );

    expect(activationObservers()).toEqual([]);
    expect(
      view.container.querySelector('[data-reely-part="activation"]')
    ).not.toBe(null);
  });

  // And it is not merely off by default but unreachable on that name, which is
  // what makes `autoplayOnViewportEntry` internal rather than just described as
  // internal. Both halves of the barrier are here, because the comment claiming
  // one used to be the whole of it: the compiler refuses the prop, and
  // `BackpackVideo` forces it off after its own spread so a caller who defeats
  // the compiler gets the interaction strategy anyway
  // (`backpack-video.tsx`'s `BackpackVideo`).
  it('refuses the internal loading-strategy prop on the public component', () => {
    const view = render(
      createElement(BackpackVideo, {
        url: 'https://reely.dev/autoplay.mp4',
        // @ts-expect-error `autoplayOnViewportEntry` is no part of
        // `BackpackVideoProps`. This line failing to error is itself the
        // regression — `tsc -b` covers this file, so removing the barrier fails
        // the typecheck here rather than going unnoticed.
        autoplayOnViewportEntry: true
      })
    );

    // The runtime half: the prop arrived and changed nothing, so this is still
    // an interaction-loading player.
    expect(activationObservers()).toEqual([]);
    expect(
      view.container.querySelector('[data-reely-part="activation"]')
    ).not.toBe(null);
  });
});
