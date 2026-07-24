// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createRef, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
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

  test('renders on the server without throwing', () => {
    const markup = renderToString(
      <Player.Root source="/server.mp4">
        <Player.Viewport>
          <Player.Media />
          <Probe />
          <Player.Captions />
        </Player.Viewport>
      </Player.Root>
    );
    expect(markup).toContain('data-testid="cues"');
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

  // Real usage attaches the provider asynchronously (`await loadProvider(...)`
  // in use-activation.ts), which runs well after Root's mount effects have
  // already called `controller.setCaptionRenderer`. Attaching here via a
  // separate `act()` call after render — rather than the ref callback above —
  // reproduces that ordering: no provider exists yet when the mount effect
  // fires.
  test('still applies captionRenderer="native" when the provider attaches after mount', () => {
    const handle = createRef<Player.PlayerHandle>();
    const setCaptionRenderer = vi.fn();
    const adapter: ProviderAdapter = {
      provider: 'native',
      attach: () => {},
      load: () => {},
      destroy: () => {},
      subscribe: () => () => {},
      setCaptionRenderer
    };
    render(
      <Player.Root
        captionRenderer="native"
        loading="interaction"
        ref={handle}
        source="/tracer.mp4"
      >
        {null}
      </Player.Root>
    );
    const controller = handle.current as unknown as PlayerController;
    act(() => {
      controller.setProvider(adapter);
    });
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
    // The accessible name states the action, not the state, like every other
    // toggle in the package ('Play'/'Pause', 'Mute'/'Unmute', ...).
    expect(button?.getAttribute('aria-label')).toBe('Enable captions');

    emitState({ selectedTextTrackId: 'en' });
    expect(button?.getAttribute('data-state')).toBe('on');
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(button?.getAttribute('aria-label')).toBe('Disable captions');
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

  test('toggling off then on restores the previously selected non-first track', () => {
    const { container, emitState, selectTextTrack } = renderWithPlayer(
      <Player.CaptionsButton />
    );
    emitState({
      capabilities: withSelectTextTrack(available),
      textTracks: [track('en', 'English'), track('es', 'Spanish')],
      selectedTextTrackId: 'es'
    });
    const button = container.querySelector(
      '[data-reely-part="captions-button"]'
    ) as HTMLButtonElement;
    fireEvent.click(button);
    expect(selectTextTrack).toHaveBeenCalledWith(null);
    emitState({ selectedTextTrackId: null });
    fireEvent.click(button);
    expect(selectTextTrack).toHaveBeenCalledWith('es');
  });

  test('falls back to the first track of a new list when the remembered track no longer exists', () => {
    const { container, emitState, selectTextTrack } = renderWithPlayer(
      <Player.CaptionsButton />
    );
    emitState({
      capabilities: withSelectTextTrack(available),
      textTracks: [track('en', 'English'), track('es', 'Spanish')],
      selectedTextTrackId: 'es'
    });
    const button = container.querySelector(
      '[data-reely-part="captions-button"]'
    ) as HTMLButtonElement;
    fireEvent.click(button);
    expect(selectTextTrack).toHaveBeenCalledWith(null);
    emitState({
      selectedTextTrackId: null,
      textTracks: [track('fr', 'French'), track('de', 'German')]
    });
    fireEvent.click(button);
    expect(selectTextTrack).toHaveBeenCalledWith('fr');
  });
});

describe('Player.CaptionsButton announcer', () => {
  const announcerText = (container: HTMLElement) =>
    container.querySelector('[data-reely-part="captions-announcer"]')
      ?.textContent;

  test('announces "<label> captions on" once when a track becomes selected', () => {
    const { container, emitState } = renderWithPlayer(
      <Player.CaptionsButton />
    );
    emitState({
      capabilities: withSelectTextTrack(available),
      textTracks: [track('en', 'English')],
      selectedTextTrackId: null
    });
    expect(announcerText(container)).toBe('');
    emitState({ selectedTextTrackId: 'en' });
    expect(announcerText(container)).toBe('English captions on');
  });

  test('announces "Captions off" once when the selection is cleared', () => {
    const { container, emitState } = renderWithPlayer(
      <Player.CaptionsButton />
    );
    emitState({
      capabilities: withSelectTextTrack(available),
      textTracks: [track('en', 'English')],
      selectedTextTrackId: null
    });
    emitState({ selectedTextTrackId: 'en' });
    expect(announcerText(container)).toBe('English captions on');
    emitState({ selectedTextTrackId: null });
    expect(announcerText(container)).toBe('Captions off');
  });

  test('does not re-announce when the selection is unchanged', () => {
    const { container, emitState } = renderWithPlayer(
      <Player.CaptionsButton />
    );
    emitState({
      capabilities: withSelectTextTrack(available),
      textTracks: [track('en', 'English')],
      selectedTextTrackId: null
    });
    emitState({ selectedTextTrackId: 'en' });
    expect(announcerText(container)).toBe('English captions on');
    emitState({ selectedTextTrackId: 'en' });
    expect(announcerText(container)).toBe('English captions on');
  });

  test('exposes the announcer as aria-live="polite"', () => {
    const { container, emitState } = renderWithPlayer(
      <Player.CaptionsButton />
    );
    emitState({ capabilities: withSelectTextTrack(available) });
    const announcer = container.querySelector(
      '[data-reely-part="captions-announcer"]'
    );
    expect(announcer?.getAttribute('aria-live')).toBe('polite');
  });
});

describe('Player.Controls captions shortcut', () => {
  test('pressing "c" turns captions off when a track is selected', () => {
    const { container, emitState, selectTextTrack } = renderWithPlayer(
      <Player.Controls>
        <Player.Time />
      </Player.Controls>
    );
    emitState({
      capabilities: withSelectTextTrack(available),
      textTracks: [track('en', 'English')],
      selectedTextTrackId: 'en'
    });
    const region = container.querySelector<HTMLElement>(
      '[data-reely-part="controls"]'
    )!;
    region.focus();
    fireEvent.keyDown(region, { key: 'c' });
    expect(selectTextTrack).toHaveBeenCalledWith(null);
  });

  test('pressing "C" selects a track when none is selected', () => {
    const { container, emitState, selectTextTrack } = renderWithPlayer(
      <Player.Controls>
        <Player.Time />
      </Player.Controls>
    );
    emitState({
      capabilities: withSelectTextTrack(available),
      textTracks: [track('en', 'English'), track('es', 'Spanish')],
      selectedTextTrackId: null
    });
    const region = container.querySelector<HTMLElement>(
      '[data-reely-part="controls"]'
    )!;
    region.focus();
    fireEvent.keyDown(region, { key: 'C' });
    expect(selectTextTrack).toHaveBeenCalledWith('en');
  });

  test('does nothing when the selectTextTrack capability is unavailable', () => {
    const { container, emitState, selectTextTrack } = renderWithPlayer(
      <Player.Controls>
        <Player.Time />
      </Player.Controls>
    );
    emitState({
      capabilities: withSelectTextTrack(notReadyAvailability),
      textTracks: [track('en', 'English')],
      selectedTextTrackId: null
    });
    const region = container.querySelector<HTMLElement>(
      '[data-reely-part="controls"]'
    )!;
    region.focus();
    fireEvent.keyDown(region, { key: 'c' });
    expect(selectTextTrack).not.toHaveBeenCalled();
  });

  test('ignores the shortcut while an open menu has focus', () => {
    const { container, emitState, selectTextTrack } = renderWithPlayer(
      <Player.Controls>
        <div role="menu">
          <button role="menuitem" type="button">
            item
          </button>
        </div>
      </Player.Controls>
    );
    emitState({
      capabilities: withSelectTextTrack(available),
      textTracks: [track('en', 'English')],
      selectedTextTrackId: 'en'
    });
    const item = container.querySelector<HTMLElement>('[role="menuitem"]')!;
    item.focus();
    fireEvent.keyDown(item, { key: 'c' });
    expect(selectTextTrack).not.toHaveBeenCalled();
  });

  test('ignores the shortcut while an editable target is focused', () => {
    const { container, emitState, selectTextTrack } = renderWithPlayer(
      <Player.Controls>
        <input aria-label="note" />
      </Player.Controls>
    );
    emitState({
      capabilities: withSelectTextTrack(available),
      textTracks: [track('en', 'English')],
      selectedTextTrackId: 'en'
    });
    const input = container.querySelector('input')!;
    input.focus();
    fireEvent.keyDown(input, { key: 'c' });
    expect(selectTextTrack).not.toHaveBeenCalled();
  });
});

describe('Player.Media textTracks', () => {
  const renderMedia = (props?: Player.MediaProps) => {
    const utils = render(
      <Player.Root loading="eager" source="/tracer.mp4">
        <Player.Media {...props} />
      </Player.Root>
    );
    const video = utils.container.querySelector('video') as HTMLVideoElement;
    return { ...utils, video };
  };

  test('renders a <track> per entry with correct src, srclang, label, and kind', () => {
    const { video } = renderMedia({
      textTracks: [
        {
          src: '/captions/en.vtt',
          srcLang: 'en',
          label: 'English',
          kind: 'subtitles'
        }
      ]
    });
    const tracks = video.querySelectorAll('track');
    expect(tracks.length).toBe(1);
    expect(tracks[0]?.getAttribute('src')).toBe('/captions/en.vtt');
    expect(tracks[0]?.getAttribute('srclang')).toBe('en');
    expect(tracks[0]?.getAttribute('label')).toBe('English');
    expect(tracks[0]?.getAttribute('kind')).toBe('subtitles');
  });

  test('defaults kind to "captions" when omitted', () => {
    const { video } = renderMedia({
      textTracks: [{ src: '/captions/en.vtt', srcLang: 'en', label: 'English' }]
    });
    const track = video.querySelector('track');
    expect(track?.getAttribute('kind')).toBe('captions');
  });

  test('sets the default attribute when default is true, and omits it otherwise', () => {
    const { video } = renderMedia({
      textTracks: [
        {
          src: '/captions/en.vtt',
          srcLang: 'en',
          label: 'English',
          default: true
        },
        { src: '/captions/es.vtt', srcLang: 'es', label: 'Spanish' }
      ]
    });
    const tracks = video.querySelectorAll('track');
    expect(tracks[0]?.hasAttribute('default')).toBe(true);
    expect(tracks[1]?.hasAttribute('default')).toBe(false);
  });

  test('renders no <track> elements when textTracks is omitted', () => {
    const { video } = renderMedia();
    expect(video.querySelectorAll('track').length).toBe(0);
  });

  test('does not leak textTracks onto the <video> element as a DOM attribute', () => {
    const { video } = renderMedia({
      textTracks: [{ src: '/captions/en.vtt', srcLang: 'en', label: 'English' }]
    });
    expect(video.hasAttribute('texttracks')).toBe(false);
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
