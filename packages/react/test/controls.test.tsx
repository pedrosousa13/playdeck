// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { createRef, Suspense, type ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
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
    emit: (patch: ProviderStatePatch, event?: ProviderEvent) =>
      listeners.forEach((listener) => listener(patch, event))
  };
};

const renderWithPlayer = (ui: ReactNode, initial?: ProviderStatePatch) => {
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

const allNotReady = (): PlayerCapabilities => ({
  seek: notReady,
  setVolume: notReady,
  setPlaybackRate: notReady,
  selectQuality: notReady,
  selectTextTrack: notReady,
  chapters: notReady,
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
    expect(attr(button, 'data-playdeck-part')).toBe('play-button');
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
    expect(attr(button, 'data-playdeck-part')).toBe('mute-button');
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

  type VolumeSpy = ReturnType<typeof createMockAdapter>['spies']['setVolume'];

  // Stands in for a player that has not published `volumechange` yet: the next
  // volume command hangs until the returned function settles it. That window is
  // the whole of #271 — while it is open the control's value comes from a
  // `PlayerState.volume` the media element has not moved yet, so React restores
  // the input to the old value, and a range input raises no event at all when a
  // key next asks it for the value it already holds.
  const holdNextVolume = (setVolume: VolumeSpy): (() => void) => {
    // Not a no-op until the command runs: settling one that was never issued
    // means the test did not exercise what it thinks it did.
    let settle = (): void => {
      throw new Error('No volume command is being held.');
    };
    setVolume.mockImplementationOnce(
      () =>
        new Promise<CommandResult>((resolve) => {
          settle = () => resolve({ ok: true });
        })
    );
    return () => settle();
  };

  const valueOf = (slider: Element): string =>
    (slider as HTMLInputElement).value;

  const volumeReady = (patch: ProviderStatePatch = {}): ProviderStatePatch => ({
    ...withVolume(available),
    volume: 0.5,
    muted: false,
    ...patch
  });

  test('shows the changed volume while the player still reports the old one', () => {
    const { emit, spies } = renderWithPlayer(
      <Player.VolumeSlider />,
      volumeReady()
    );
    const slider = screen.getByRole('slider', { name: 'Volume' });
    holdNextVolume(spies.setVolume);

    fireEvent.change(slider, { target: { value: '0.8' } });

    // Nothing has published a volume: the media element moves within the task
    // and only reports on its own `volumechange`. Rendering that lagging value
    // here is the restore that swallows the next keypress.
    expect(valueOf(slider)).toBe('0.8');
    expect(attr(slider, 'aria-valuetext')).toBe('80%');

    // An unrelated tick must not hand the thumb back either — the screen
    // reader and the thumb have to agree the whole way through.
    emit({ currentTime: 5 });
    expect(valueOf(slider)).toBe('0.8');
    expect(attr(slider, 'aria-valuetext')).toBe('80%');
  });

  test('keeps every End, Home and End press of a rapid succession', async () => {
    const { spies } = renderWithPlayer(<Player.VolumeSlider />, volumeReady());
    const slider = screen.getByRole('slider', { name: 'Volume' });
    const settle = holdNextVolume(spies.setVolume);

    // Home and End stay native — the shortcut layer binds neither — so each
    // one reaches the input as a change event. happy-dom does not step a range
    // control itself, so the value the browser would set is set here.
    for (const [key, next] of [
      ['End', '1'],
      ['Home', '0'],
      ['End', '1']
    ] as const) {
      fireEvent.keyDown(slider, { key });
      fireEvent.change(slider, { target: { value: next } });
      fireEvent.keyUp(slider, { key });
      // Every press is observable on the thumb the moment it lands. Without
      // that, the second press asks a control still showing 0.5 for a value it
      // is already holding, and the browser raises no event for it at all.
      expect(valueOf(slider)).toBe(next);
    }

    // Two of the three presses landed behind a command the player has not
    // answered, and superseded one another rather than queuing up as two more
    // round trips. Fewer commands than presses is coalescing, not a lost press.
    expect(spies.setVolume).toHaveBeenCalledTimes(1);

    await act(async () => {
      settle();
    });
    // It ends where the user left it: at maximum.
    expect(spies.setVolume).toHaveBeenCalledTimes(2);
    expect(spies.setVolume).toHaveBeenLastCalledWith(1);
    expect(valueOf(slider)).toBe('1');
  });

  test('releases a requested volume the player never reports, on a deadline', async () => {
    const { spies } = renderWithPlayer(<Player.VolumeSlider />, volumeReady());
    const slider = screen.getByRole('slider', { name: 'Volume' });
    spies.setVolume.mockResolvedValue({ ok: true });

    vi.useFakeTimers();
    fireEvent.change(slider, { target: { value: '0.8' } });
    await act(async () => {});
    expect(valueOf(slider)).toBe('0.8');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999);
    });
    expect(valueOf(slider)).toBe('0.8');

    // A player that accepted the command and then published nothing must not
    // strand the thumb on a volume the media never reached.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(valueOf(slider)).toBe('0.5');
    expect(attr(slider, 'aria-valuetext')).toBe('50%');

    vi.useRealTimers();
  });

  test('reconciles to the published volume when the command fails', async () => {
    const { spies } = renderWithPlayer(<Player.VolumeSlider />, volumeReady());
    const slider = screen.getByRole('slider', { name: 'Volume' });
    spies.setVolume.mockResolvedValue({ ok: false, reason: 'provider-error' });

    fireEvent.change(slider, { target: { value: '0.8' } });
    expect(valueOf(slider)).toBe('0.8');

    // No `volumechange` is coming, so there is nothing to wait for.
    await act(async () => {});
    expect(valueOf(slider)).toBe('0.5');
    expect(attr(slider, 'aria-valuetext')).toBe('50%');
  });

  test('gives up on a volume command that never answers, and sets volume again after', async () => {
    const { spies } = renderWithPlayer(<Player.VolumeSlider />, volumeReady());
    const slider = screen.getByRole('slider', { name: 'Volume' });
    // Nothing under this layer has a timeout, and an iframe provider hands
    // back a raw SDK promise: a torn-down frame or a dropped message leaves it
    // unsettled forever.
    spies.setVolume.mockImplementationOnce(
      () => new Promise<CommandResult>(() => {})
    );

    vi.useFakeTimers();
    fireEvent.change(slider, { target: { value: '0.8' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3999);
    });
    expect(valueOf(slider)).toBe('0.8');

    // COMMAND_TIMEOUT_MS. The chain has to drain on this path too, or the
    // thumb keeps a volume the media never reached...
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(valueOf(slider)).toBe('0.5');
    expect(attr(slider, 'aria-valuetext')).toBe('50%');

    // ...and, worse, every later change is swallowed into the pending slot
    // behind a command that will never settle, leaving the volume dead for the
    // rest of the session.
    fireEvent.change(slider, { target: { value: '0.3' } });
    expect(spies.setVolume).toHaveBeenCalledTimes(2);
    expect(spies.setVolume).toHaveBeenLastCalledWith(0.3);
    expect(valueOf(slider)).toBe('0.3');

    vi.useRealTimers();
  });

  test('shows a volume asked for while muted, not the muted zero', () => {
    const { spies } = renderWithPlayer(
      <Player.VolumeSlider />,
      volumeReady({ volume: 0.7, muted: true })
    );
    const slider = screen.getByRole('slider', { name: 'Volume' });
    expect(valueOf(slider)).toBe('0');
    holdNextVolume(spies.setVolume);

    fireEvent.change(slider, { target: { value: '0.5' } });

    // `muted` stays true until the player publishes the unmute, so a thumb
    // still pinned to the muted zero would swallow this drag exactly as a
    // lagging volume does.
    expect(spies.unmute).toHaveBeenCalledTimes(1);
    expect(spies.setVolume).toHaveBeenCalledWith(0.5);
    expect(valueOf(slider)).toBe('0.5');
    expect(attr(slider, 'aria-valuetext')).toBe('50%');
    // The request wins the value, and nothing else: `data-state` still reports
    // the player, which is still muted.
    expect(attr(slider, 'data-state')).toBe('muted');
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
    const slider = container.querySelector(
      '[data-playdeck-part="seek-slider"]'
    );
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

  // The provider stamps every seek it reports `'provider'`; a seek this control
  // asked for is the user's, and the controller is what relabels it (#186).
  test('labels the seek it asks for as a user seek', () => {
    const { controller, emit } = renderWithPlayer(
      <Player.SeekSlider />,
      seekReady()
    );
    const origins: PlayerEventOrigin[] = [];
    controller.on('seeking', (event) => origins.push(event.origin));
    controller.on('seeked', (event) => origins.push(event.origin));

    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), {
      target: { value: '75' }
    });
    emit(
      { seeking: true },
      { type: 'seeking', detail: { currentTime: 75 }, origin: 'provider' }
    );
    emit(
      { seeking: false, currentTime: 75 },
      { type: 'seeked', detail: { currentTime: 75 }, origin: 'provider' }
    );

    expect(origins).toEqual(['user', 'user']);
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
      '[data-playdeck-part="seek-buffered-range"]'
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
        container.querySelector('[data-playdeck-part="seek-slider"]')!,
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
      '[data-playdeck-part="seek-buffered-range"]'
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
        container.querySelector('[data-playdeck-part="seek-slider"]')!,
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
          '[data-playdeck-part="seek-buffered-description"]'
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
        '[data-playdeck-part="seek-buffered-description"]'
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
      container.querySelector(
        '[data-playdeck-part="seek-buffered-description"]'
      )
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
      container.querySelector(
        '[data-playdeck-part="seek-buffered-description"]'
      )
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
      container.querySelector(
        '[data-playdeck-part="seek-buffered-description"]'
      )
    ).toBeNull();
  });

  test('keeps the buffered geometry out of the accessibility tree', () => {
    const { container } = renderWithPlayer(
      <Player.SeekSlider />,
      seekReady({ buffered: [{ start: 0, end: 45 }] })
    );
    const buffered = container.querySelector(
      '[data-playdeck-part="seek-buffered"]'
    )!;
    expect(attr(buffered, 'aria-hidden')).toBe('true');
    // The description is a sibling of the geometry, not a child: inside the
    // hidden subtree it would be unreadable, and every range element stays
    // the empty box it is.
    expect(
      buffered.querySelector('[data-playdeck-part="seek-buffered-description"]')
    ).toBeNull();
    for (const range of container.querySelectorAll(
      '[data-playdeck-part="seek-buffered-range"]'
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
    const root = container.querySelector('[data-playdeck-part="seek-slider"]')!;
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

  type SeekSpy = ReturnType<typeof createMockAdapter>['spies']['seekTo'];

  // Stands in for a provider that has not answered yet: the next seek command
  // hangs until the returned function settles it. The iframe providers this
  // issue is about seek over an asynchronous cross-document bridge, so an
  // unanswered command is the normal case there, not an edge one.
  const holdNextSeek = (seekTo: SeekSpy): (() => void) => {
    // Not a no-op until the command runs: settling one that was never issued
    // means the test did not exercise what it thinks it did.
    let settle = (): void => {
      throw new Error('No seek command is being held.');
    };
    seekTo.mockImplementationOnce(
      () =>
        new Promise<CommandResult>((resolve) => {
          settle = () => resolve({ ok: true });
        })
    );
    return () => settle();
  };

  const valueOf = (slider: Element): string =>
    (slider as HTMLInputElement).value;

  test('coalesces a drag into fewer seek commands than change events', async () => {
    const { spies } = renderWithPlayer(<Player.SeekSlider />, seekReady());
    const slider = screen.getByRole('slider', { name: 'Seek' });
    const settle = holdNextSeek(spies.seekTo);

    for (const position of ['40', '50', '60', '70', '75']) {
      fireEvent.change(slider, { target: { value: position } });
    }
    // The first command is still in flight, so the four positions behind it
    // superseded one another instead of queuing up as four more round trips.
    expect(spies.seekTo).toHaveBeenCalledTimes(1);

    await act(async () => {
      settle();
    });
    // Exactly two: the leading 40, then the one position the four behind it
    // collapsed into. Three or four would mean partial queuing.
    expect(spies.seekTo).toHaveBeenCalledTimes(2);
    expect(spies.seekTo).toHaveBeenLastCalledWith(75);
  });

  test('shows the dragged position while the provider has not echoed it', () => {
    const { spies } = renderWithPlayer(<Player.SeekSlider />, seekReady());
    const slider = screen.getByRole('slider', { name: 'Seek' });
    holdNextSeek(spies.seekTo);

    fireEvent.change(slider, { target: { value: '75' } });

    // Media time is still 30: nothing has reported the seek. The control must
    // show where the user is, not where the media was before the drag.
    expect(valueOf(slider)).toBe('75');
    expect(attr(slider, 'aria-valuetext')).toBe('1:15 of 1:40');
  });

  test('follows media time again once the provider reports the seeked time', async () => {
    const { emit } = renderWithPlayer(<Player.SeekSlider />, seekReady());
    const slider = screen.getByRole('slider', { name: 'Seek' });

    fireEvent.change(slider, { target: { value: '75' } });
    await act(async () => {});
    emit({ currentTime: 75 });
    expect(valueOf(slider)).toBe('75');

    // Player state owns the thumb again: a preview still held here would pin
    // it at 75 while playback ran on.
    emit({ currentTime: 76 });
    expect(valueOf(slider)).toBe('76');
    expect(attr(slider, 'aria-valuetext')).toBe('1:16 of 1:40');
  });

  test('reconciles to media time when the seek fails', async () => {
    const { spies } = renderWithPlayer(<Player.SeekSlider />, seekReady());
    const slider = screen.getByRole('slider', { name: 'Seek' });
    spies.seekTo.mockResolvedValue({ ok: false, reason: 'provider-error' });

    fireEvent.change(slider, { target: { value: '75' } });
    expect(valueOf(slider)).toBe('75');

    // No reported time is coming, so there is nothing to wait for.
    await act(async () => {});
    expect(valueOf(slider)).toBe('30');
    expect(attr(slider, 'aria-valuetext')).toBe('0:30 of 1:40');
  });

  test('reconciles on a deadline when the provider never reports the seek', async () => {
    const { spies } = renderWithPlayer(<Player.SeekSlider />, seekReady());
    const slider = screen.getByRole('slider', { name: 'Seek' });
    spies.seekTo.mockResolvedValue({ ok: true });

    vi.useFakeTimers();
    fireEvent.change(slider, { target: { value: '75' } });
    await act(async () => {});
    expect(valueOf(slider)).toBe('75');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999);
    });
    expect(valueOf(slider)).toBe('75');

    // A provider that accepted the command and then reported nothing must not
    // strand the thumb on a position the media never reached.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(valueOf(slider)).toBe('30');

    vi.useRealTimers();
  });

  test('issues exactly one immediate seek for a single arrow-key press', () => {
    const { spies } = renderWithPlayer(<Player.SeekSlider />, seekReady());
    const slider = screen.getByRole('slider', { name: 'Seek' });
    holdNextSeek(spies.seekTo);

    // A native range control raises one change event for an arrow press and no
    // release event of any kind. happy-dom does not step the value itself, so
    // the step the browser would apply is applied here.
    (slider as HTMLInputElement).focus();
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.change(slider, { target: { value: '31' } });
    fireEvent.keyUp(slider, { key: 'ArrowRight' });

    expect(spies.seekTo).toHaveBeenCalledTimes(1);
    expect(spies.seekTo).toHaveBeenCalledWith(31);
    expect(valueOf(slider)).toBe('31');
    expect(attr(slider, 'aria-valuetext')).toBe('0:31 of 1:40');
  });

  test('clamps a held preview into a live window that has slid past it', () => {
    const { emit, spies } = renderWithPlayer(
      <Player.SeekSlider />,
      liveWindow()
    );
    const slider = screen.getByRole('slider', { name: 'Seek' });
    holdNextSeek(spies.seekTo);

    fireEvent.change(slider, { target: { value: '25' } });
    expect(attr(slider, 'aria-valuetext')).toBe('0:25');

    // The DVR window moved on before the seek was answered. 0:25 is no longer
    // a position the media has.
    emit({ seekable: [{ start: 40, end: 100 }] });
    expect(attr(slider, 'aria-valuetext')).toBe('0:40');
  });

  test('releases a held preview when the seek window disappears', () => {
    const { emit, spies } = renderWithPlayer(
      <Player.SeekSlider />,
      liveWindow()
    );
    const slider = screen.getByRole('slider', { name: 'Seek' });
    holdNextSeek(spies.seekTo);

    fireEvent.change(slider, { target: { value: '25' } });
    expect(attr(slider, 'aria-valuetext')).toBe('0:25');

    emit({ seekable: [] });
    expect(attr(slider, 'aria-valuetext')).toBe('Unavailable');

    // The window came back. A preview held across the gap would name a
    // position in a window that stopped existing while it was outstanding.
    emit({ seekable: [{ start: 20, end: 80 }] });
    expect(attr(slider, 'aria-valuetext')).toBe('0:50');
  });

  test('releases a held preview when the provider is replaced under it', () => {
    const { controller, spies } = renderWithPlayer(
      <Player.SeekSlider />,
      seekReady()
    );
    const slider = screen.getByRole('slider', { name: 'Seek' });
    holdNextSeek(spies.seekTo);

    fireEvent.change(slider, { target: { value: '75' } });
    expect(valueOf(slider)).toBe('75');

    // The source was swapped mid-drag. 1:15 was asked of media that is no
    // longer loaded, and the replacement can never answer for it.
    //
    // Both steps share one `act` on purpose: the component then only ever
    // renders the replacement's ready state, which still has a seek window, so
    // the changed provider is the sole reason the preview goes. Split them and
    // the window-less render in between releases it first, and this passes
    // without the provider ever being compared.
    const replacement = createMockAdapter();
    act(() => {
      controller.setProvider(replacement.adapter);
      replacement.emit({
        lifecycle: 'ready',
        activation: 'ready',
        provider: 'youtube',
        ...seekReady()
      });
    });
    expect(valueOf(slider)).toBe('30');
  });

  test('holds the preview while a command is still outstanding', () => {
    const { emit, spies } = renderWithPlayer(
      <Player.SeekSlider />,
      seekReady()
    );
    const slider = screen.getByRole('slider', { name: 'Seek' });
    holdNextSeek(spies.seekTo);

    fireEvent.change(slider, { target: { value: '31' } });
    // Dragged back to where the media already is, so the reported time now
    // matches the previewed one — but the command for it is queued behind one
    // the provider has not answered, so nothing has answered for this either.
    fireEvent.change(slider, { target: { value: '30' } });
    expect(valueOf(slider)).toBe('30');

    // Playback runs on under the outstanding chain. Reading the match above as
    // an answer would hand the thumb back to media time mid-drag, which is the
    // fighting-the-pointer this preview exists to stop.
    emit({ currentTime: 33 });
    expect(valueOf(slider)).toBe('30');
  });

  test('gives up on a seek command that never answers, and seeks again after', async () => {
    const { spies } = renderWithPlayer(<Player.SeekSlider />, seekReady());
    const slider = screen.getByRole('slider', { name: 'Seek' });
    // Nothing under this layer has a timeout, and an iframe provider hands
    // back a raw SDK promise: a torn-down frame or a dropped message leaves it
    // unsettled forever.
    spies.seekTo.mockImplementationOnce(
      () => new Promise<CommandResult>(() => {})
    );

    vi.useFakeTimers();
    fireEvent.change(slider, { target: { value: '75' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3999);
    });
    expect(valueOf(slider)).toBe('75');

    // COMMAND_TIMEOUT_MS. The chain has to drain on this path too, or the
    // thumb keeps a position the media never reached...
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(valueOf(slider)).toBe('30');

    // ...and, worse, every later change is swallowed into the pending slot
    // behind a command that will never settle, leaving seeking dead for the
    // rest of the session.
    fireEvent.change(slider, { target: { value: '60' } });
    expect(spies.seekTo).toHaveBeenCalledTimes(2);
    expect(spies.seekTo).toHaveBeenLastCalledWith(60);

    vi.useRealTimers();
  });

  test('abandons a queued position when the provider is replaced under it', async () => {
    const { controller, spies } = renderWithPlayer(
      <Player.SeekSlider />,
      seekReady()
    );
    const slider = screen.getByRole('slider', { name: 'Seek' });
    const settle = holdNextSeek(spies.seekTo);

    fireEvent.change(slider, { target: { value: '75' } });
    fireEvent.change(slider, { target: { value: '80' } });

    const replacement = createMockAdapter();
    act(() => {
      controller.setProvider(replacement.adapter);
      replacement.emit({
        lifecycle: 'ready',
        activation: 'ready',
        provider: 'youtube',
        ...seekReady()
      });
    });

    // The first command finally answers and the chain looks for what queued up
    // behind it. 1:20 was chosen on media that is no longer loaded, so issuing
    // it now would scrub a freshly loaded video to a position from the last
    // one.
    await act(async () => {
      settle();
    });
    expect(replacement.spies.seekTo).not.toHaveBeenCalled();
    expect(spies.seekTo).toHaveBeenCalledTimes(1);
  });

  test('abandons a queued position when the seek window disappears under it', async () => {
    const { emit, spies } = renderWithPlayer(
      <Player.SeekSlider />,
      seekReady()
    );
    const slider = screen.getByRole('slider', { name: 'Seek' });
    const settle = holdNextSeek(spies.seekTo);

    fireEvent.change(slider, { target: { value: '75' } });
    fireEvent.change(slider, { target: { value: '80' } });

    // How a swap to another source of the same provider kind shows up: the
    // window goes before the new media reports one of its own, and the
    // provider comparison cannot see a native-to-native change at all.
    emit({ duration: null, seekable: [] });
    await act(async () => {
      settle();
    });
    expect(spies.seekTo).toHaveBeenCalledTimes(1);

    // The new source is ready, and nothing from the old one leaks into it.
    emit({ duration: 200, currentTime: 0 });
    expect(valueOf(slider)).toBe('0');
  });

  test('releases the preview at the drain when the time arrived mid-command', async () => {
    const { emit, spies } = renderWithPlayer(
      <Player.SeekSlider />,
      seekReady()
    );
    const slider = screen.getByRole('slider', { name: 'Seek' });
    const settle = holdNextSeek(spies.seekTo);

    fireEvent.change(slider, { target: { value: '75' } });
    // A provider that publishes the seeked position before it resolves the
    // seek command, which is the ordinary shape of a native `seeked` event
    // beating an awaited promise. Nothing may answer while the chain is
    // outstanding, so this time is correctly ignored on the way in.
    emit({ currentTime: 75 });
    expect(valueOf(slider)).toBe('75');

    await act(async () => {
      settle();
    });

    // Draining the chain has to re-evaluate the echo, because the time that
    // answers this request has already been and gone. A preview still held
    // here pins the thumb at 1:15 while playback runs on, for the whole two
    // seconds until the deadline fires.
    emit({ currentTime: 90 });
    expect(valueOf(slider)).toBe('90');
  });

  // Suspends the first time the player publishes `trap.time`, so the render
  // attempt it takes part in is thrown away. Routine on a concurrent root:
  // `usePlayerState` is a `useSyncExternalStore` over a store that publishes
  // several times a second, and any sibling under the same boundary can
  // suspend after the slider has rendered. Everything the slider did during
  // that attempt goes with it, and React renders it again from the state it
  // last committed — so a preview that answered itself in a discarded attempt
  // must answer itself again in the next one.
  const SuspendOnceAt = ({
    trap
  }: {
    trap: { time: number | null };
  }): ReactNode => {
    const currentTime = Player.usePlayerState((state) => state.currentTime);
    if (trap.time === currentTime) {
      trap.time = null;
      throw Promise.resolve();
    }
    return null;
  };

  test('releases the preview when the render that answered it is discarded', async () => {
    const trap: { time: number | null } = { time: null };
    const { emit, spies } = renderWithPlayer(
      <Suspense fallback={null}>
        <Player.SeekSlider />
        <SuspendOnceAt trap={trap} />
      </Suspense>,
      seekReady()
    );
    const slider = screen.getByRole('slider', { name: 'Seek' });
    spies.seekTo.mockResolvedValue({ ok: true });

    vi.useFakeTimers();
    fireEvent.change(slider, { target: { value: '75' } });
    await act(async () => {});
    expect(valueOf(slider)).toBe('75');

    trap.time = 75;
    await act(async () => {
      emit({ currentTime: 75 });
    });
    // The trap disarms itself as it throws, so a still-armed one means this
    // test never discarded a render and proves nothing.
    expect(trap.time).toBeNull();

    // Playback runs on. A preview released only in whatever the discarded
    // attempt touched, and not in what the slider committed, strands the thumb
    // at 1:15 from here on.
    emit({ currentTime: 90 });
    expect(valueOf(slider)).toBe('90');

    // ...and the deadline is no defence once a discarded attempt has been
    // allowed to disarm it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(valueOf(slider)).toBe('90');

    vi.useRealTimers();
  });
});

describe('Time', () => {
  test('formats the current time by default', () => {
    renderWithPlayer(<Player.Time />, { currentTime: 75, duration: 100 });
    const time = screen.getByText('1:15');
    expect(time.tagName).toBe('TIME');
    expect(attr(time, 'data-playdeck-part')).toBe('time');
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
    expect(attr(button, 'data-playdeck-part')).toBe('fullscreen-button');
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
    expect(attr(button, 'data-playdeck-part')).toBe('pip-button');
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
    expect(attr(button, 'data-playdeck-part')).toBe('airplay-button');
    expect(attr(button, 'data-provider')).toBe('native');
    fireEvent.click(button);
    expect(spies.showAirPlayPicker).toHaveBeenCalledTimes(1);
  });

  // Playdeck does not currently surface an active-route flag (WebKit's
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
    const region = container.querySelector('[data-playdeck-part="controls"]');
    expect(region).not.toBeNull();
  });

  test('exposes stable state and provider attributes', () => {
    const { container } = renderWithPlayer(
      <Player.Controls>
        <Player.PlayButton />
      </Player.Controls>,
      controlsState({ provider: 'native' })
    );
    const region = container.querySelector('[data-playdeck-part="controls"]');
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
    const region = container.querySelector('[data-playdeck-part="controls"]');
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
      '[data-playdeck-part="controls"]'
    )!;
    region.focus();
    fireEvent.keyDown(region, { key: ' ' });
    fireEvent.keyDown(region, { key: 'k' });
    expect(spies.play).toHaveBeenCalledTimes(2);
  });

  test('moves the volume one step per arrow press, collapsing none of them', async () => {
    const { container, spies } = renderWithPlayer(
      <Player.Controls>
        <Player.VolumeSlider />
      </Player.Controls>,
      controlsState()
    );
    const region = container.querySelector<HTMLElement>(
      '[data-playdeck-part="controls"]'
    )!;
    const slider = container.querySelector<HTMLInputElement>(
      '[data-playdeck-part="volume-slider"]'
    )!;
    region.focus();

    // Each press compounds on the volume the press before it asked for, not on
    // a published volume none of them has caught up with — and every press is
    // on the thumb straight away, which is the guarantee that matters to the
    // user. Four presses that all read the same base would collapse into one.
    for (const expected of ['0.55', '0.6', '0.65', '0.7']) {
      fireEvent.keyDown(region, { key: 'ArrowUp' });
      expect(slider.value).toBe(expected);
    }
    // One command so far: the three behind the first superseded one another.
    // Fewer commands than presses is coalescing, and the rendered values above
    // are what prove no press was lost.
    expect(spies.setVolume).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(spies.setVolume.mock.calls).toEqual([[0.55], [0.7]]);

    // Clamped at the top, and clamping is not a reason to stop showing where
    // the user is.
    for (let press = 0; press < 8; press += 1) {
      fireEvent.keyDown(region, { key: 'ArrowUp' });
    }
    expect(slider.value).toBe('1');
    expect(attr(slider, 'aria-valuetext')).toBe('100%');
  });

  test('reconciles the volume request while no volume slider is mounted', async () => {
    const { container, emit, spies } = renderWithPlayer(
      <Player.Controls>
        <Player.Time />
      </Player.Controls>,
      controlsState()
    );
    const region = container.querySelector<HTMLElement>(
      '[data-playdeck-part="controls"]'
    )!;
    region.focus();

    // `VolumeSlider` is an optional primitive and the shortcut layer runs
    // without it, so nothing a control renders can be what holds or releases
    // the request. This is the case that makes it player-scoped.
    fireEvent.keyDown(region, { key: 'ArrowUp' });
    fireEvent.keyDown(region, { key: 'ArrowUp' });
    await act(async () => {});
    expect(spies.setVolume.mock.calls).toEqual([[0.55], [0.6]]);

    // The player answers the request, and then the volume moves again from
    // somewhere else entirely. The next press has to compound on published
    // state, which only happens if the request was released with no control
    // mounted to release it.
    emit({ volume: 0.6 });
    emit({ volume: 0.8 });
    fireEvent.keyDown(region, { key: 'ArrowUp' });
    expect(spies.setVolume).toHaveBeenLastCalledWith(0.85);
  });

  // ADR-0005 takes the arrow keys off the scrubber's range input and gives them
  // to this layer, so a keyboard seek is the same person seeking that a drag
  // is. It carries the same origin (#186).
  test('labels a keyboard seek as a user seek', () => {
    const { container, controller, emit } = renderWithPlayer(
      <Player.Controls>
        <Player.Time />
      </Player.Controls>,
      controlsState()
    );
    const region = container.querySelector<HTMLElement>(
      '[data-playdeck-part="controls"]'
    )!;
    const origins: PlayerEventOrigin[] = [];
    controller.on('seeking', (event) => origins.push(event.origin));
    controller.on('seeked', (event) => origins.push(event.origin));
    region.focus();

    fireEvent.keyDown(region, { key: 'ArrowRight' });
    emit(
      { seeking: true },
      { type: 'seeking', detail: { currentTime: 35 }, origin: 'provider' }
    );
    emit(
      { seeking: false, currentTime: 35 },
      { type: 'seeked', detail: { currentTime: 35 }, origin: 'provider' }
    );

    expect(origins).toEqual(['user', 'user']);
  });

  test('arrows seek and change volume; J/L seek; M mutes; F toggles fullscreen', async () => {
    const { container, spies } = renderWithPlayer(
      <Player.Controls>
        <Player.Time />
      </Player.Controls>,
      controlsState()
    );
    const region = container.querySelector<HTMLElement>(
      '[data-playdeck-part="controls"]'
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
    // 0.5, not the 0.45 this asserted before #271: the second press compounds
    // on the volume the first one asked for rather than on a published volume
    // that has not caught up, so up-then-down returns the user to where they
    // started instead of leaving them below it. It also coalesces behind the
    // command still in flight, so it is issued when that one drains.
    await act(async () => {});
    expect(spies.setVolume).toHaveBeenLastCalledWith(0.5);
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
      '[data-playdeck-part="controls"]'
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

  test('owns the arrow keys on a focused slider instead of its native stepping', async () => {
    const { container, spies } = renderWithPlayer(
      <Player.Controls>
        <Player.SeekSlider />
        <Player.VolumeSlider />
      </Player.Controls>,
      controlsState()
    );
    const seekInput = container.querySelector<HTMLInputElement>(
      '[data-playdeck-part="seek-slider-input"]'
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
      '[data-playdeck-part="volume-slider"]'
    )!;
    volumeInput.focus();
    expect(fireEvent.keyDown(volumeInput, { key: 'ArrowDown' })).toBe(false);
    // 0.5, not the 0.45 this asserted before #271: the press compounds on the
    // volume the ArrowUp above asked for rather than on a published volume that
    // has not caught up, and coalesces behind the command still in flight.
    await act(async () => {});
    expect(spies.setVolume).toHaveBeenLastCalledWith(0.5);
    // The thumb tracks both presses, whichever control had focus for them.
    expect(volumeInput.value).toBe('0.5');
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
      '[data-playdeck-part="controls"]'
    )!;
    const seekInput = container.querySelector<HTMLInputElement>(
      '[data-playdeck-part="seek-slider-input"]'
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

  test('runs every shortcut in the map while the seek slider has focus', async () => {
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
      '[data-playdeck-part="seek-slider-input"]'
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
    // 0.5, not the 0.45 this asserted before #271: the second press compounds
    // on the volume the first one asked for, and coalesces behind the command
    // still in flight.
    await act(async () => {});
    expect(spies.setVolume).toHaveBeenLastCalledWith(0.5);
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

  test('page up and page down jump ten seconds, the slider included', () => {
    const { container, spies } = renderWithPlayer(
      <Player.Controls>
        <Player.SeekSlider />
      </Player.Controls>,
      controlsState()
    );
    const region = container.querySelector<HTMLElement>(
      '[data-playdeck-part="controls"]'
    )!;
    region.focus();
    expect(fireEvent.keyDown(region, { key: 'PageUp' })).toBe(false);
    expect(spies.seekBy).toHaveBeenLastCalledWith(10);
    expect(fireEvent.keyDown(region, { key: 'PageDown' })).toBe(false);
    expect(spies.seekBy).toHaveBeenLastCalledWith(-10);
    // The range input is the one target that pages natively, so this is where
    // the jump is the library's number only if preventDefault fires.
    const seekInput = container.querySelector<HTMLInputElement>(
      '[data-playdeck-part="seek-slider-input"]'
    )!;
    seekInput.focus();
    expect(fireEvent.keyDown(seekInput, { key: 'PageUp' })).toBe(false);
    expect(fireEvent.keyDown(seekInput, { key: 'PageDown' })).toBe(false);
    // One call per press, the same jump from either focus position.
    expect(spies.seekBy.mock.calls).toEqual([[10], [-10], [10], [-10]]);
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
      '[data-playdeck-part="controls"]'
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
      '[data-playdeck-part="controls"]'
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
      '[data-playdeck-part="controls"]'
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
      '[data-playdeck-part="controls"]'
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
      '[data-playdeck-part="controls"]'
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
      '[data-playdeck-part="controls"]'
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
      '[data-playdeck-part="controls"]'
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
      '[data-playdeck-part="controls"]'
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
      '[data-playdeck-part="controls"]'
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
      '[data-playdeck-part="controls"]'
    )!;
    expect(document.activeElement).toBe(document.body);
    expect(document.activeElement).not.toBe(region);
  });
});
