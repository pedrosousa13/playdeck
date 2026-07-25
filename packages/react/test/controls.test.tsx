// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { createRef, type ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  type Availability,
  type CommandResult,
  PlayerController,
  type PlayerCapabilities,
  type ProviderAdapter,
  type ProviderStateListener,
  type ProviderStatePatch
} from '@reely/core';
import * as Player from '../src/index';

const available: Availability = { status: 'available' };
const notReady: Availability = { status: 'unknown', reason: 'not-ready' };
const unavailable: Availability = { status: 'unavailable', reason: 'provider' };

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
    exitPictureInPicture: vi.fn(ok),
    showAirPlayPicker: vi.fn(ok)
  };
  const adapter: ProviderAdapter = {
    provider: 'native',
    attach: () => {},
    load: () => {},
    destroy: () => {},
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ...spies
  };
  return {
    adapter,
    spies,
    emit: (patch: ProviderStatePatch) =>
      listeners.forEach((listener) => listener(patch))
  };
};

const renderWithPlayer = (ui: ReactNode, initial?: ProviderStatePatch) => {
  const handle = createRef<Player.PlayerHandle>();
  const utils = render(
    <Player.Root loading="interaction" ref={handle} source="/tracer.mp4">
      {ui}
    </Player.Root>
  );
  const controller = handle.current as unknown as PlayerController;
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
    emit: (patch: ProviderStatePatch) => act(() => mock.emit(patch))
  };
};

const allNotReady = (): PlayerCapabilities => ({
  seek: notReady,
  setVolume: notReady,
  setPlaybackRate: notReady,
  selectQuality: notReady,
  selectTextTrack: notReady,
  fullscreen: notReady,
  pictureInPicture: notReady,
  airPlay: notReady,
  customControls: notReady
});

const capabilities = (
  overrides: Partial<PlayerCapabilities>
): ProviderStatePatch => ({
  capabilities: { ...allNotReady(), ...overrides }
});

const withVolume = (status: Availability): ProviderStatePatch =>
  capabilities({ seek: available, setVolume: status });

const attr = (element: Element | null, name: string): string | null =>
  element?.getAttribute(name) ?? null;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PlayButton', () => {
  test('is a native button that toggles playback with a user origin', () => {
    const { spies } = renderWithPlayer(<Player.PlayButton />, {
      playback: 'paused'
    });
    const button = screen.getByRole('button', { name: 'Play' });
    expect(button.tagName).toBe('BUTTON');
    expect(attr(button, 'type')).toBe('button');
    expect(attr(button, 'aria-pressed')).toBe('false');
    fireEvent.click(button);
    expect(spies.play).toHaveBeenCalledTimes(1);
  });

  test('reflects playing state through label and state attributes', () => {
    renderWithPlayer(<Player.PlayButton />, { playback: 'playing' });
    const button = screen.getByRole('button', { name: 'Pause' });
    expect(attr(button, 'data-reely-part')).toBe('play-button');
    expect(attr(button, 'data-state')).toBe('playing');
    expect(attr(button, 'data-provider')).toBe('native');
    expect(attr(button, 'aria-pressed')).toBe('true');
  });

  test('passes className, style and ref through, with a 44px target', () => {
    const ref = createRef<HTMLButtonElement>();
    renderWithPlayer(
      <Player.PlayButton className="c" ref={ref} style={{ color: 'red' }} />,
      { playback: 'paused' }
    );
    const button = screen.getByRole('button', { name: 'Play' });
    expect(ref.current).toBe(button);
    expect(button.classList.contains('c')).toBe(true);
    expect(button.style.color).toBe('red');
    expect(button.style.minWidth).toBe('44px');
    expect(button.style.minHeight).toBe('44px');
  });

  test('renders replacement children', () => {
    renderWithPlayer(<Player.PlayButton>Go</Player.PlayButton>, {
      playback: 'paused'
    });
    expect(screen.getByRole('button', { name: 'Play' }).textContent).toBe('Go');
  });
});

describe('MuteButton', () => {
  test('renders nothing while the volume capability is unknown', () => {
    renderWithPlayer(<Player.MuteButton />, withVolume(notReady));
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('renders nothing when the volume capability is unavailable', () => {
    renderWithPlayer(<Player.MuteButton />, withVolume(unavailable));
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('toggles muted state with accessible naming and pressed state', () => {
    const { spies } = renderWithPlayer(<Player.MuteButton />, {
      ...withVolume(available),
      muted: false
    });
    const button = screen.getByRole('button', { name: 'Mute' });
    expect(attr(button, 'data-reely-part')).toBe('mute-button');
    expect(attr(button, 'data-state')).toBe('unmuted');
    expect(attr(button, 'aria-pressed')).toBe('false');
    fireEvent.click(button);
    expect(spies.mute).toHaveBeenCalledTimes(1);
  });

  test('names itself Unmute and reports pressed when muted', () => {
    renderWithPlayer(<Player.MuteButton />, {
      ...withVolume(available),
      muted: true
    });
    const button = screen.getByRole('button', { name: 'Unmute' });
    expect(attr(button, 'aria-pressed')).toBe('true');
    expect(attr(button, 'data-state')).toBe('muted');
  });
});

describe('VolumeSlider', () => {
  test('renders nothing until the volume capability resolves', () => {
    renderWithPlayer(<Player.VolumeSlider />, withVolume(notReady));
    expect(screen.queryByRole('slider')).toBeNull();
  });

  test('exposes a native slider with name, limits and percentage valuetext', () => {
    renderWithPlayer(<Player.VolumeSlider />, {
      ...withVolume(available),
      volume: 0.5,
      muted: false
    });
    const slider = screen.getByRole('slider', { name: 'Volume' });
    expect(slider.tagName).toBe('INPUT');
    expect(attr(slider, 'type')).toBe('range');
    expect(attr(slider, 'min')).toBe('0');
    expect(attr(slider, 'max')).toBe('1');
    expect(attr(slider, 'aria-valuetext')).toBe('50%');
    expect((slider as HTMLInputElement).value).toBe('0.5');
  });

  test('sets the volume when changed', () => {
    const { spies } = renderWithPlayer(<Player.VolumeSlider />, {
      ...withVolume(available),
      volume: 0.5
    });
    const slider = screen.getByRole('slider', { name: 'Volume' });
    fireEvent.change(slider, { target: { value: '0.8' } });
    expect(spies.setVolume).toHaveBeenCalledWith(0.8);
  });

  test('reports a muted slider at zero', () => {
    renderWithPlayer(<Player.VolumeSlider />, {
      ...withVolume(available),
      volume: 0.7,
      muted: true
    });
    const slider = screen.getByRole('slider', { name: 'Volume' });
    expect((slider as HTMLInputElement).value).toBe('0');
    expect(attr(slider, 'aria-valuetext')).toBe('0%');
    // Muted is expressed only through data-state; the redundant data-muted
    // presence attribute is gone.
    expect(attr(slider, 'data-state')).toBe('muted');
    expect(slider.hasAttribute('data-muted')).toBe(false);
  });
});

describe('SeekSlider', () => {
  const seekReady = (patch: ProviderStatePatch = {}): ProviderStatePatch => ({
    ...capabilities({ seek: available }),
    duration: 100,
    currentTime: 30,
    ...patch
  });

  test('renders nothing while the seek capability is unknown', () => {
    renderWithPlayer(<Player.SeekSlider />, capabilities({ seek: notReady }));
    expect(screen.queryByRole('slider')).toBeNull();
  });

  test('exposes a native slider with a time valuetext', () => {
    renderWithPlayer(<Player.SeekSlider />, seekReady());
    const slider = screen.getByRole('slider', { name: 'Seek' });
    expect(slider.tagName).toBe('INPUT');
    expect(attr(slider, 'type')).toBe('range');
    expect(attr(slider, 'max')).toBe('100');
    expect((slider as HTMLInputElement).value).toBe('30');
    expect(attr(slider, 'aria-valuetext')).toBe('0:30 of 1:40');
  });

  test('seeks to the chosen time on change', () => {
    const { spies } = renderWithPlayer(<Player.SeekSlider />, seekReady());
    const slider = screen.getByRole('slider', { name: 'Seek' });
    fireEvent.change(slider, { target: { value: '75' } });
    expect(spies.seekTo).toHaveBeenCalledWith(75);
  });

  test('renders buffered ranges from player state', () => {
    const { container } = renderWithPlayer(
      <Player.SeekSlider />,
      seekReady({
        buffered: [
          { start: 0, end: 20 },
          { start: 40, end: 60 }
        ]
      })
    );
    const ranges = container.querySelectorAll<HTMLElement>(
      '[data-reely-part="seek-buffered-range"]'
    );
    expect(ranges).toHaveLength(2);
    expect(ranges[0]!.style.left).toBe('0%');
    expect(ranges[0]!.style.width).toBe('20%');
    expect(ranges[1]!.style.left).toBe('40%');
    expect(ranges[1]!.style.width).toBe('20%');
  });

  test('gives the scrubber input a 44px default target', () => {
    renderWithPlayer(<Player.SeekSlider />, seekReady());
    const slider = screen.getByRole('slider', { name: 'Seek' });
    expect((slider as HTMLInputElement).style.minHeight).toBe('44px');
  });

  test('forwards inputProps to the range control and chains onChange', () => {
    const onChange = vi.fn();
    const { spies } = renderWithPlayer(
      <Player.SeekSlider
        inputProps={{
          step: 5,
          'aria-label': 'Scrub',
          name: 'scrub',
          onChange
        }}
      />,
      seekReady()
    );
    const slider = screen.getByRole('slider', { name: 'Scrub' });
    expect(attr(slider, 'step')).toBe('5');
    expect(attr(slider, 'name')).toBe('scrub');
    fireEvent.change(slider, { target: { value: '75' } });
    expect(spies.seekTo).toHaveBeenCalledWith(75);
    expect(onChange).toHaveBeenCalledOnce();
  });

  const liveWindow = (patch: ProviderStatePatch = {}): ProviderStatePatch => ({
    ...capabilities({ seek: available }),
    duration: null,
    currentTime: 50,
    seekable: [{ start: 20, end: 80 }],
    ...patch
  });

  test('scrubs a live DVR window when duration is null but seekable exists', () => {
    const { container } = renderWithPlayer(<Player.SeekSlider />, liveWindow());
    const slider = screen.getByRole('slider', { name: 'Seek' });
    expect(attr(slider, 'min')).toBe('20');
    expect(attr(slider, 'max')).toBe('80');
    expect((slider as HTMLInputElement).value).toBe('50');
    expect(attr(slider, 'aria-valuetext')).toBe('0:50');
    expect(
      attr(
        container.querySelector('[data-reely-part="seek-slider"]')!,
        'data-state'
      )
    ).toBe('ready');
  });

  test('seeks within a live DVR window on change', () => {
    const { spies } = renderWithPlayer(<Player.SeekSlider />, liveWindow());
    const slider = screen.getByRole('slider', { name: 'Seek' });
    fireEvent.change(slider, { target: { value: '65' } });
    expect(spies.seekTo).toHaveBeenCalledWith(65);
  });

  test('positions buffered ranges relative to a live DVR window', () => {
    const { container } = renderWithPlayer(
      <Player.SeekSlider />,
      liveWindow({ buffered: [{ start: 35, end: 50 }] })
    );
    const range = container.querySelector<HTMLElement>(
      '[data-reely-part="seek-buffered-range"]'
    )!;
    // window span 60, offset 20: left (35-20)/60=25%, width 15/60=25%.
    expect(range.style.left).toBe('25%');
    expect(range.style.width).toBe('25%');
  });
});

describe('Time', () => {
  test('formats the current time by default', () => {
    renderWithPlayer(<Player.Time />, { currentTime: 75, duration: 100 });
    const time = screen.getByText('1:15');
    expect(time.tagName).toBe('TIME');
    expect(attr(time, 'data-reely-part')).toBe('time');
    expect(attr(time, 'data-time-type')).toBe('current');
  });

  test('exposes stable state and provider attributes', () => {
    renderWithPlayer(<Player.Time />, {
      currentTime: 75,
      duration: 100,
      provider: 'native'
    });
    const time = screen.getByText('1:15');
    expect(attr(time, 'data-state')).toBe('timed');
    expect(attr(time, 'data-provider')).toBe('native');
  });

  test('reports an untimed state when the duration is unknown', () => {
    renderWithPlayer(<Player.Time />, { currentTime: 0, duration: null });
    const time = screen.getByText('0:00');
    expect(attr(time, 'data-state')).toBe('untimed');
  });

  test('formats the duration', () => {
    renderWithPlayer(<Player.Time type="duration" />, {
      currentTime: 10,
      duration: 3725
    });
    expect(screen.getByText('1:02:05')).toBeDefined();
  });

  test('formats the remaining time', () => {
    renderWithPlayer(<Player.Time type="remaining" />, {
      currentTime: 30,
      duration: 100
    });
    expect(screen.getByText('-1:10')).toBeDefined();
  });
});

describe('FullscreenButton', () => {
  test('stays absent until the capability resolves (no flash-in)', () => {
    const { emit } = renderWithPlayer(
      <Player.FullscreenButton />,
      capabilities({ fullscreen: notReady })
    );
    expect(screen.queryByRole('button')).toBeNull();
    emit(capabilities({ fullscreen: available }));
    expect(
      screen.getByRole('button', { name: 'Enter fullscreen' })
    ).toBeDefined();
  });

  test('renders nothing when fullscreen is unavailable', () => {
    renderWithPlayer(
      <Player.FullscreenButton />,
      capabilities({ fullscreen: unavailable })
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('requests and exits fullscreen with pressed state', () => {
    const { spies, emit } = renderWithPlayer(
      <Player.FullscreenButton />,
      capabilities({ fullscreen: available })
    );
    const button = screen.getByRole('button', { name: 'Enter fullscreen' });
    expect(attr(button, 'data-reely-part')).toBe('fullscreen-button');
    expect(attr(button, 'data-state')).toBe('inline');
    expect(attr(button, 'aria-pressed')).toBe('false');
    fireEvent.click(button);
    expect(spies.requestFullscreen).toHaveBeenCalledTimes(1);
    emit({ ...capabilities({ fullscreen: available }), fullscreen: true });
    const active = screen.getByRole('button', { name: 'Exit fullscreen' });
    expect(attr(active, 'aria-pressed')).toBe('true');
    fireEvent.click(active);
    expect(spies.exitFullscreen).toHaveBeenCalledTimes(1);
  });
});

describe('PipButton', () => {
  test('stays absent until the capability resolves', () => {
    renderWithPlayer(
      <Player.PipButton />,
      capabilities({ pictureInPicture: notReady })
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('requests and exits picture-in-picture', () => {
    const { spies, emit } = renderWithPlayer(
      <Player.PipButton />,
      capabilities({ pictureInPicture: available })
    );
    const button = screen.getByRole('button', {
      name: 'Enter picture-in-picture'
    });
    expect(attr(button, 'data-reely-part')).toBe('pip-button');
    fireEvent.click(button);
    expect(spies.requestPictureInPicture).toHaveBeenCalledTimes(1);
    emit({
      ...capabilities({ pictureInPicture: available }),
      pictureInPicture: true
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Exit picture-in-picture' })
    );
    expect(spies.exitPictureInPicture).toHaveBeenCalledTimes(1);
  });
});

describe('AirPlayButton', () => {
  test('stays absent until the capability resolves', () => {
    const { emit } = renderWithPlayer(
      <Player.AirPlayButton />,
      capabilities({ airPlay: notReady })
    );
    expect(screen.queryByRole('button')).toBeNull();
    emit(capabilities({ airPlay: available }));
    expect(screen.getByRole('button', { name: 'AirPlay' })).toBeDefined();
  });

  test('renders nothing when AirPlay is unavailable', () => {
    renderWithPlayer(
      <Player.AirPlayButton />,
      capabilities({ airPlay: unavailable })
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('opens the picker and carries the part/provider contract', () => {
    const { spies } = renderWithPlayer(
      <Player.AirPlayButton />,
      capabilities({ airPlay: available })
    );
    const button = screen.getByRole('button', { name: 'AirPlay' });
    expect(attr(button, 'data-reely-part')).toBe('airplay-button');
    expect(attr(button, 'data-provider')).toBe('native');
    fireEvent.click(button);
    expect(spies.showAirPlayPicker).toHaveBeenCalledTimes(1);
  });

  // The page is never told which route the user picked, so the control has no
  // on/off state to expose — unlike PipButton, which is a real toggle.
  test('is not a toggle: no aria-pressed, one static label', () => {
    const { emit } = renderWithPlayer(
      <Player.AirPlayButton />,
      capabilities({ airPlay: available })
    );
    const button = screen.getByRole('button', { name: 'AirPlay' });
    expect(attr(button, 'aria-pressed')).toBeNull();
    // The documented contract, and the whole reason this control differs from
    // PipButton: no invented state attribute. Without this assertion a
    // `data-state` could be added and every other test would still pass.
    expect(attr(button, 'data-state')).toBeNull();
    fireEvent.click(button);
    emit({ playback: 'playing' });
    expect(
      screen.getByRole('button', { name: 'AirPlay' }).getAttribute('aria-label')
    ).toBe('AirPlay');
  });

  test('passes className, style and ref through, with a 44px target', () => {
    const ref = createRef<HTMLButtonElement>();
    renderWithPlayer(
      <Player.AirPlayButton className="c" ref={ref} style={{ color: 'red' }} />,
      capabilities({ airPlay: available })
    );
    const button = screen.getByRole('button', { name: 'AirPlay' });
    expect(ref.current).toBe(button);
    expect(button.classList.contains('c')).toBe(true);
    expect(button.style.color).toBe('red');
    expect(button.style.minWidth).toBe('44px');
    expect(button.style.minHeight).toBe('44px');
    // A bare <button> inside a form submits it.
    expect(button.getAttribute('type')).toBe('button');
  });

  test('a consumer onClick that prevents default suppresses the picker', () => {
    const { spies } = renderWithPlayer(
      <Player.AirPlayButton
        onClick={(event) => {
          event.preventDefault();
        }}
      />,
      capabilities({ airPlay: available })
    );
    fireEvent.click(screen.getByRole('button', { name: 'AirPlay' }));
    expect(spies.showAirPlayPicker).not.toHaveBeenCalled();
  });
});

describe('Controls container and scoped shortcuts', () => {
  const controlsState = (
    patch: ProviderStatePatch = {}
  ): ProviderStatePatch => ({
    ...capabilities({
      seek: available,
      setVolume: available,
      fullscreen: available
    }),
    duration: 100,
    currentTime: 30,
    volume: 0.5,
    playback: 'paused',
    ...patch
  });

  test('exposes a controls region with stable part attribute', () => {
    const { container } = renderWithPlayer(
      <Player.Controls>
        <Player.PlayButton />
      </Player.Controls>,
      controlsState()
    );
    const region = container.querySelector('[data-reely-part="controls"]');
    expect(region).not.toBeNull();
  });

  test('exposes stable state and provider attributes', () => {
    const { container } = renderWithPlayer(
      <Player.Controls>
        <Player.PlayButton />
      </Player.Controls>,
      controlsState({ provider: 'native' })
    );
    const region = container.querySelector('[data-reely-part="controls"]');
    expect(attr(region, 'data-state')).toBe('scoped');
    expect(attr(region, 'data-provider')).toBe('native');
  });

  test('reports a global shortcut scope through data-state', () => {
    const { container } = renderWithPlayer(
      <Player.Controls global>
        <Player.PlayButton />
      </Player.Controls>,
      controlsState()
    );
    const region = container.querySelector('[data-reely-part="controls"]');
    expect(attr(region, 'data-state')).toBe('global');
  });

  test('Space and K toggle playback when the region is focused', () => {
    const { container, spies } = renderWithPlayer(
      <Player.Controls>
        <Player.Time />
      </Player.Controls>,
      controlsState()
    );
    const region = container.querySelector<HTMLElement>(
      '[data-reely-part="controls"]'
    )!;
    region.focus();
    fireEvent.keyDown(region, { key: ' ' });
    fireEvent.keyDown(region, { key: 'k' });
    expect(spies.play).toHaveBeenCalledTimes(2);
  });

  test('arrows seek and change volume; J/L seek; M mutes; F toggles fullscreen', () => {
    const { container, spies } = renderWithPlayer(
      <Player.Controls>
        <Player.Time />
      </Player.Controls>,
      controlsState()
    );
    const region = container.querySelector<HTMLElement>(
      '[data-reely-part="controls"]'
    )!;
    region.focus();
    fireEvent.keyDown(region, { key: 'ArrowRight' });
    expect(spies.seekBy).toHaveBeenLastCalledWith(5);
    fireEvent.keyDown(region, { key: 'ArrowLeft' });
    expect(spies.seekBy).toHaveBeenLastCalledWith(-5);
    fireEvent.keyDown(region, { key: 'l' });
    expect(spies.seekBy).toHaveBeenLastCalledWith(10);
    fireEvent.keyDown(region, { key: 'j' });
    expect(spies.seekBy).toHaveBeenLastCalledWith(-10);
    fireEvent.keyDown(region, { key: 'ArrowUp' });
    expect(spies.setVolume).toHaveBeenLastCalledWith(0.55);
    fireEvent.keyDown(region, { key: 'ArrowDown' });
    expect(spies.setVolume).toHaveBeenLastCalledWith(0.45);
    fireEvent.keyDown(region, { key: 'm' });
    expect(spies.mute).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(region, { key: 'f' });
    expect(spies.requestFullscreen).toHaveBeenCalledTimes(1);
  });

  test('does not mute via M when volume control is unavailable', () => {
    const { container, spies } = renderWithPlayer(
      <Player.Controls>
        <Player.Time />
      </Player.Controls>,
      {
        ...capabilities({
          seek: available,
          setVolume: unavailable,
          fullscreen: available
        }),
        duration: 100,
        currentTime: 30,
        volume: 0.5,
        playback: 'paused'
      }
    );
    const region = container.querySelector<HTMLElement>(
      '[data-reely-part="controls"]'
    )!;
    region.focus();
    fireEvent.keyDown(region, { key: 'm' });
    expect(spies.mute).not.toHaveBeenCalled();
  });

  test('ignores shortcuts originating from editable fields', () => {
    const { container, spies } = renderWithPlayer(
      <Player.Controls>
        <input aria-label="note" />
        <Player.Time />
      </Player.Controls>,
      controlsState()
    );
    const input = container.querySelector('input')!;
    input.focus();
    fireEvent.keyDown(input, { key: 'k' });
    fireEvent.keyDown(input, { key: 'm' });
    expect(spies.play).not.toHaveBeenCalled();
    expect(spies.mute).not.toHaveBeenCalled();
  });

  test('leaves arrow keys to a focused slider input instead of the seek/volume shortcuts', () => {
    const { container, spies } = renderWithPlayer(
      <Player.Controls>
        <Player.SeekSlider />
        <Player.VolumeSlider />
      </Player.Controls>,
      controlsState()
    );
    const seekInput = container.querySelector<HTMLInputElement>(
      '[data-reely-part="seek-slider-input"]'
    )!;
    seekInput.focus();
    fireEvent.keyDown(seekInput, { key: 'ArrowRight' });
    fireEvent.keyDown(seekInput, { key: 'ArrowLeft' });

    const volumeInput = container.querySelector<HTMLInputElement>(
      '[data-reely-part="volume-slider"]'
    )!;
    volumeInput.focus();
    fireEvent.keyDown(volumeInput, { key: 'ArrowUp' });
    fireEvent.keyDown(volumeInput, { key: 'ArrowDown' });

    // The region's shortcut handler bails on native inputs, so the sliders'
    // own arrow-key stepping owns the interaction (no double-handling).
    expect(spies.seekBy).not.toHaveBeenCalled();
    expect(spies.setVolume).not.toHaveBeenCalled();
  });

  test('ignores shortcuts while an open menu has focus', () => {
    const { container, spies } = renderWithPlayer(
      <Player.Controls>
        <div role="menu">
          <button role="menuitem" type="button">
            item
          </button>
        </div>
        <Player.Time />
      </Player.Controls>,
      controlsState()
    );
    const item = container.querySelector<HTMLElement>('[role="menuitem"]')!;
    item.focus();
    fireEvent.keyDown(item, { key: 'k' });
    expect(spies.play).not.toHaveBeenCalled();
  });

  test('does not react to keys outside the region by default', () => {
    const { spies } = renderWithPlayer(
      <Player.Controls>
        <Player.Time />
      </Player.Controls>,
      controlsState()
    );
    fireEvent.keyDown(document.body, { key: 'k' });
    expect(spies.play).not.toHaveBeenCalled();
  });

  test('opts into global shortcuts explicitly', () => {
    const { spies } = renderWithPlayer(
      <Player.Controls global>
        <Player.Time />
      </Player.Controls>,
      controlsState()
    );
    fireEvent.keyDown(document.body, { key: 'k' });
    expect(spies.play).toHaveBeenCalledTimes(1);
  });

  test('restores focus to the region when a focused control unmounts', async () => {
    const { container, emit } = renderWithPlayer(
      <Player.Controls>
        <Player.FullscreenButton />
      </Player.Controls>,
      controlsState({ fullscreen: false })
    );
    const button = screen.getByRole('button', { name: 'Enter fullscreen' });
    button.focus();
    expect(document.activeElement).toBe(button);
    emit(
      capabilities({
        seek: available,
        setVolume: available,
        fullscreen: unavailable
      })
    );
    const region = container.querySelector<HTMLElement>(
      '[data-reely-part="controls"]'
    )!;
    await waitFor(() => expect(document.activeElement).toBe(region));
    expect(document.activeElement).not.toBe(document.body);
  });

  test('does not re-steal focus after an outside click drops focus to body', () => {
    const { container, emit } = renderWithPlayer(
      <Player.Controls>
        <Player.FullscreenButton />
      </Player.Controls>,
      controlsState({ fullscreen: false })
    );
    const button = screen.getByRole('button', { name: 'Enter fullscreen' });
    button.focus();
    expect(document.activeElement).toBe(button);
    // Clicking empty page area drops focus to <body> with no capability change.
    button.blur();
    expect(document.activeElement).toBe(document.body);
    // Frequent non-capability ticks (volume, currentTime) must not yank focus
    // back into the region.
    emit({ volume: 0.6 });
    emit({ currentTime: 31 });
    const region = container.querySelector<HTMLElement>(
      '[data-reely-part="controls"]'
    )!;
    expect(document.activeElement).toBe(document.body);
    expect(document.activeElement).not.toBe(region);
  });
});
