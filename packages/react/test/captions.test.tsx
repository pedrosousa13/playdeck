// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createRef, type ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  PlayerController,
  type Availability,
  type CommandResult,
  type PlayerCapabilities,
  type ProviderAdapter,
  type ProviderStateListener,
  type ProviderStatePatch,
  type TextCue,
  type TextTrack
} from '@reely/core';
import * as Player from '../src/index';

const ok = async () => ({ ok: true as const });

const createMockAdapter = () => {
  let cueListener: ((cues: readonly TextCue[]) => void) | undefined;
  let stateListener: ProviderStateListener | undefined;
  const selectTextTrack = vi.fn(async (): Promise<CommandResult> => ({
    ok: true
  }));
  const adapter: ProviderAdapter = {
    provider: 'native',
    attach: () => {},
    load: () => {},
    destroy: () => {},
    subscribe: (listener) => {
      stateListener = listener;
      return () => {
        stateListener = undefined;
      };
    },
    play: ok,
    pause: ok,
    selectTextTrack,
    subscribeCues: (listener) => {
      cueListener = listener;
      return () => {
        cueListener = undefined;
      };
    }
  };
  return {
    adapter,
    selectTextTrack,
    emitCues: (cues: readonly TextCue[]) => cueListener?.(cues),
    emitState: (patch: ProviderStatePatch) => stateListener?.(patch)
  };
};

const renderWithPlayer = (ui: ReactNode) => {
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
  });
  return {
    ...utils,
    controller,
    selectTextTrack: mock.selectTextTrack,
    emitCues: (cues: readonly TextCue[]) => act(() => mock.emitCues(cues)),
    emitState: (patch: ProviderStatePatch) => act(() => mock.emitState(patch))
  };
};

const notReadyAvailability: Availability = {
  status: 'unknown',
  reason: 'not-ready'
};
const available: Availability = { status: 'available' };

const withSelectTextTrack = (status: Availability): PlayerCapabilities => ({
  seek: notReadyAvailability,
  setVolume: notReadyAvailability,
  setPlaybackRate: notReadyAvailability,
  selectQuality: notReadyAvailability,
  selectTextTrack: status,
  fullscreen: notReadyAvailability,
  pictureInPicture: notReadyAvailability,
  airPlay: notReadyAvailability,
  customControls: notReadyAvailability
});

const track = (
  id: string,
  label: string,
  language: string | null = null
): TextTrack => ({
  id,
  label,
  language,
  kind: 'subtitles',
  readiness: 'loaded'
});

const Probe = () => {
  const cues = Player.useActiveCues();
  return <div data-testid="cues">{cues.map((c) => c.text).join('|')}</div>;
};

afterEach(() => {
  cleanup();
});

describe('useActiveCues', () => {
  test('starts empty before any cue is emitted', () => {
    const { getByTestId } = renderWithPlayer(<Probe />);
    expect(getByTestId('cues').textContent).toBe('');
  });

  test('re-renders with active cues emitted by the provider', () => {
    const { getByTestId, emitCues } = renderWithPlayer(<Probe />);
    emitCues([
      { id: 'c1', startTime: 0, endTime: 1, text: 'hello' },
      { id: 'c2', startTime: 1, endTime: 2, text: 'world' }
    ]);
    expect(getByTestId('cues').textContent).toBe('hello|world');
  });
});

describe('Player.Captions', () => {
  test('renders the captions overlay with cue text only when captionRendering is custom', () => {
    const { container, emitState, emitCues } = renderWithPlayer(
      <Player.Captions />
    );
    emitState({ captionRendering: 'custom' });
    emitCues([{ id: 'c1', startTime: 0, endTime: 1, text: 'hello there' }]);
    const overlay = container.querySelector('[data-reely-part="captions"]');
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute('data-state')).toBe('custom');
    expect(overlay?.textContent).toBe('hello there');
  });

  test.each(['native', 'provider', 'unavailable'] as const)(
    'renders nothing when captionRendering is %s',
    (mode) => {
      const { container, emitState, emitCues } = renderWithPlayer(
        <Player.Captions />
      );
      emitState({ captionRendering: mode });
      emitCues([{ id: 'c1', startTime: 0, endTime: 1, text: 'hello there' }]);
      expect(container.querySelector('[data-reely-part="captions"]')).toBe(
        null
      );
    }
  );

  test('renders a multi-line cue as separate lines', () => {
    const { container, emitState, emitCues } = renderWithPlayer(
      <Player.Captions />
    );
    emitState({ captionRendering: 'custom' });
    emitCues([
      { id: 'c1', startTime: 0, endTime: 1, text: 'line one\nline two' }
    ]);
    const lines = container.querySelectorAll(
      '[data-reely-part="caption-line"]'
    );
    expect(lines.length).toBe(2);
    expect(lines[0]?.textContent).toBe('line one');
    expect(lines[1]?.textContent).toBe('line two');
  });

  test('renderCue replaces default rendering and receives a normalized TextCue', () => {
    const received: TextCue[] = [];
    const { container, emitState, emitCues } = renderWithPlayer(
      <Player.Captions
        renderCue={(cue) => {
          received.push(cue);
          return <span data-testid="custom-cue">{cue.text.toUpperCase()}</span>;
        }}
      />
    );
    emitState({ captionRendering: 'custom' });
    emitCues([{ id: 'c1', startTime: 0, endTime: 1, text: 'hello' }]);
    expect(
      container.querySelector('[data-testid="custom-cue"]')?.textContent
    ).toBe('HELLO');
    expect(received.length).toBe(1);
    expect(Object.keys(received[0] as object).sort()).toEqual(
      ['endTime', 'id', 'startTime', 'text'].sort()
    );
  });

  test('has no aria-live attribute on the overlay', () => {
    const { container, emitState, emitCues } = renderWithPlayer(
      <Player.Captions />
    );
    emitState({ captionRendering: 'custom' });
    emitCues([{ id: 'c1', startTime: 0, endTime: 1, text: 'hello there' }]);
    const overlay = container.querySelector('[data-reely-part="captions"]');
    expect(overlay?.hasAttribute('aria-live')).toBe(false);
  });

  test('skips empty or whitespace-only cues without rendering an empty box', () => {
    const { container, emitState, emitCues } = renderWithPlayer(
      <Player.Captions />
    );
    emitState({ captionRendering: 'custom' });
    emitCues([
      { id: 'c1', startTime: 0, endTime: 1, text: '   ' },
      { id: 'c2', startTime: 1, endTime: 2, text: '' },
      { id: 'c3', startTime: 2, endTime: 3, text: 'real cue' }
    ]);
    const cues = container.querySelectorAll('[data-reely-part="caption-cue"]');
    expect(cues.length).toBe(1);
    expect(cues[0]?.textContent).toBe('real cue');
  });

  test('passes through className, style, and ref', () => {
    const ref = createRef<HTMLDivElement>();
    const { container, emitState } = renderWithPlayer(
      <Player.Captions
        className="my-captions"
        ref={ref}
        style={{ color: 'red' }}
      />
    );
    emitState({ captionRendering: 'custom' });
    const overlay = container.querySelector('[data-reely-part="captions"]');
    expect(overlay?.classList.contains('my-captions')).toBe(true);
    expect((overlay as HTMLElement | null)?.style.color).toBe('red');
    expect(ref.current).toBe(overlay);
  });
});

describe('Player.Root captionRenderer', () => {
  // The provider is attached from the ref callback so it is in place before
  // Root's mount effects run (ref attachment is a layout effect, which
  // commits before passive effects), making the mount-time call observable.
  const renderWithCaptionSpy = (captionRenderer?: 'custom' | 'native') => {
    const setCaptionRenderer = vi.fn();
    const adapter: ProviderAdapter = {
      provider: 'native',
      attach: () => {},
      load: () => {},
      destroy: () => {},
      subscribe: () => () => {},
      setCaptionRenderer
    };
    const attachProvider = (instance: Player.PlayerHandle | null) => {
      (instance as unknown as PlayerController | null)?.setProvider(adapter);
    };
    const utils = render(
      <Player.Root
        captionRenderer={captionRenderer}
        loading="interaction"
        ref={attachProvider}
        source="/tracer.mp4"
      >
        {null}
      </Player.Root>
    );
    return {
      ...utils,
      setCaptionRenderer,
      rerenderWithCaptionRenderer: (next?: 'custom' | 'native') =>
        utils.rerender(
          <Player.Root
            captionRenderer={next}
            loading="interaction"
            ref={attachProvider}
            source="/tracer.mp4"
          >
            {null}
          </Player.Root>
        )
    };
  };

  test('calls setCaptionRenderer with "native" when captionRenderer="native"', () => {
    const { setCaptionRenderer } = renderWithCaptionSpy('native');
    expect(setCaptionRenderer).toHaveBeenCalledWith('native');
  });

  test('defaults to "custom" when captionRenderer is omitted', () => {
    const { setCaptionRenderer } = renderWithCaptionSpy(undefined);
    expect(setCaptionRenderer).toHaveBeenCalledWith('custom');
  });

  test('re-calls setCaptionRenderer when the prop changes', () => {
    const { rerenderWithCaptionRenderer, setCaptionRenderer } =
      renderWithCaptionSpy('custom');
    expect(setCaptionRenderer).toHaveBeenCalledWith('custom');
    setCaptionRenderer.mockClear();
    rerenderWithCaptionRenderer('native');
    expect(setCaptionRenderer).toHaveBeenCalledWith('native');
  });
});

describe('Player.CaptionsButton', () => {
  test('renders nothing when the selectTextTrack capability is not available', () => {
    const { container } = renderWithPlayer(<Player.CaptionsButton />);
    expect(container.querySelector('[data-reely-part="captions-button"]')).toBe(
      null
    );
  });

  test('data-state reflects on/off from selectedTextTrackId', () => {
    const { container, emitState } = renderWithPlayer(
      <Player.CaptionsButton />
    );
    emitState({
      capabilities: withSelectTextTrack(available),
      textTracks: [track('en', 'English')],
      selectedTextTrackId: null
    });
    const button = container.querySelector(
      '[data-reely-part="captions-button"]'
    );
    expect(button?.getAttribute('data-state')).toBe('off');
    expect(button?.getAttribute('aria-pressed')).toBe('false');

    emitState({ selectedTextTrackId: 'en' });
    expect(button?.getAttribute('data-state')).toBe('on');
    expect(button?.getAttribute('aria-pressed')).toBe('true');
  });

  test('clicking turns captions off when a track is selected', () => {
    const { container, emitState, selectTextTrack } = renderWithPlayer(
      <Player.CaptionsButton />
    );
    emitState({
      capabilities: withSelectTextTrack(available),
      textTracks: [track('en', 'English')],
      selectedTextTrackId: 'en'
    });
    const button = container.querySelector(
      '[data-reely-part="captions-button"]'
    ) as HTMLButtonElement;
    fireEvent.click(button);
    expect(selectTextTrack).toHaveBeenCalledWith(null);
  });

  test('clicking turns captions on by selecting a track when none is selected', () => {
    const { container, emitState, selectTextTrack } = renderWithPlayer(
      <Player.CaptionsButton />
    );
    emitState({
      capabilities: withSelectTextTrack(available),
      textTracks: [track('en', 'English'), track('es', 'Spanish')],
      selectedTextTrackId: null
    });
    const button = container.querySelector(
      '[data-reely-part="captions-button"]'
    ) as HTMLButtonElement;
    fireEvent.click(button);
    expect(selectTextTrack).toHaveBeenCalledWith('en');
  });
});

describe('Player.CaptionsMenu', () => {
  test('renders nothing when there are no tracks', () => {
    const { container, emitState } = renderWithPlayer(<Player.CaptionsMenu />);
    emitState({
      capabilities: withSelectTextTrack(available),
      textTracks: []
    });
    expect(
      container.querySelector('[data-reely-part="settings-menu-root"]')
    ).toBe(null);
  });

  test('lists each track plus Off as menuitemradio with aria-checked reflecting selection', () => {
    const { container, emitState } = renderWithPlayer(<Player.CaptionsMenu />);
    emitState({
      capabilities: withSelectTextTrack(available),
      textTracks: [track('en', 'English'), track('es', 'Spanish')],
      selectedTextTrackId: 'en'
    });
    const trigger = container.querySelector(
      '[data-reely-part="settings-menu-trigger"]'
    ) as HTMLButtonElement;
    fireEvent.click(trigger);
    const items = Array.from(
      container.querySelectorAll('[role="menuitemradio"]')
    );
    expect(items.map((item) => item.textContent)).toEqual([
      'Off',
      'English',
      'Spanish'
    ]);
    const off = items.find((item) => item.textContent === 'Off');
    const english = items.find((item) => item.textContent === 'English');
    const spanish = items.find((item) => item.textContent === 'Spanish');
    expect(off?.getAttribute('aria-checked')).toBe('false');
    expect(english?.getAttribute('aria-checked')).toBe('true');
    expect(spanish?.getAttribute('aria-checked')).toBe('false');
  });

  test('selecting a track calls controller.selectTextTrack with its id', () => {
    const { container, emitState, selectTextTrack } = renderWithPlayer(
      <Player.CaptionsMenu />
    );
    emitState({
      capabilities: withSelectTextTrack(available),
      textTracks: [track('en', 'English'), track('es', 'Spanish')],
      selectedTextTrackId: 'en'
    });
    fireEvent.click(
      container.querySelector(
        '[data-reely-part="settings-menu-trigger"]'
      ) as HTMLButtonElement
    );
    const spanish = Array.from(
      container.querySelectorAll('[role="menuitemradio"]')
    ).find((item) => item.textContent === 'Spanish') as HTMLButtonElement;
    fireEvent.click(spanish);
    expect(selectTextTrack).toHaveBeenCalledWith('es');
  });

  test('selecting Off calls controller.selectTextTrack with null', () => {
    const { container, emitState, selectTextTrack } = renderWithPlayer(
      <Player.CaptionsMenu />
    );
    emitState({
      capabilities: withSelectTextTrack(available),
      textTracks: [track('en', 'English')],
      selectedTextTrackId: 'en'
    });
    fireEvent.click(
      container.querySelector(
        '[data-reely-part="settings-menu-trigger"]'
      ) as HTMLButtonElement
    );
    const off = Array.from(
      container.querySelectorAll('[role="menuitemradio"]')
    ).find((item) => item.textContent === 'Off') as HTMLButtonElement;
    fireEvent.click(off);
    expect(selectTextTrack).toHaveBeenCalledWith(null);
  });
});
