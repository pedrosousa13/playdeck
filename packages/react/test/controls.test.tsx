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
    showAirPlayPicker: vi.fn(ok),
    selectTextTrack: vi.fn(ok)
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

  test('carries an admitted stall on the same 500ms schedule as the indicator', () => {
    const { container, emit } = renderWithPlayer(
      <Player.SeekSlider />,
      seekReady()
    );
    const slider = container.querySelector('[data-reely-part="seek-slider"]');
    expect(attr(slider, 'data-buffering')).toBe('false');

    vi.useFakeTimers();
    emit({ buffering: true });

    // Same debounce as LoadingIndicator, from the same hook: a short rebuffer
    // must not twitch the slider either.
    act(() => void vi.advanceTimersByTime(499));
    expect(attr(slider, 'data-buffering')).toBe('false');

    act(() => void vi.advanceTimersByTime(1));
    expect(attr(slider, 'data-buffering')).toBe('true');

    // `data-state` means "is there a seek window" and must be untouched by the
    // stall — conflating the two axes would break every consumer rule that
    // selects on [data-state="ready"].
    expect(attr(slider, 'data-state')).toBe('ready');

    vi.useRealTimers();
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
    expect(attr(slider, 'aria-disabled')).toBeNull();
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
    expect(attr(slider, 'aria-disabled')).toBeNull();
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

  const noWindow = (patch: ProviderStatePatch = {}): ProviderStatePatch => ({
    ...capabilities({ seek: available }),
    duration: null,
    currentTime: 0,
    seekable: [],
    ...patch
  });

  test('reports itself aria-disabled when no seek window exists', () => {
    const { container } = renderWithPlayer(<Player.SeekSlider />, noWindow());
    const slider = screen.getByRole('slider', { name: 'Seek' });
    expect(attr(slider, 'aria-disabled')).toBe('true');
    expect(
      attr(
        container.querySelector('[data-reely-part="seek-slider"]')!,
        'data-state'
      )
    ).toBe('idle');
  });

  test('announces no clock time when no seek window exists', () => {
    renderWithPlayer(<Player.SeekSlider />, noWindow());
    const slider = screen.getByRole('slider', { name: 'Seek' });
    // A position it does not have must not be asserted as one: `0:00` reads as
    // the start of a timeline that is not there.
    expect(attr(slider, 'aria-valuetext')).not.toMatch(/\d+:\d\d/);
    expect(attr(slider, 'aria-valuetext')).toBe('Unavailable');
  });

  test('stays keyboard-reachable when no seek window exists', () => {
    renderWithPlayer(<Player.SeekSlider />, noWindow());
    const slider = screen.getByRole('slider', { name: 'Seek' });
    // `aria-disabled`, not the native attribute: the state is transient, and
    // `disabled` would drop the control out of the tab order and move focus
    // out from under a keyboard user the moment a duration arrives.
    expect((slider as HTMLInputElement).disabled).toBe(false);
    expect(slider.hasAttribute('disabled')).toBe(false);
    (slider as HTMLInputElement).focus();
    expect(document.activeElement).toBe(slider);
  });

  test('issues no seek command on change when no seek window exists', () => {
    const { spies } = renderWithPlayer(<Player.SeekSlider />, noWindow());
    const slider = screen.getByRole('slider', { name: 'Seek' });
    fireEvent.change(slider, { target: { value: '75' } });
    expect(spies.seekTo).not.toHaveBeenCalled();
  });

  test('keeps ownership of aria-disabled against consumer inputProps', () => {
    renderWithPlayer(
      <Player.SeekSlider inputProps={{ 'aria-disabled': false }} />,
      noWindow()
    );
    const slider = screen.getByRole('slider', { name: 'Seek' });
    expect(attr(slider, 'aria-disabled')).toBe('true');
  });

  // The buffered geometry is `aria-hidden` (#189), so this description is the
  // extent's only text equivalent.
  const describedText = (slider: Element): string | null => {
    const id = attr(slider, 'aria-describedby');
    return id === null
      ? null
      : (document.getElementById(id)?.textContent ?? null);
  };

  test('describes the buffered share of a VOD seek window', () => {
    const { container } = renderWithPlayer(
      <Player.SeekSlider />,
      seekReady({ buffered: [{ start: 0, end: 45 }] })
    );
    const slider = screen.getByRole('slider', { name: 'Seek' });
    expect(describedText(slider)).toBe('45% loaded');
    expect(
      attr(
        container.querySelector(
          '[data-reely-part="seek-buffered-description"]'
        )!,
        'id'
      )
    ).toBe(attr(slider, 'aria-describedby'));
  });

  test('describes disjoint buffered ranges once, as their combined share', () => {
    const { container } = renderWithPlayer(
      <Player.SeekSlider />,
      seekReady({
        buffered: [
          { start: 0, end: 45 },
          { start: 60, end: 80 }
        ]
      })
    );
    const slider = screen.getByRole('slider', { name: 'Seek' });
    // Not "loaded to 1:20": 0:45 to 1:00 is a gap the playhead cannot cross
    // without waiting. 65 of the window's 100 seconds are loaded, once.
    expect(describedText(slider)).toBe('65% loaded');
    expect(
      container.querySelectorAll(
        '[data-reely-part="seek-buffered-description"]'
      )
    ).toHaveLength(1);
    expect(attr(slider, 'aria-describedby')).not.toMatch(/\s/);
  });

  test('counts overlapping buffered ranges once', () => {
    renderWithPlayer(
      <Player.SeekSlider />,
      seekReady({
        buffered: [
          { start: 20, end: 50 },
          { start: 0, end: 40 }
        ]
      })
    );
    const slider = screen.getByRole('slider', { name: 'Seek' });
    // The list is neither sorted nor guaranteed disjoint. Summing the two
    // lengths would claim 70%; the union covers 0 to 50.
    expect(describedText(slider)).toBe('50% loaded');
  });

  test('describes the buffered share against a live DVR window, not media time', () => {
    renderWithPlayer(
      <Player.SeekSlider />,
      liveWindow({ buffered: [{ start: 35, end: 50 }] })
    );
    const slider = screen.getByRole('slider', { name: 'Seek' });
    // Window [20, 80]: 15 loaded seconds of a 60-second window. Measured
    // against absolute media time it would read 19% (15/80) or worse.
    expect(describedText(slider)).toBe('25% loaded');
  });

  test('describes a sliver of buffer as 1%, never as nothing', () => {
    renderWithPlayer(
      <Player.SeekSlider />,
      seekReady({ buffered: [{ start: 0, end: 0.3 }] })
    );
    const slider = screen.getByRole('slider', { name: 'Seek' });
    // 0.3 of 100 seconds rounds to zero, and `0% loaded` would deny a
    // measurement that was taken. Something loaded is not nothing.
    expect(describedText(slider)).toBe('1% loaded');
  });

  test('describes a nearly complete buffer as 99%, never as complete', () => {
    renderWithPlayer(
      <Player.SeekSlider />,
      seekReady({ buffered: [{ start: 0, end: 99.7 }] })
    );
    const slider = screen.getByRole('slider', { name: 'Seek' });
    // 99.7 of 100 seconds rounds to a hundred, and `100% loaded` would promise
    // a scrub to the end that still has 0.3s to wait for.
    expect(describedText(slider)).toBe('99% loaded');
  });

  test('describes a wholly covered seek window as complete', () => {
    renderWithPlayer(
      <Player.SeekSlider />,
      seekReady({ buffered: [{ start: 0, end: 100 }] })
    );
    const slider = screen.getByRole('slider', { name: 'Seek' });
    expect(describedText(slider)).toBe('100% loaded');
  });

  test('claims no buffered extent when the buffered list is empty', () => {
    const { container } = renderWithPlayer(
      <Player.SeekSlider />,
      seekReady({ buffered: [] })
    );
    const slider = screen.getByRole('slider', { name: 'Seek' });
    expect(attr(slider, 'aria-describedby')).toBeNull();
    expect(
      container.querySelector('[data-reely-part="seek-buffered-description"]')
    ).toBeNull();
  });

  test('claims no buffered extent when no seek window exists', () => {
    const { container } = renderWithPlayer(
      <Player.SeekSlider />,
      noWindow({ buffered: [{ start: 0, end: 10 }] })
    );
    const slider = screen.getByRole('slider', { name: 'Seek' });
    expect(attr(slider, 'aria-describedby')).toBeNull();
    expect(
      container.querySelector('[data-reely-part="seek-buffered-description"]')
    ).toBeNull();
  });

  test('claims no buffered extent when the buffer has slid out of the live window', () => {
    const { container } = renderWithPlayer(
      <Player.SeekSlider />,
      liveWindow({ buffered: [{ start: 0, end: 10 }] })
    );
    const slider = screen.getByRole('slider', { name: 'Seek' });
    // Window [20, 80]: the buffer is behind the back of a DVR window that has
    // moved past it, so none of it survives the clamp. There is a list, but
    // nothing in it is reachable, and `0% loaded` would report that as a
    // measurement of the window instead of an absence.
    expect(attr(slider, 'aria-describedby')).toBeNull();
    expect(
      container.querySelector('[data-reely-part="seek-buffered-description"]')
    ).toBeNull();
  });

  test('keeps the buffered geometry out of the accessibility tree', () => {
    const { container } = renderWithPlayer(
      <Player.SeekSlider />,
      seekReady({ buffered: [{ start: 0, end: 45 }] })
    );
    const buffered = container.querySelector(
      '[data-reely-part="seek-buffered"]'
    )!;
    expect(attr(buffered, 'aria-hidden')).toBe('true');
    // The description is a sibling of the geometry, not a child: inside the
    // hidden subtree it would be unreadable, and every range element stays
    // the empty box it is.
    expect(
      buffered.querySelector('[data-reely-part="seek-buffered-description"]')
    ).toBeNull();
    for (const range of container.querySelectorAll(
      '[data-reely-part="seek-buffered-range"]'
    )) {
      expect(range.textContent).toBe('');
    }
  });

  test('never announces a buffered change, on any update', () => {
    const { container, emit } = renderWithPlayer(
      <Player.SeekSlider />,
      seekReady({ buffered: [{ start: 0, end: 45 }] })
    );
    const slider = screen.getByRole('slider', { name: 'Seek' });
    const root = container.querySelector('[data-reely-part="seek-slider"]')!;
    const shouty = () =>
      root.querySelectorAll(
        '[aria-live], [role="status"], [role="alert"], [role="log"]'
      );
    expect(shouty()).toHaveLength(0);
    const id = attr(slider, 'aria-describedby');

    // `buffered` moves many times a second during playback. The description is
    // read on demand, never pushed.
    emit({ buffered: [{ start: 0, end: 70 }] });
    expect(describedText(slider)).toBe('70% loaded');
    expect(shouty()).toHaveLength(0);

    // A moving id is the other re-announcement route: some screen readers
    // re-read a description whose id changed. It has to hold across the gap
    // where the description disappears and comes back, too.
    expect(attr(slider, 'aria-describedby')).toBe(id);
    emit({ buffered: [] });
    expect(attr(slider, 'aria-describedby')).toBeNull();
    emit({ buffered: [{ start: 0, end: 20 }] });
    expect(attr(slider, 'aria-describedby')).toBe(id);
  });

  test('composes its description with one supplied through inputProps', () => {
    renderWithPlayer(
      <>
        <p id="house-rules">Scrubbing is disabled during ads.</p>
        <Player.SeekSlider inputProps={{ 'aria-describedby': 'house-rules' }} />
      </>,
      seekReady({ buffered: [{ start: 0, end: 45 }] })
    );
    const slider = screen.getByRole('slider', { name: 'Seek' });
    const ids = attr(slider, 'aria-describedby')!.split(' ');
    expect(ids).toContain('house-rules');
    expect(ids).toHaveLength(2);
    expect(document.getElementById(ids[1]!)?.textContent).toBe('45% loaded');
  });

  test('leaves a supplied description alone when it claims nothing itself', () => {
    renderWithPlayer(
      <>
        <p id="house-rules">Scrubbing is disabled during ads.</p>
        <Player.SeekSlider inputProps={{ 'aria-describedby': 'house-rules' }} />
      </>,
      seekReady({ buffered: [] })
    );
    const slider = screen.getByRole('slider', { name: 'Seek' });
    expect(attr(slider, 'aria-describedby')).toBe('house-rules');
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

  // Reely does not currently surface an active-route flag (WebKit's
  // `webkitCurrentPlaybackTargetIsWireless` is deliberately unplumbed in
  // provider-native), so there is no state to expose — unlike PipButton,
  // which is a real toggle.
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

  test('owns the arrow keys on a focused slider instead of its native stepping', () => {
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
    // preventDefault (a false return) is what makes the input's own stepping
    // inert, so an arrow press means one library-sized jump and nothing else.
    expect(fireEvent.keyDown(seekInput, { key: 'ArrowRight' })).toBe(false);
    expect(spies.seekBy).toHaveBeenLastCalledWith(5);
    expect(fireEvent.keyDown(seekInput, { key: 'ArrowLeft' })).toBe(false);
    expect(spies.seekBy).toHaveBeenLastCalledWith(-5);
    expect(fireEvent.keyDown(seekInput, { key: 'ArrowUp' })).toBe(false);
    expect(spies.setVolume).toHaveBeenLastCalledWith(0.55);
    // Home and End stay native: the layer binds neither.
    expect(fireEvent.keyDown(seekInput, { key: 'End' })).toBe(true);
    expect(fireEvent.keyDown(seekInput, { key: 'Home' })).toBe(true);

    const volumeInput = container.querySelector<HTMLInputElement>(
      '[data-reely-part="volume-slider"]'
    )!;
    volumeInput.focus();
    expect(fireEvent.keyDown(volumeInput, { key: 'ArrowDown' })).toBe(false);
    expect(spies.setVolume).toHaveBeenLastCalledWith(0.45);
    expect(fireEvent.keyDown(volumeInput, { key: 'ArrowRight' })).toBe(false);
    expect(spies.seekBy).toHaveBeenLastCalledWith(5);
  });

  test('seeks the same distance from an arrow wherever focus sits', () => {
    const { container, spies } = renderWithPlayer(
      <Player.Controls>
        <Player.SeekSlider />
      </Player.Controls>,
      controlsState()
    );
    const region = container.querySelector<HTMLElement>(
      '[data-reely-part="controls"]'
    )!;
    const seekInput = container.querySelector<HTMLInputElement>(
      '[data-reely-part="seek-slider-input"]'
    )!;
    region.focus();
    fireEvent.keyDown(region, { key: 'ArrowRight' });
    seekInput.focus();
    fireEvent.keyDown(seekInput, { key: 'ArrowRight' });
    region.focus();
    fireEvent.keyDown(region, { key: 'ArrowLeft' });
    seekInput.focus();
    fireEvent.keyDown(seekInput, { key: 'ArrowLeft' });
    // One call per press, at the same distance from both focus positions.
    expect(spies.seekBy.mock.calls).toEqual([[5], [5], [-5], [-5]]);
  });

  test('runs every shortcut in the map while the seek slider has focus', () => {
    const { container, spies } = renderWithPlayer(
      <Player.Controls>
        <Player.SeekSlider />
      </Player.Controls>,
      controlsState({
        ...capabilities({
          seek: available,
          setVolume: available,
          fullscreen: available,
          selectTextTrack: available
        }),
        selectedTextTrackId: null,
        textTracks: [
          {
            id: 'en',
            label: 'English',
            language: 'en',
            kind: 'subtitles',
            readiness: 'loaded'
          }
        ]
      })
    );
    const seekInput = container.querySelector<HTMLInputElement>(
      '[data-reely-part="seek-slider-input"]'
    )!;
    seekInput.focus();
    fireEvent.keyDown(seekInput, { key: ' ' });
    expect(spies.play).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(seekInput, { key: 'k' });
    expect(spies.play).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(seekInput, { key: 'm' });
    expect(spies.mute).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(seekInput, { key: 'f' });
    expect(spies.requestFullscreen).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(seekInput, { key: 'c' });
    expect(spies.selectTextTrack).toHaveBeenCalledWith('en');
    fireEvent.keyDown(seekInput, { key: 'l' });
    expect(spies.seekBy).toHaveBeenLastCalledWith(10);
    fireEvent.keyDown(seekInput, { key: 'j' });
    expect(spies.seekBy).toHaveBeenLastCalledWith(-10);
    fireEvent.keyDown(seekInput, { key: 'ArrowUp' });
    expect(spies.setVolume).toHaveBeenLastCalledWith(0.55);
    fireEvent.keyDown(seekInput, { key: 'ArrowDown' });
    expect(spies.setVolume).toHaveBeenLastCalledWith(0.45);
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

  test('ignores shortcuts originating from a textarea', () => {
    const { container, spies } = renderWithPlayer(
      <Player.Controls>
        <textarea aria-label="note" />
      </Player.Controls>,
      controlsState()
    );
    const textarea = container.querySelector('textarea')!;
    textarea.focus();
    expect(fireEvent.keyDown(textarea, { key: 'k' })).toBe(true);
    fireEvent.keyDown(textarea, { key: 'm' });
    expect(spies.play).not.toHaveBeenCalled();
    expect(spies.mute).not.toHaveBeenCalled();
  });

  test('ignores shortcuts originating from a select', () => {
    const { container, spies } = renderWithPlayer(
      <Player.Controls>
        <select aria-label="speed" defaultValue="1">
          <option value="1">1x</option>
        </select>
      </Player.Controls>,
      controlsState()
    );
    const select = container.querySelector('select')!;
    select.focus();
    expect(fireEvent.keyDown(select, { key: 'k' })).toBe(true);
    fireEvent.keyDown(select, { key: 'm' });
    expect(spies.play).not.toHaveBeenCalled();
    expect(spies.mute).not.toHaveBeenCalled();
  });

  test('ignores shortcuts originating from a contenteditable region', () => {
    const { container, spies } = renderWithPlayer(
      <Player.Controls>
        <div contentEditable data-note suppressContentEditableWarning>
          note
        </div>
      </Player.Controls>,
      controlsState()
    );
    const editable = container.querySelector<HTMLElement>('[data-note]')!;
    editable.focus();
    expect(fireEvent.keyDown(editable, { key: 'k' })).toBe(true);
    fireEvent.keyDown(editable, { key: 'm' });
    expect(spies.play).not.toHaveBeenCalled();
    expect(spies.mute).not.toHaveBeenCalled();
  });

  test('page up and page down jump ten seconds', () => {
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
    expect(fireEvent.keyDown(region, { key: 'PageUp' })).toBe(false);
    expect(spies.seekBy).toHaveBeenLastCalledWith(10);
    expect(fireEvent.keyDown(region, { key: 'PageDown' })).toBe(false);
    expect(spies.seekBy).toHaveBeenLastCalledWith(-10);
  });

  test('leaves Space and Enter to a focused native activation target', () => {
    const { container, spies } = renderWithPlayer(
      <Player.Controls shortcuts={{ togglePlayback: [' ', 'Enter'] }}>
        <Player.PlayButton />
      </Player.Controls>,
      controlsState()
    );
    const button = screen.getByRole('button', { name: 'Play' });
    button.focus();
    expect(fireEvent.keyDown(button, { key: ' ' })).toBe(true);
    expect(fireEvent.keyDown(button, { key: 'Enter' })).toBe(true);
    expect(spies.play).not.toHaveBeenCalled();
    // Only those two keys are conceded; the rest of the map still fires here.
    fireEvent.keyDown(button, { key: 'm' });
    expect(spies.mute).toHaveBeenCalledTimes(1);
    // And the same binding fires normally away from an activation target.
    const region = container.querySelector<HTMLElement>(
      '[data-reely-part="controls"]'
    )!;
    region.focus();
    fireEvent.keyDown(region, { key: 'Enter' });
    expect(spies.play).toHaveBeenCalledTimes(1);
  });

  test('leaves Space and Enter to a focused submit input', () => {
    // A CSS `button` selector never matches an <input>, so the activation
    // input types have to be named for the concession to reach them — and a
    // swallowed Space here would cancel the form submit.
    const { container, spies } = renderWithPlayer(
      <Player.Controls shortcuts={{ togglePlayback: [' ', 'Enter'] }}>
        <input aria-label="save" type="submit" value="Save" />
      </Player.Controls>,
      controlsState()
    );
    const submit = container.querySelector<HTMLInputElement>(
      'input[type="submit"]'
    )!;
    submit.focus();
    expect(fireEvent.keyDown(submit, { key: ' ' })).toBe(true);
    expect(fireEvent.keyDown(submit, { key: 'Enter' })).toBe(true);
    expect(spies.play).not.toHaveBeenCalled();
    fireEvent.keyDown(submit, { key: 'm' });
    expect(spies.mute).toHaveBeenCalledTimes(1);
  });

  test('leaves Space and Enter to a focused picker input', () => {
    // A file or colour input opens its picker on either key, so it activates
    // as much as a submit input does even though it takes no text.
    const { container, spies } = renderWithPlayer(
      <Player.Controls shortcuts={{ togglePlayback: [' ', 'Enter'] }}>
        <input aria-label="upload" type="file" />
        <input aria-label="tint" type="color" />
      </Player.Controls>,
      controlsState()
    );
    const file =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const color = container.querySelector<HTMLInputElement>(
      'input[type="color"]'
    )!;
    file.focus();
    expect(fireEvent.keyDown(file, { key: ' ' })).toBe(true);
    expect(fireEvent.keyDown(file, { key: 'Enter' })).toBe(true);
    color.focus();
    expect(fireEvent.keyDown(color, { key: ' ' })).toBe(true);
    expect(fireEvent.keyDown(color, { key: 'Enter' })).toBe(true);
    expect(spies.play).not.toHaveBeenCalled();
    // Still not text entry: everything else in the map fires here.
    fireEvent.keyDown(color, { key: 'm' });
    expect(spies.mute).toHaveBeenCalledTimes(1);
  });

  test('leaves Space to a focused checkbox but runs its other shortcuts', () => {
    const { container, spies } = renderWithPlayer(
      <Player.Controls>
        <input aria-label="loop" type="checkbox" />
      </Player.Controls>,
      controlsState()
    );
    const checkbox = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]'
    )!;
    checkbox.focus();
    expect(fireEvent.keyDown(checkbox, { key: ' ' })).toBe(true);
    expect(spies.play).not.toHaveBeenCalled();
    fireEvent.keyDown(checkbox, { key: 'm' });
    expect(spies.mute).toHaveBeenCalledTimes(1);
  });

  test('a binding whose capability is unavailable stays inert', () => {
    const { container, spies } = renderWithPlayer(
      <Player.Controls>
        <Player.Time />
      </Player.Controls>,
      controlsState(
        capabilities({
          seek: unavailable,
          setVolume: available,
          fullscreen: available
        })
      )
    );
    const region = container.querySelector<HTMLElement>(
      '[data-reely-part="controls"]'
    )!;
    region.focus();
    // Inert means the key is left to the page, so no preventDefault either.
    expect(fireEvent.keyDown(region, { key: 'ArrowRight' })).toBe(true);
    expect(fireEvent.keyDown(region, { key: 'PageDown' })).toBe(true);
    expect(spies.seekBy).not.toHaveBeenCalled();
  });

  test('disables the layer entirely with shortcuts={false}', () => {
    const { container, spies } = renderWithPlayer(
      <Player.Controls shortcuts={false}>
        <Player.Time />
      </Player.Controls>,
      controlsState()
    );
    const region = container.querySelector<HTMLElement>(
      '[data-reely-part="controls"]'
    )!;
    region.focus();
    const swallowed = [' ', 'k', 'ArrowRight', 'ArrowUp', 'j', 'm', 'f'].filter(
      (key) => !fireEvent.keyDown(region, { key })
    );
    expect(swallowed).toEqual([]);
    expect(spies.play).not.toHaveBeenCalled();
    expect(spies.seekBy).not.toHaveBeenCalled();
    expect(spies.setVolume).not.toHaveBeenCalled();
    expect(spies.mute).not.toHaveBeenCalled();
    expect(spies.requestFullscreen).not.toHaveBeenCalled();
  });

  test('attaches no document listener when global shortcuts are disabled', () => {
    const { spies } = renderWithPlayer(
      <Player.Controls global shortcuts={false}>
        <Player.Time />
      </Player.Controls>,
      controlsState()
    );
    const outside = document.createElement('div');
    outside.tabIndex = 0;
    document.body.append(outside);
    try {
      outside.focus();
      // A page element outside the player sees the keystroke untouched.
      expect(fireEvent.keyDown(outside, { key: 'k' })).toBe(true);
      expect(fireEvent.keyDown(outside, { key: ' ' })).toBe(true);
      expect(spies.play).not.toHaveBeenCalled();
    } finally {
      outside.remove();
    }
  });

  test('registers no document keydown listener when the layer is off', () => {
    // The outcome above holds either way once the handler bails; this pins
    // the attachment itself, which is what `false` promises in global mode.
    const addEventListener = vi.spyOn(document, 'addEventListener');
    const removeEventListener = vi.spyOn(document, 'removeEventListener');
    // Net, not gross: the effect re-runs whenever the handler identity
    // changes, so a live listener is one attach the matching detach has not
    // taken back.
    const keydownListeners = (): number =>
      addEventListener.mock.calls.filter(([type]) => type === 'keydown')
        .length -
      removeEventListener.mock.calls.filter(([type]) => type === 'keydown')
        .length;
    try {
      // Positive control first, so the assertion below cannot pass because
      // the layer stopped mounting rather than stopped binding.
      renderWithPlayer(
        <Player.Controls global>
          <Player.Time />
        </Player.Controls>,
        controlsState()
      );
      expect(keydownListeners()).toBe(1);
      cleanup();
      addEventListener.mockClear();
      removeEventListener.mockClear();
      renderWithPlayer(
        <Player.Controls global shortcuts={false}>
          <Player.Time />
        </Player.Controls>,
        controlsState()
      );
      expect(keydownListeners()).toBe(0);
    } finally {
      addEventListener.mockRestore();
      removeEventListener.mockRestore();
    }
  });

  test('matches a single-character default binding case-insensitively', () => {
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
    fireEvent.keyDown(region, { key: 'K' });
    expect(spies.play).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(region, { key: 'M' });
    expect(spies.mute).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(region, { key: 'J' });
    expect(spies.seekBy).toHaveBeenLastCalledWith(-10);
    fireEvent.keyDown(region, { key: 'F' });
    expect(spies.requestFullscreen).toHaveBeenCalledTimes(1);
  });

  test('matches a rebound single-character key case-insensitively', () => {
    const { container, spies } = renderWithPlayer(
      <Player.Controls shortcuts={{ togglePlayback: 'p' }}>
        <Player.Time />
      </Player.Controls>,
      controlsState()
    );
    const region = container.querySelector<HTMLElement>(
      '[data-reely-part="controls"]'
    )!;
    region.focus();
    fireEvent.keyDown(region, { key: 'P' });
    expect(spies.play).toHaveBeenCalledTimes(1);
  });

  test('rebinds one action without restating the rest of the map', () => {
    const { container, spies } = renderWithPlayer(
      <Player.Controls shortcuts={{ togglePlayback: 'p' }}>
        <Player.Time />
      </Player.Controls>,
      controlsState()
    );
    const region = container.querySelector<HTMLElement>(
      '[data-reely-part="controls"]'
    )!;
    region.focus();
    fireEvent.keyDown(region, { key: 'p' });
    expect(spies.play).toHaveBeenCalledTimes(1);
    // The named action's default keys are replaced, not added to.
    expect(fireEvent.keyDown(region, { key: ' ' })).toBe(true);
    expect(spies.play).toHaveBeenCalledTimes(1);
    // Every action the consumer did not name keeps its default.
    fireEvent.keyDown(region, { key: 'm' });
    expect(spies.mute).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(region, { key: 'ArrowRight' });
    expect(spies.seekBy).toHaveBeenLastCalledWith(5);
  });

  test('suppresses a single binding with null', () => {
    const { container, spies } = renderWithPlayer(
      <Player.Controls shortcuts={{ toggleMuted: null }}>
        <Player.Time />
      </Player.Controls>,
      controlsState()
    );
    const region = container.querySelector<HTMLElement>(
      '[data-reely-part="controls"]'
    )!;
    region.focus();
    expect(fireEvent.keyDown(region, { key: 'm' })).toBe(true);
    expect(spies.mute).not.toHaveBeenCalled();
    fireEvent.keyDown(region, { key: 'k' });
    expect(spies.play).toHaveBeenCalledTimes(1);
  });

  test('applies a rebinding in global mode too', () => {
    const { spies } = renderWithPlayer(
      <Player.Controls global shortcuts={{ togglePlayback: 'p' }}>
        <Player.Time />
      </Player.Controls>,
      controlsState()
    );
    fireEvent.keyDown(document.body, { key: 'p' });
    expect(spies.play).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: 'k' });
    expect(spies.play).toHaveBeenCalledTimes(1);
  });

  test('resolves a key bound to two actions by the fixed action order', () => {
    const { container, spies } = renderWithPlayer(
      // Written mute first; togglePlayback still wins because it comes first
      // in the action order.
      <Player.Controls shortcuts={{ toggleMuted: 'x', togglePlayback: 'x' }}>
        <Player.Time />
      </Player.Controls>,
      controlsState()
    );
    const region = container.querySelector<HTMLElement>(
      '[data-reely-part="controls"]'
    )!;
    region.focus();
    fireEvent.keyDown(region, { key: 'x' });
    expect(spies.play).toHaveBeenCalledTimes(1);
    expect(spies.mute).not.toHaveBeenCalled();
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
