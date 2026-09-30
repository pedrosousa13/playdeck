// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen
} from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  type Availability,
  type CommandResult,
  type PlayerCapabilities,
  type PlayerEventOrigin,
  type ProviderAdapter,
  type ProviderEvent,
  type ProviderStateListener,
  type ProviderStatePatch
} from '@playdeck/core';
import {
  INTERNAL_CONTROLLER,
  type InternalControllerAccess
} from '../src/internal-controller';
import * as Player from '../src/index';

const ok = async (): Promise<CommandResult> => ({ ok: true });

const available: Availability = { status: 'available' };
const unavailable: Availability = { status: 'unavailable', reason: 'provider' };

const allNotReady = (): PlayerCapabilities => ({
  seek: { status: 'unknown', reason: 'not-ready' },
  setVolume: { status: 'unknown', reason: 'not-ready' },
  setPlaybackRate: { status: 'unknown', reason: 'not-ready' },
  selectQuality: { status: 'unknown', reason: 'not-ready' },
  selectQualityAuto: { status: 'unknown', reason: 'not-ready' },
  selectTextTrack: { status: 'unknown', reason: 'not-ready' },
  selectAudioTrack: { status: 'unknown', reason: 'not-ready' },
  chapters: { status: 'unknown', reason: 'not-ready' },
  liveEdge: { status: 'unknown', reason: 'not-ready' },
  fullscreen: { status: 'unknown', reason: 'not-ready' },
  pictureInPicture: { status: 'unknown', reason: 'not-ready' },
  airPlay: { status: 'unknown', reason: 'not-ready' },
  customControls: { status: 'unknown', reason: 'not-ready' },
  providerPoster: { status: 'unknown', reason: 'not-ready' },
  remotePlayback: { status: 'unknown', reason: 'not-ready' }
});

// Matches renderGestures' own default patch (no capabilities override),
// but named explicitly so a seek-capable test's intent doesn't ride on
// that default silently.
const withSeekCapability = (seek: Availability): ProviderStatePatch => ({
  capabilities: { ...allNotReady(), seek }
});

const createMockAdapter = () => {
  const listeners = new Set<ProviderStateListener>();
  const spies = {
    play: vi.fn(ok),
    pause: vi.fn(ok),
    seekTo: vi.fn(ok),
    seekBy: vi.fn(ok),
    mute: vi.fn(ok),
    unmute: vi.fn(ok),
    setVolume: vi.fn(ok),
    requestFullscreen: vi.fn(ok),
    exitFullscreen: vi.fn(ok),
    requestPictureInPicture: vi.fn(ok),
    exitPictureInPicture: vi.fn(ok)
  };
  const adapter: ProviderAdapter = {
    provider: 'native',
    attach: () => {},
    load: () => {},
    destroy: () => {},
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    ...spies
  };
  return {
    adapter,
    spies,
    emit: (patch: ProviderStatePatch, event?: ProviderEvent) =>
      listeners.forEach((l) => l(patch, event))
  };
};

const renderGestures = (ui: React.ReactNode, initial?: ProviderStatePatch) => {
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
    mock.emit({
      lifecycle: 'ready',
      activation: 'ready',
      provider: 'native',
      ...initial
    });
  });
  return {
    ...utils,
    controller,
    spies: mock.spies,
    emit: (patch: ProviderStatePatch, event?: ProviderEvent) =>
      act(() => mock.emit(patch, event))
  };
};

const mockLayerRect = (layer: Element) => {
  // width is mocked to 200 below; left half < 100, right half >= 100.
  Object.defineProperty(layer, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0,
      width: 200,
      right: 200,
      top: 0,
      height: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })
  });
};

// Fire a tap at a given clientX by dispatching pointerup on the gesture
// layer. `isPrimary` and `button` are set explicitly rather than left to
// happy-dom's own defaults -- happy-dom's PointerEvent defaults `isPrimary`
// to `false` (happy-dom 20.8.9; a real primary mouse or single-touch
// pointer is `true`), so leaving it out here would make every "ordinary
// tap" fixture in this file look like the multi-touch case the gesture
// layer is now supposed to ignore.
const tapAt = (
  layer: Element,
  clientX: number,
  overrides: Partial<PointerEventInit> = {}
) => {
  mockLayerRect(layer);
  fireEvent.pointerUp(layer, {
    clientX,
    clientY: 10,
    isPrimary: true,
    button: 0,
    ...overrides
  });
};

// Fire a pointerdown on the gesture layer. Only `isPrimary` varies across
// this file's multi-touch fixtures; position is irrelevant to pointerdown
// handling (only a tap's `pointerup` reads `clientX`).
const pointerDownAt = (
  layer: Element,
  overrides: Partial<PointerEventInit> = {}
) => {
  fireEvent.pointerDown(layer, {
    clientX: 150,
    clientY: 10,
    isPrimary: true,
    button: 0,
    ...overrides
  });
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
});

const getLayer = () =>
  document.querySelector('[data-playdeck-part="gestures"]') as HTMLElement;

describe('Gestures', () => {
  test('single tap toggles controls and never toggles playback', () => {
    const onToggle = vi.fn();
    const { spies } = renderGestures(
      <Player.Viewport>
        <Player.Gestures onToggleControls={onToggle} />
      </Player.Viewport>
    );
    tapAt(getLayer(), 150);
    act(() => vi.advanceTimersByTime(320)); // past the double-tap window
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(spies.play).not.toHaveBeenCalled();
    expect(spies.pause).not.toHaveBeenCalled();
    expect(spies.seekBy).not.toHaveBeenCalled();
  });

  test('double tap on the right half seeks forward by the offset', () => {
    const onSeek = vi.fn();
    const { spies } = renderGestures(
      <Player.Viewport>
        <Player.Gestures onSeek={onSeek} seekOffset={10} />
      </Player.Viewport>,
      withSeekCapability(available)
    );
    const layer = getLayer();
    tapAt(layer, 150);
    tapAt(layer, 150);
    expect(spies.seekBy).toHaveBeenCalledWith(10);
    expect(onSeek).toHaveBeenCalledWith('forward', 10);
  });

  // A double tap is a person seeking, exactly as a scrubber drag is, so the
  // seek it asks for carries the same origin (#186).
  test('labels a double-tap seek as a user seek', () => {
    const { controller, emit } = renderGestures(
      <Player.Viewport>
        <Player.Gestures seekOffset={10} />
      </Player.Viewport>,
      withSeekCapability(available)
    );
    const origins: PlayerEventOrigin[] = [];
    controller.on('seeking', (event) => origins.push(event.origin));
    controller.on('seeked', (event) => origins.push(event.origin));
    const layer = getLayer();

    tapAt(layer, 150);
    tapAt(layer, 150);
    emit(
      { seeking: true },
      { type: 'seeking', detail: { currentTime: 10 }, origin: 'provider' }
    );
    emit(
      { seeking: false, currentTime: 10 },
      { type: 'seeked', detail: { currentTime: 10 }, origin: 'provider' }
    );

    expect(origins).toEqual(['user', 'user']);
  });

  test('double tap on the left half seeks backward', () => {
    const { spies } = renderGestures(
      <Player.Viewport>
        <Player.Gestures seekOffset={10} />
      </Player.Viewport>,
      withSeekCapability(available)
    );
    const layer = getLayer();
    tapAt(layer, 40);
    tapAt(layer, 40);
    expect(spies.seekBy).toHaveBeenCalledWith(-10);
  });

  test('doubleTapSeek={false} disables seek but keeps the single-tap toggle', () => {
    const onToggle = vi.fn();
    const { spies } = renderGestures(
      <Player.Viewport>
        <Player.Gestures doubleTapSeek={false} onToggleControls={onToggle} />
      </Player.Viewport>
    );
    const layer = getLayer();
    tapAt(layer, 150);
    tapAt(layer, 150);
    act(() => vi.advanceTimersByTime(320));
    expect(spies.seekBy).not.toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  test('taps on interactive children are ignored', () => {
    const onToggle = vi.fn();
    renderGestures(
      <Player.Viewport>
        <Player.Gestures onToggleControls={onToggle}>
          <button type="button">child</button>
        </Player.Gestures>
      </Player.Viewport>
    );
    // isPrimary/button set explicitly (see tapAt's comment) so this proves
    // the control-target check itself, not the separate isPrimary guard.
    fireEvent.pointerUp(screen.getByRole('button', { name: 'child' }), {
      clientX: 10,
      clientY: 10,
      isPrimary: true,
      button: 0
    });
    act(() => vi.advanceTimersByTime(320));
    expect(onToggle).not.toHaveBeenCalled();
  });

  test('a pointerup on a native range input inside the gesture layer is ignored', () => {
    const onToggle = vi.fn();
    renderGestures(
      <Player.Viewport>
        <Player.Gestures onToggleControls={onToggle}>
          <input type="range" aria-label="seek" />
        </Player.Gestures>
      </Player.Viewport>
    );
    fireEvent.pointerUp(screen.getByRole('slider', { name: 'seek' }), {
      clientX: 10,
      clientY: 10,
      isPrimary: true,
      button: 0
    });
    act(() => vi.advanceTimersByTime(320));
    expect(onToggle).not.toHaveBeenCalled();
  });

  test("a second, non-primary pointer's pointerup does not seek and does not toggle controls", () => {
    const onToggle = vi.fn();
    const onSeek = vi.fn();
    const { spies } = renderGestures(
      <Player.Viewport>
        <Player.Gestures
          onSeek={onSeek}
          onToggleControls={onToggle}
          seekOffset={10}
        />
      </Player.Viewport>,
      withSeekCapability(available)
    );
    // A lone non-primary pointerup (a second touch point during a pinch)
    // must not even count as a first tap: unlike an ordinary single tap it
    // must never resolve into a toggle once the double-tap window elapses.
    tapAt(getLayer(), 150, { isPrimary: false });
    act(() => vi.advanceTimersByTime(320));
    expect(onToggle).not.toHaveBeenCalled();
    expect(spies.seekBy).not.toHaveBeenCalled();
    expect(onSeek).not.toHaveBeenCalled();
  });

  test('a non-primary pointerup between two primary taps does not consume or reset the pending tap', () => {
    const onToggle = vi.fn();
    const { spies } = renderGestures(
      <Player.Viewport>
        <Player.Gestures onToggleControls={onToggle} seekOffset={10} />
      </Player.Viewport>,
      withSeekCapability(available)
    );
    const layer = getLayer();
    tapAt(layer, 150); // primary tap 1: starts the pending-tap window
    tapAt(layer, 150, { isPrimary: false }); // second touch point: ignored
    tapAt(layer, 150); // primary tap 2: should complete the double tap
    act(() => vi.advanceTimersByTime(320));
    expect(spies.seekBy).toHaveBeenCalledTimes(1);
    expect(spies.seekBy).toHaveBeenCalledWith(10);
    // If the non-primary event had been treated as the second tap, this
    // primary tap would restart as a fresh first tap and resolve into a
    // toggle once the window above elapsed.
    expect(onToggle).not.toHaveBeenCalled();
  });

  test('a right-click pointerup does not toggle controls and does not count as a tap', () => {
    const onToggle = vi.fn();
    const onSeek = vi.fn();
    const { spies } = renderGestures(
      <Player.Viewport>
        <Player.Gestures
          onSeek={onSeek}
          onToggleControls={onToggle}
          seekOffset={10}
        />
      </Player.Viewport>,
      withSeekCapability(available)
    );
    tapAt(getLayer(), 150, { button: 2 });
    act(() => vi.advanceTimersByTime(320));
    expect(onToggle).not.toHaveBeenCalled();
    expect(spies.seekBy).not.toHaveBeenCalled();
    expect(onSeek).not.toHaveBeenCalled();
  });

  test('a right-click pointerup between two primary taps does not consume or reset the pending tap', () => {
    const onToggle = vi.fn();
    const { spies } = renderGestures(
      <Player.Viewport>
        <Player.Gestures onToggleControls={onToggle} seekOffset={10} />
      </Player.Viewport>,
      withSeekCapability(available)
    );
    const layer = getLayer();
    tapAt(layer, 150); // primary tap 1: starts the pending-tap window
    tapAt(layer, 150, { button: 2 }); // right-click: ignored
    tapAt(layer, 150); // primary tap 2: should complete the double tap
    act(() => vi.advanceTimersByTime(320));
    expect(spies.seekBy).toHaveBeenCalledTimes(1);
    expect(spies.seekBy).toHaveBeenCalledWith(10);
    expect(onToggle).not.toHaveBeenCalled();
  });

  test('a double tap while seeking is unavailable calls neither the seek command nor onSeek', () => {
    const onToggle = vi.fn();
    const onSeek = vi.fn();
    const { spies } = renderGestures(
      <Player.Viewport>
        <Player.Gestures
          onSeek={onSeek}
          onToggleControls={onToggle}
          seekOffset={10}
        />
      </Player.Viewport>,
      withSeekCapability(unavailable)
    );
    const layer = getLayer();
    tapAt(layer, 150);
    tapAt(layer, 150);
    act(() => vi.advanceTimersByTime(320));
    expect(spies.seekBy).not.toHaveBeenCalled();
    expect(onSeek).not.toHaveBeenCalled();
    // Deliberately not a single-tap toggle either: it was never a single
    // tap, and toggling controls in response to two taps on the video
    // would contradict what the same gesture does everywhere it can seek.
    expect(onToggle).not.toHaveBeenCalled();
  });

  test('a two-finger gesture where the secondary lifts first does not toggle controls or seek', () => {
    const onToggle = vi.fn();
    const { spies } = renderGestures(
      <Player.Viewport>
        <Player.Gestures onToggleControls={onToggle} seekOffset={10} />
      </Player.Viewport>,
      withSeekCapability(available)
    );
    const layer = getLayer();
    pointerDownAt(layer);
    pointerDownAt(layer, { isPrimary: false });
    fireEvent.pointerUp(layer, { clientX: 150, clientY: 10, isPrimary: false });
    tapAt(layer, 150); // the primary's own lift
    act(() => vi.advanceTimersByTime(320));
    expect(onToggle).not.toHaveBeenCalled();
    expect(spies.seekBy).not.toHaveBeenCalled();
  });

  test('a two-finger gesture where the primary lifts first does not toggle controls or seek', () => {
    const onToggle = vi.fn();
    const { spies } = renderGestures(
      <Player.Viewport>
        <Player.Gestures onToggleControls={onToggle} seekOffset={10} />
      </Player.Viewport>,
      withSeekCapability(available)
    );
    const layer = getLayer();
    pointerDownAt(layer);
    pointerDownAt(layer, { isPrimary: false });
    tapAt(layer, 150); // the primary lifts first
    fireEvent.pointerUp(layer, { clientX: 150, clientY: 10, isPrimary: false });
    act(() => vi.advanceTimersByTime(320));
    expect(onToggle).not.toHaveBeenCalled();
    expect(spies.seekBy).not.toHaveBeenCalled();
  });

  test('an ordinary tap after a multi-touch gesture still toggles controls', () => {
    const onToggle = vi.fn();
    const { spies } = renderGestures(
      <Player.Viewport>
        <Player.Gestures onToggleControls={onToggle} seekOffset={10} />
      </Player.Viewport>,
      withSeekCapability(available)
    );
    const layer = getLayer();
    pointerDownAt(layer);
    pointerDownAt(layer, { isPrimary: false });
    tapAt(layer, 150);
    fireEvent.pointerUp(layer, { clientX: 150, clientY: 10, isPrimary: false });

    pointerDownAt(layer);
    tapAt(layer, 150);
    act(() => vi.advanceTimersByTime(320));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(spies.seekBy).not.toHaveBeenCalled();
  });

  // A primary pointerup can reach the layer with no primary pointerdown on
  // it first -- a mouse press that started outside the layer and released
  // inside, or a pointer captured elsewhere. The multi-touch record must not
  // survive past the gesture's own primary lift waiting for a pointerdown
  // that may never come.
  test('an ordinary tap with no preceding pointerdown still toggles controls after a multi-touch gesture', () => {
    const onToggle = vi.fn();
    const { spies } = renderGestures(
      <Player.Viewport>
        <Player.Gestures onToggleControls={onToggle} seekOffset={10} />
      </Player.Viewport>,
      withSeekCapability(available)
    );
    const layer = getLayer();
    pointerDownAt(layer);
    pointerDownAt(layer, { isPrimary: false });
    fireEvent.pointerUp(layer, { clientX: 150, clientY: 10, isPrimary: false });
    tapAt(layer, 150); // the pinch's own primary lift, ignored

    tapAt(layer, 150); // a primary pointerup with no preceding pointerdown
    act(() => vi.advanceTimersByTime(320));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(spies.seekBy).not.toHaveBeenCalled();
  });

  test('an ordinary double tap after a multi-touch gesture still seeks', () => {
    const onToggle = vi.fn();
    const { spies } = renderGestures(
      <Player.Viewport>
        <Player.Gestures onToggleControls={onToggle} seekOffset={10} />
      </Player.Viewport>,
      withSeekCapability(available)
    );
    const layer = getLayer();
    pointerDownAt(layer);
    pointerDownAt(layer, { isPrimary: false });
    tapAt(layer, 150);
    fireEvent.pointerUp(layer, { clientX: 150, clientY: 10, isPrimary: false });
    // Flush the window before the ordinary double tap below: nothing from
    // the gesture above should have been pending, so this must not resolve
    // into a toggle. Without this, a stray pending tap left over by the
    // gesture could pair up with the first tap below by coincidence and
    // still produce a `seekBy(10)` call for the wrong reason.
    act(() => vi.advanceTimersByTime(320));
    expect(onToggle).not.toHaveBeenCalled();

    pointerDownAt(layer);
    tapAt(layer, 150);
    pointerDownAt(layer);
    tapAt(layer, 150);

    expect(spies.seekBy).toHaveBeenCalledWith(10);
  });

  test('a genuine single tap followed within the window by a two-finger gesture resolves as a single tap, not a double-tap seek', () => {
    const onToggle = vi.fn();
    const { spies } = renderGestures(
      <Player.Viewport>
        <Player.Gestures onToggleControls={onToggle} seekOffset={10} />
      </Player.Viewport>,
      withSeekCapability(available)
    );
    const layer = getLayer();
    tapAt(layer, 150); // genuine tap 1: starts the pending-tap window
    pointerDownAt(layer); // the two-finger gesture's primary pointer
    pointerDownAt(layer, { isPrimary: false });
    tapAt(layer, 150); // the primary's lift is ignored, not a second tap
    fireEvent.pointerUp(layer, { clientX: 150, clientY: 10, isPrimary: false });
    act(() => vi.advanceTimersByTime(320));

    expect(spies.seekBy).not.toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  // Guard: Gestures has never listened for pointercancel, in either the
  // unfixed or the fixed code, so a cancelled primary pointer already left
  // nothing pending. This passes unfixed -- it demonstrates that the next
  // primary pointerdown's reset is enough, without a dedicated cancel
  // handler.
  test('a pointercancel on the primary pointer during a multi-touch gesture is a no-op (guard)', () => {
    const onToggle = vi.fn();
    const { spies } = renderGestures(
      <Player.Viewport>
        <Player.Gestures onToggleControls={onToggle} seekOffset={10} />
      </Player.Viewport>,
      withSeekCapability(available)
    );
    const layer = getLayer();
    pointerDownAt(layer);
    pointerDownAt(layer, { isPrimary: false });
    fireEvent.pointerCancel(layer, {
      clientX: 150,
      clientY: 10,
      isPrimary: true
    });
    act(() => vi.advanceTimersByTime(320));

    expect(onToggle).not.toHaveBeenCalled();
    expect(spies.seekBy).not.toHaveBeenCalled();
  });

  test('forwards an object ref to the gesture layer element', () => {
    const ref = createRef<HTMLDivElement>();
    renderGestures(
      <Player.Viewport>
        <Player.Gestures ref={ref} />
      </Player.Viewport>
    );
    expect(ref.current).toBe(getLayer());
  });

  test('forwards a callback ref to the gesture layer element, and null on unmount', () => {
    const consumerRef = vi.fn();
    const { unmount } = renderGestures(
      <Player.Viewport>
        <Player.Gestures ref={consumerRef} />
      </Player.Viewport>
    );
    const layer = getLayer();
    expect(consumerRef).toHaveBeenCalledExactlyOnceWith(layer);

    unmount();

    expect(consumerRef).toHaveBeenCalledTimes(2);
    expect(consumerRef.mock.calls[1][0]).toBeNull();
  });

  // React 19 runs a callback ref's own returned cleanup on detach instead of
  // calling the callback again with `null` -- so a naive merge that just
  // returns that cleanup upward never sees a `null` call itself, either.
  test('respects a callback ref that returns its own cleanup, and does not call it again with null', () => {
    const cleanup = vi.fn();
    const consumerRef = vi.fn(() => cleanup);
    const { unmount } = renderGestures(
      <Player.Viewport>
        <Player.Gestures ref={consumerRef} />
      </Player.Viewport>
    );
    expect(consumerRef).toHaveBeenCalledExactlyOnceWith(getLayer());

    unmount();

    expect(cleanup).toHaveBeenCalledOnce();
    expect(consumerRef).toHaveBeenCalledOnce();
  });
});
