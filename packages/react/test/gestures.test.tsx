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
  type CommandResult,
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

const renderGestures = (ui: React.ReactNode) => {
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
    mock.emit({ lifecycle: 'ready', activation: 'ready', provider: 'native' });
  });
  return {
    ...utils,
    controller,
    spies: mock.spies,
    emit: (patch: ProviderStatePatch, event?: ProviderEvent) =>
      act(() => mock.emit(patch, event))
  };
};

// Fire a tap at a given clientX by dispatching pointerup on the gesture layer.
const tapAt = (layer: Element, clientX: number) => {
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
  fireEvent.pointerUp(layer, { clientX, clientY: 10 });
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
      </Player.Viewport>
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
      </Player.Viewport>
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
      </Player.Viewport>
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
    fireEvent.pointerUp(screen.getByRole('button', { name: 'child' }), {
      clientX: 10,
      clientY: 10
    });
    act(() => vi.advanceTimersByTime(320));
    expect(onToggle).not.toHaveBeenCalled();
  });
});
