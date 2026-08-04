import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook
} from '@testing-library/react';
import { createElement, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackpackVideo, type BackpackVideoProps } from './backpack-video';
import {
  useOffScreenPause,
  type OffScreenPauseOptions
} from './off-screen-pause';
import { useReportingProvider } from './reporting-provider';

/**
 * A controllable `IntersectionObserver`, copied from
 * `packages/react/test/activation.test.tsx:29-71` and extended so a test can
 * report a *non*-intersecting entry too — scrolling out is half of what this
 * hook does. `init` is kept verbatim so a test can assert what the hook asked
 * the browser for, rather than what the normalised `root`/`thresholds`
 * properties make of it.
 */
class ControlledIntersectionObserver implements IntersectionObserver {
  static instances: ControlledIntersectionObserver[] = [];
  readonly init: IntersectionObserverInit;
  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly scrollMargin = '0px';
  readonly thresholds: ReadonlyArray<number>;
  private readonly callback: IntersectionObserverCallback;
  private target?: Element;

  constructor(
    callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {}
  ) {
    this.callback = callback;
    this.init = options;
    this.root = options.root ?? null;
    this.rootMargin = options.rootMargin ?? '0px';
    this.thresholds =
      typeof options.threshold === 'number'
        ? [options.threshold]
        : (options.threshold ?? [0]);
    ControlledIntersectionObserver.instances.push(this);
  }

  disconnect = vi.fn();
  observe = vi.fn((target: Element) => {
    this.target = target;
  });
  takeRecords = () => [];
  unobserve = vi.fn();

  /** Reports the observed target as intersecting or not, as a scroll would. */
  emit(isIntersecting: boolean) {
    const target = this.target!;
    this.callback(
      [
        {
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRatio: isIntersecting ? 1 : 0,
          intersectionRect: target.getBoundingClientRect(),
          isIntersecting,
          rootBounds: null,
          target,
          time: 0
        }
      ],
      this
    );
  }
}

const originalIntersectionObserver = globalThis.IntersectionObserver;

/** The observer in use, whichever hook or component mounted it. */
const latestObserver = (): ControlledIntersectionObserver => {
  const { instances } = ControlledIntersectionObserver;
  return instances[instances.length - 1]!;
};

/**
 * Mounts the hook with the wrapper's values for a video the viewer has just
 * started — playing, started, pausing enabled, no explicit `playing={false}` —
 * and attaches a node, since a hook with no node to observe can do nothing.
 */
const renderOffScreenPause = (
  overrides: Partial<OffScreenPauseOptions> = {}
) => {
  let props: OffScreenPauseOptions = {
    controlledPaused: false,
    isPlaying: true,
    pauseOnOutOfViewport: true,
    startedPlaying: true,
    ...overrides
  };
  /** Every intent the wrapper would have folded into `requestPlayback`. */
  const requests: boolean[] = [];
  const view = renderHook(() => {
    const offScreen = useOffScreenPause(props);
    // The fold `BackpackVideoSurface` performs on a changed value
    // (`backpack-video.tsx:81-86,223-236`): identity is the signal, so a new
    // intent object is a new request, and re-rendering the same one is not.
    const applied = useRef(offScreen.intent);
    if (applied.current !== offScreen.intent) {
      applied.current = offScreen.intent;
      requests.push(offScreen.intent.playing);
    }
    return offScreen;
  });
  const node = document.createElement('div');
  act(() => {
    view.result.current.ref(node);
  });
  const observers = () => ControlledIntersectionObserver.instances;

  return {
    ...view,
    node,
    observers,
    requests,
    /** The observer the hook is currently using. */
    observer: () => observers()[observers().length - 1]!,
    /** Reports the node as intersecting or not, the way a scroll would. */
    scrollTo: (visible: boolean) => {
      const observer = observers()[observers().length - 1]!;
      act(() => {
        observer.emit(visible);
      });
    },
    /** Feeds the hook the wrapper's next set of values. */
    update: (next: Partial<OffScreenPauseOptions>) => {
      props = { ...props, ...next };
      act(() => {
        view.rerender();
      });
    }
  };
};

describe('useOffScreenPause', () => {
  beforeEach(() => {
    ControlledIntersectionObserver.instances = [];
    globalThis.IntersectionObserver =
      ControlledIntersectionObserver as unknown as typeof globalThis.IntersectionObserver;
  });

  afterEach(() => {
    cleanup();
    globalThis.IntersectionObserver = originalIntersectionObserver;
  });

  it('pauses a playing video when it scrolls out of view', () => {
    const { requests, scrollTo } = renderOffScreenPause();

    scrollTo(true);
    scrollTo(false);

    expect(requests).toEqual([false]);
  });

  it('resumes the video it paused when it scrolls back in', () => {
    const { requests, scrollTo, update } = renderOffScreenPause();

    scrollTo(true);
    scrollTo(false);
    // The wrapper applied the pause, so the hook's next input says paused.
    update({ isPlaying: false });
    scrollTo(true);

    expect(requests).toEqual([false, true]);
  });

  // `hasObserverEntry` (`useVideoPlayerState.ts:145`): with no entry yet there
  // is no evidence the video is off screen, and treating that as "not visible"
  // pauses an autoplaying video before it has ever rendered.
  it('requests nothing before the observer reports its first entry', () => {
    const { node, observer, requests } = renderOffScreenPause();

    expect(observer().observe).toHaveBeenCalledWith(node);
    expect(requests).toEqual([]);
  });

  // `startedPlaying` is what keeps a video nobody has ever played out of the
  // behaviour entirely: with no playback to preserve there is nothing to pause
  // and nothing to come back to, and a hook that acted anyway would be deciding
  // playback rather than restoring it. The wrapper's machine cannot currently
  // produce playing-but-never-started — `requestPlayback(true)` sets both
  // (`backpack-video.tsx:214-217`) — so the guard is pinned here rather than
  // reachable from outside. Backpack's is at `useVideoPlayerState.ts:145`.
  it('leaves a video that never started playing alone', () => {
    const { requests, scrollTo } = renderOffScreenPause({
      startedPlaying: false
    });

    scrollTo(true);
    scrollTo(false);

    expect(requests).toEqual([]);
  });

  it('requests nothing while pauseOnOutOfViewport is false', () => {
    const { requests, scrollTo, update } = renderOffScreenPause({
      pauseOnOutOfViewport: false
    });

    scrollTo(true);
    scrollTo(false);
    update({ isPlaying: false });
    scrollTo(true);

    expect(requests).toEqual([]);
  });

  // First half of `wasPlayingBeforeOutOfView`
  // (`useVideoPlayerState.ts:147,150-151`): the flag is only ever set by a
  // pause this hook performed, so a video that was already paused when it left
  // has nothing to come back to.
  it('does not resume a video that was already paused when it went off screen', () => {
    const { requests, scrollTo } = renderOffScreenPause({ isPlaying: false });

    scrollTo(true);
    scrollTo(false);
    scrollTo(true);

    expect(requests).toEqual([]);
  });

  // Live playback must not be a dependency of the decision, or starting a video
  // while it is off screen re-runs it and pauses what the viewer just started.
  // Backpack describes the same hazard under "Why isPlayingRef exists"
  // (`useVideoPlayerState.ts:40-45`).
  it('leaves playback it did not ask for alone while the video is out of view', () => {
    const { requests, scrollTo, update } = renderOffScreenPause();

    scrollTo(true);
    scrollTo(false);
    update({ isPlaying: false });
    // The viewer plays the off-screen video.
    update({ isPlaying: true });
    scrollTo(true);

    expect(requests).toEqual([false]);
  });

  // The acceptance criterion, at the level the hook can enforce it on its own:
  // any transition the hook did not ask for is somebody else's instruction, and
  // it outranks a resume the hook was still holding. Nothing the wrapper could
  // call would cover it, because the pause need not come from a click handler at
  // all — under visible controls it arrives as a player report.
  it('drops the pending resume when playback stops for a reason it did not request', () => {
    const { requests, scrollTo, update } = renderOffScreenPause();

    scrollTo(true);
    scrollTo(false);
    // The hook's own pause, applied by the wrapper.
    update({ isPlaying: false });
    // The viewer plays the off-screen video, then pauses it again — neither
    // transition announced to the hook, which is what the player-report path
    // looks like from in here.
    update({ isPlaying: true });
    update({ isPlaying: false });
    scrollTo(true);

    expect(requests).toEqual([false]);
  });

  // The same hazard, for the controlled pause rather than for playback:
  // Backpack reads `playing` out of the decision effect's closure and does not
  // declare it (`useVideoPlayerState.ts:118,154`), so lifting an explicit pause
  // does not re-run the decision over an off-screen video.
  it('leaves an off-screen video alone when the parent lifts an explicit pause', () => {
    const { requests, scrollTo, update } = renderOffScreenPause();

    scrollTo(true);
    scrollTo(false);
    // The parent sets `playing={false}` over the video this hook just paused.
    update({ controlledPaused: true, isPlaying: false });
    // Then flips it back to `true`. The wrapper applies the prop during the
    // same render (`backpack-video.tsx:236`), so playback is live again while
    // the video is still off screen — and the hook must not undo it.
    update({ controlledPaused: false, isPlaying: true });

    expect(requests).toEqual([false]);
  });

  // `requestPlayUnlessControlledPaused` (`useVideoPlayerState.ts:117-124`):
  // an explicit `playing={false}` outranks a scroll-back-in.
  it('keeps the video paused on scroll-back while an explicit pause is in force', () => {
    const { requests, scrollTo, update } = renderOffScreenPause();

    scrollTo(true);
    scrollTo(false);
    update({ controlledPaused: true, isPlaying: false });
    scrollTo(true);

    expect(requests).toEqual([false, false]);
  });

  it('passes threshold and root to the observer', () => {
    const root = document.createElement('div');
    const { observer } = renderOffScreenPause({ root, threshold: 0.5 });

    expect(observer().init).toEqual({ root, threshold: 0.5 });
  });

  it('re-observes with a new observer when the threshold changes', () => {
    const { node, observers, update } = renderOffScreenPause({ threshold: 0 });

    update({ threshold: 0.75 });

    expect(observers()).toHaveLength(2);
    expect(observers()[0]!.disconnect).toHaveBeenCalled();
    expect(observers()[1]!.init.threshold).toBe(0.75);
    expect(observers()[1]!.observe).toHaveBeenCalledWith(node);
  });

  it('re-observes with a new observer when the root changes', () => {
    const { node, observers, update } = renderOffScreenPause();
    const root = document.createElement('div');

    update({ root });

    expect(observers()).toHaveLength(2);
    expect(observers()[0]!.disconnect).toHaveBeenCalled();
    expect(observers()[1]!.init.root).toBe(root);
    expect(observers()[1]!.observe).toHaveBeenCalledWith(node);
  });

  it('disconnects the observer on unmount', () => {
    const { observer, unmount } = renderOffScreenPause();

    expect(observer().disconnect).not.toHaveBeenCalled();
    unmount();

    expect(observer().disconnect).toHaveBeenCalled();
  });
});

/**
 * Mounts the real wrapper with a player that can never attach, so every
 * transition below is the wrapper's own machine and nothing else.
 *
 * `playing: true` is what puts the wrapper's own play/pause toggle on the
 * surface from the first render: it loads eagerly (`backpack-video.tsx:385`),
 * so `awaitingActivation` is false and `Player.ActivationButton` renders
 * nothing (`packages/react/src/loading-error.tsx:41`). The `mock://` scheme
 * then fails Reely's source detection, so no provider ever attaches and
 * nothing confirms playback — the trick the `PlaybackRequestedButNeverStarted`
 * and `CoverClickRequestsPlayback` stories already use. Neither
 * `pauseOnOutOfViewport` nor `threshold` nor `intersectionObserverRoot` is
 * passed, so the defaults are under test too.
 */
const renderWrapper = (overrides: Partial<BackpackVideoProps> = {}) => {
  const onPlayChange = vi.fn<(isPlaying: boolean) => void>();
  let props: BackpackVideoProps = {
    muted: true,
    onPlayChange,
    playing: true,
    url: 'mock://reely/unresolvable.mp4',
    ...overrides
  };
  const view = render(createElement(BackpackVideo, props));

  return {
    ...view,
    observer: latestObserver,
    /** Every `onPlayChange` the wrapper has reported, in order. */
    reported: () => onPlayChange.mock.calls.map(([isPlaying]) => isPlaying),
    /** Feeds the wrapper a new set of props, as a parent re-render would. */
    setProps: (next: Partial<BackpackVideoProps>) => {
      props = { ...props, ...next };
      view.rerender(createElement(BackpackVideo, props));
    },
    /** Reports the player's viewport as on or off screen, as a scroll would. */
    scrollTo: (visible: boolean) => {
      act(() => {
        latestObserver().emit(visible);
      });
    },
    /** The viewer clicking the wrapper's own play/pause toggle. */
    toggle: () => {
      fireEvent.click(view.container.querySelector('.ef-video-controller')!);
    }
  };
};

/**
 * The wiring the hook's own tests cannot see: that its intent reaches
 * `requestPlayback`, so a scroll-driven pause is reported through
 * `onPlayChange` like any other transition; that a pause the viewer makes off
 * screen survives the scroll back in; that `controlledPaused` is the wrapper's
 * `playing === false`; and that the ref lands on `Player.Viewport`'s node with
 * the three props' values.
 *
 * Kept here rather than in a story because a browser story cannot pause a video
 * that is off screen — the automation driver scrolls its click target into view
 * first, undoing the scroll under test.
 */
describe('BackpackVideo off-screen pause', () => {
  beforeEach(() => {
    ControlledIntersectionObserver.instances = [];
    globalThis.IntersectionObserver =
      ControlledIntersectionObserver as unknown as typeof globalThis.IntersectionObserver;
  });

  afterEach(() => {
    cleanup();
    globalThis.IntersectionObserver = originalIntersectionObserver;
  });

  it('observes the player viewport with the props observer options', () => {
    const root = document.createElement('div');
    const { container, observer } = renderWrapper({
      intersectionObserverRoot: root,
      threshold: 0.5
    });

    expect(observer().init).toEqual({ root, threshold: 0.5 });
    expect(observer().observe).toHaveBeenCalledWith(
      container.querySelector('.ef-video-player')
    );
  });

  it("observes with Backpack's default observer options", () => {
    const { observer } = renderWrapper();

    expect(observer().init).toEqual({ root: null, threshold: 0 });
  });

  it('reports a scroll-driven pause and resume through onPlayChange', () => {
    const { reported, scrollTo, toggle } = renderWrapper();

    toggle();
    expect(reported()).toEqual([true]);

    scrollTo(true);
    scrollTo(false);
    expect(reported()).toEqual([true, false]);

    scrollTo(true);
    expect(reported()).toEqual([true, false, true]);
  });

  it('leaves the video alone on scroll while pauseOnOutOfViewport is false', () => {
    const { reported, scrollTo, toggle } = renderWrapper({
      pauseOnOutOfViewport: false
    });

    toggle();
    scrollTo(true);
    scrollTo(false);

    expect(reported()).toEqual([true]);
  });

  // The acceptance criterion on the wrapper's own toggle. The same sequence
  // through `Player.Controls` is at the bottom of this file, which is the path
  // that has no click handler on it at all.
  it('keeps a video the viewer paused off screen paused when it scrolls back', () => {
    const { reported, scrollTo, toggle } = renderWrapper();

    toggle();
    scrollTo(true);
    scrollTo(false);
    // The viewer plays the off-screen video and pauses it again by hand.
    toggle();
    toggle();
    scrollTo(true);

    expect(reported()).toEqual([true, false, true, false]);
  });

  // The wrapper's documented precedence, from the other side: `playing` is the
  // parent's last word, so a parent that lifts `playing={false}` over a video
  // this hook paused gets playback — the hook must not pause it straight
  // back. Backpack keeps this by leaving the controlled pause out of the
  // decision effect's dependencies (`useVideoPlayerState.ts:154`).
  it('keeps playing when the parent lifts playing={false} off screen', () => {
    const { reported, scrollTo, setProps, toggle } = renderWrapper();

    toggle();
    scrollTo(true);
    scrollTo(false);
    setProps({ playing: false });
    setProps({ playing: true });

    expect(reported()).toEqual([true, false, true]);
  });

  // `controlledPaused`, which the wrapper answers with its own `playing` prop.
  it('keeps the video paused on scroll-back while playing is false', () => {
    const { reported, scrollTo, setProps, toggle } = renderWrapper();

    toggle();
    scrollTo(true);
    scrollTo(false);
    setProps({ playing: false });
    scrollTo(true);

    expect(reported()).toEqual([true, false]);
  });
});

const StagedVideo = (props: BackpackVideoProps) =>
  // Returned straight from the hook rather than held in a local, which is what
  // `react-hooks/refs` asks for: a ref that never becomes a value in this
  // scope cannot be read during render. `MockedBackpackVideo` does the same
  // with `useMockPlayer` (`backpack-video.stories.tsx:195`).
  createElement(BackpackVideo, { ...props, ref: useReportingProvider() });

/**
 * The acceptance criterion end to end, on the path that has no click handler on
 * it: under visible controls every play and pause the viewer makes reaches the
 * wrapper as a player report, so nothing along the way can announce "the viewer
 * did this" — only the hook's own record of what it asked for can tell the two
 * apart.
 */
describe('BackpackVideo off-screen pause under visible controls', () => {
  beforeEach(() => {
    ControlledIntersectionObserver.instances = [];
    globalThis.IntersectionObserver =
      ControlledIntersectionObserver as unknown as typeof globalThis.IntersectionObserver;
  });

  afterEach(() => {
    cleanup();
    globalThis.IntersectionObserver = originalIntersectionObserver;
  });

  it('keeps a video the viewer paused off screen through the controls paused when it scrolls back', () => {
    const onPlayChange = vi.fn<(isPlaying: boolean) => void>();
    const view = render(
      createElement(StagedVideo, {
        controls: true,
        muted: true,
        onPlayChange,
        url: 'mock://reely/unresolvable.mp4'
      })
    );
    const reported = () => onPlayChange.mock.calls.map(([playing]) => playing);
    const playButton = view.container.querySelector(
      '[data-reely-part="play-button"]'
    )!;
    const press = () => {
      act(() => {
        fireEvent.click(playButton);
      });
    };
    const scrollTo = (visible: boolean) => {
      act(() => {
        latestObserver().emit(visible);
      });
    };

    press();
    expect(reported()).toEqual([true]);

    scrollTo(true);
    scrollTo(false);
    expect(reported()).toEqual([true, false]);

    // The viewer plays the off-screen video and pauses it again, both through
    // the player's own controls.
    press();
    press();
    expect(reported()).toEqual([true, false, true, false]);

    scrollTo(true);

    expect(reported()).toEqual([true, false, true, false]);
  });
});

/**
 * A controlled consumer: `playing` follows every state the wrapper reports.
 * `renderWrapper`'s `setProps` cannot stand in for it, because a rerender from
 * the test body lands in a commit of its own — where `onPlayChange` fires from
 * an effect (`backpack-video.tsx:247`) declared after the off-screen hook's
 * decision effect (`off-screen-pause.ts:235-258`, mounted at
 * `backpack-video.tsx:202`), so the prop this parent sets from it is batched
 * with the intent that effect raised and both reach the same render.
 *
 * `playing` starts `true` for the reason `renderWrapper` passes it: the root
 * then loads eagerly (`backpack-video.tsx:386`), so `awaitingActivation` is
 * false for the whole test and the wrapper's own toggle is the click target from
 * the first render.
 */
const MirroringVideo = ({ onPlayChange, ...rest }: BackpackVideoProps) => {
  const [playing, setPlaying] = useState(true);
  return createElement(BackpackVideo, {
    ...rest,
    onPlayChange: (next: boolean) => {
      setPlaying(next);
      onPlayChange?.(next);
    },
    playing
  });
};

/**
 * The fold order itself. `BackpackVideoSurface` applies three sources of
 * playback truth in a fixed sequence — what the player reports
 * (`backpack-video.tsx:224`), then the off-screen intent (`:234`), then the
 * `playing` prop (`:237`) — and each `requestPlayback` sets `isPlaying` during
 * render (`:215-218`), so within one render pass the last line to run is the one
 * whose value survives.
 *
 * Order is therefore invisible unless two sources change in the *same* render,
 * which is why every other test in this file passes with either adjacent pair
 * swapped. Both tests below stage that render by letting the second source
 * arrive from an effect of the commit the first one is applied in: the click
 * changes `isPlaying`, whose commit runs the decision effect (a `setIntent`) and
 * then, after it, `useOnChange(isPlaying)` — which issues the player command
 * (`:242-244`) and reports the new state to the parent (`:247`). Whatever those
 * two produce is batched into the render that also sees the new intent.
 *
 * Backpack states the same order from the top, as a comment rather than as
 * anything its own machine enforces (`useVideoPlayerState.ts:30-38`): the
 * `playing` prop first, the `IntersectionObserver` last.
 */
describe('BackpackVideo playback source precedence', () => {
  beforeEach(() => {
    ControlledIntersectionObserver.instances = [];
    globalThis.IntersectionObserver =
      ControlledIntersectionObserver as unknown as typeof globalThis.IntersectionObserver;
  });

  afterEach(() => {
    cleanup();
    globalThis.IntersectionObserver = originalIntersectionObserver;
  });

  // The hazard `backpack-video.tsx:228-233` describes in full: the report says
  // what playback already was, where the intent says what it should be now, and
  // the hook raises each intent once (`off-screen-pause.ts:242-245`) — so a
  // report that won here would swallow the pause with nothing left to raise it
  // again, and the video would keep playing off screen.
  it('applies the off-screen pause over the player report that lands with it', () => {
    const onPlayChange = vi.fn<(isPlaying: boolean) => void>();
    const view = render(
      createElement(StagedVideo, {
        muted: true,
        onPlayChange,
        url: 'mock://reely/unresolvable.mp4'
      })
    );
    const reported = () => onPlayChange.mock.calls.map(([playing]) => playing);
    // Re-queried rather than held: the toggle only replaces
    // `Player.ActivationButton` once the staged provider reports ready, and both
    // carry the same class (`backpack-video.tsx:314,327`).
    const toggle = () => view.container.querySelector('.ef-video-controller')!;

    // The observer's first entry, on screen and with nothing played yet, so the
    // decision effect's `startedPlaying` guard stands down
    // (`off-screen-pause.ts:236`).
    act(() => {
      latestObserver().emit(true);
    });

    // One commit, two sources. The click is the only thing the test does to
    // playback; the player's report is what the commit's own effects produce,
    // because `actions.play()` reaches the staged provider's `play`, which
    // emits `playback: 'playing'` before it returns — a provider confirming the
    // play the viewer just started, arriving with the pause the same scroll
    // asked for.
    act(() => {
      fireEvent.click(toggle());
      latestObserver().emit(false);
    });

    expect(reported()).toEqual([true, false]);
    expect(toggle().getAttribute('aria-label')).toBe('Play video');
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
  });

  // The other half of the documented precedence: the parent's explicit value is
  // the last word, which is what lets a controlled consumer play a video that is
  // off screen at all. The two tests above named "when the parent lifts" cover
  // the case where the hook merely has to leave that playback alone; this is the
  // tie itself, where the prop and the intent disagree within one render.
  it('applies the playing prop over the off-screen intent that lands with it', () => {
    const onPlayChange = vi.fn<(isPlaying: boolean) => void>();
    const view = render(
      createElement(MirroringVideo, {
        muted: true,
        onPlayChange,
        url: 'mock://reely/unresolvable.mp4'
      })
    );
    const reported = () => onPlayChange.mock.calls.map(([playing]) => playing);
    const toggle = () => view.container.querySelector('.ef-video-controller')!;

    act(() => {
      latestObserver().emit(true);
    });

    // Played and paused by hand, which leaves the mirroring parent holding
    // `playing={false}` — the value the commit below then changes. Nothing here
    // is a conflict: each click is one source, in a commit of its own.
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(reported()).toEqual([true, false]);

    // One commit, two sources: the scroll takes the video off screen while the
    // click starts it, so the intent asks for a pause and the parent — mirroring
    // the play it was just told about — asks for `playing: true`, in the same
    // render. The `mock://` scheme fails Reely's source detection, as in
    // `renderWrapper` above, so no provider ever attaches and nothing reports
    // playback — the only two sources in this render are these.
    act(() => {
      fireEvent.click(toggle());
      latestObserver().emit(false);
    });

    expect(reported()).toEqual([true, false, true]);
    expect(toggle().getAttribute('aria-label')).toBe('Pause video');
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
  });
});
