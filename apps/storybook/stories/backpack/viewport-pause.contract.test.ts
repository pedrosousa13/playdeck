import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook
} from '@testing-library/react';
import { createElement, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackpackVideo, type BackpackVideoProps } from './backpack-video';
import { useViewportPause, type ViewportPauseOptions } from './viewport-pause';

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
const renderViewportPause = (overrides: Partial<ViewportPauseOptions> = {}) => {
  let props: ViewportPauseOptions = {
    controlledPaused: false,
    isPlaying: true,
    pauseOnOutOfViewport: true,
    startedPlaying: true,
    ...overrides
  };
  /** Every intent the wrapper would have folded into `requestPlayback`. */
  const requests: boolean[] = [];
  const view = renderHook(() => {
    const viewport = useViewportPause(props);
    // The fold `BackpackVideoSurface` performs on a changed value
    // (`backpack-video.tsx:69-74,167-182`): identity is the signal, so a new
    // intent object is a new request, and re-rendering the same one is not.
    const applied = useRef(viewport.intent);
    if (applied.current !== viewport.intent) {
      applied.current = viewport.intent;
      requests.push(viewport.intent.playing);
    }
    return viewport;
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
    update: (next: Partial<ViewportPauseOptions>) => {
      props = { ...props, ...next };
      act(() => {
        view.rerender();
      });
    }
  };
};

describe('useViewportPause', () => {
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
    const { requests, scrollTo } = renderViewportPause();

    scrollTo(true);
    scrollTo(false);

    expect(requests).toEqual([false]);
  });

  it('resumes the video it paused when it scrolls back in', () => {
    const { requests, scrollTo, update } = renderViewportPause();

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
    const { node, observer, requests } = renderViewportPause();

    expect(observer().observe).toHaveBeenCalledWith(node);
    expect(requests).toEqual([]);
  });

  // `startedPlaying` (`useVideoPlayerState.ts:145`). The wrapper's machine
  // cannot currently produce playing-but-never-started — `requestPlayback(true)`
  // sets both (`backpack-video.tsx:170-173`) — but the guard is Backpack's, and
  // it is what keeps a video the viewer never touched out of the picture.
  it('leaves a video that never started playing alone', () => {
    const { requests, scrollTo } = renderViewportPause({
      startedPlaying: false
    });

    scrollTo(true);
    scrollTo(false);

    expect(requests).toEqual([]);
  });

  it('requests nothing while pauseOnOutOfViewport is false', () => {
    const { requests, scrollTo, update } = renderViewportPause({
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
  it('does not resume a video that was already paused when it left the viewport', () => {
    const { requests, scrollTo } = renderViewportPause({ isPlaying: false });

    scrollTo(true);
    scrollTo(false);
    scrollTo(true);

    expect(requests).toEqual([]);
  });

  // Second half: Backpack clears the flag from `start` and `toggle`
  // (`useVideoPlayerState.ts:167,174`) so a hand-paused video stays paused.
  it('does not resume after cancelResume, so a hand-paused video stays paused', () => {
    const { requests, result, scrollTo, update } = renderViewportPause();

    scrollTo(true);
    scrollTo(false);
    update({ isPlaying: false });
    act(() => {
      result.current.cancelResume();
    });
    scrollTo(true);

    expect(requests).toEqual([false]);
  });

  // The hazard Backpack's "Why isPlayingRef exists" describes
  // (`useVideoPlayerState.ts:40-45`): live playback must not be a dependency of
  // the decision, or starting a video while it is off screen re-runs it and
  // pauses what the viewer just started.
  it('leaves playback it did not ask for alone while the video is out of view', () => {
    const { requests, result, scrollTo, update } = renderViewportPause();

    scrollTo(true);
    scrollTo(false);
    update({ isPlaying: false });
    // The viewer plays the off-screen video, which reaches the hook the way
    // any click does: `cancelResume`, then the wrapper's new `isPlaying`.
    act(() => {
      result.current.cancelResume();
    });
    update({ isPlaying: true });
    scrollTo(true);

    expect(requests).toEqual([false]);
  });

  // `requestPlayUnlessControlledPaused` (`useVideoPlayerState.ts:117-124`):
  // an explicit `playing={false}` outranks a scroll-back-in.
  it('keeps the video paused on scroll-back while an explicit pause is in force', () => {
    const { requests, scrollTo, update } = renderViewportPause();

    scrollTo(true);
    scrollTo(false);
    update({ controlledPaused: true, isPlaying: false });
    scrollTo(true);

    expect(requests).toEqual([false, false]);
  });

  it('passes threshold and root to the observer', () => {
    const root = document.createElement('div');
    const { observer } = renderViewportPause({ root, threshold: 0.5 });

    expect(observer().init).toEqual({ root, threshold: 0.5 });
  });

  it('re-observes with a new observer when the threshold changes', () => {
    const { node, observers, update } = renderViewportPause({ threshold: 0 });

    update({ threshold: 0.75 });

    expect(observers()).toHaveLength(2);
    expect(observers()[0]!.disconnect).toHaveBeenCalled();
    expect(observers()[1]!.init.threshold).toBe(0.75);
    expect(observers()[1]!.observe).toHaveBeenCalledWith(node);
  });

  it('re-observes with a new observer when the root changes', () => {
    const { node, observers, update } = renderViewportPause();
    const root = document.createElement('div');

    update({ root });

    expect(observers()).toHaveLength(2);
    expect(observers()[0]!.disconnect).toHaveBeenCalled();
    expect(observers()[1]!.init.root).toBe(root);
    expect(observers()[1]!.observe).toHaveBeenCalledWith(node);
  });

  it('disconnects the observer on unmount', () => {
    const { observer, unmount } = renderViewportPause();

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
 * surface from the first render: it loads eagerly (`backpack-video.tsx:320`),
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
 * `onPlayChange` like any other transition; that both click handlers cancel a
 * pending resume; that `controlledPaused` is the wrapper's `playing === false`;
 * and that the ref lands on `Player.Viewport`'s node with the three props'
 * values. Kept here rather than in a story because `Backpack parity/Video`'s
 * scroll stories belong to the same issue's next task.
 */
describe('BackpackVideo viewport pause', () => {
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

  // The toggle is Backpack's `toggle`, which drops the pending auto-resume
  // (`useVideoPlayerState.ts:174`).
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
