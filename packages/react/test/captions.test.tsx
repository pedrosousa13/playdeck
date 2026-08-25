// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createRef, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  type Availability,
  type CommandResult,
  type PlayerCapabilities,
  type ProviderAdapter,
  type ProviderStateListener,
  type ProviderStatePatch,
  type TextCue,
  type TextTrack
} from '@playdeck/core';
import {
  INTERNAL_CONTROLLER,
  type InternalControllerAccess
} from '../src/internal-controller';
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
  const controller = (handle.current as unknown as InternalControllerAccess)[
    INTERNAL_CONTROLLER
  ];
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
  chapters: notReadyAvailability,
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
    const overlay = container.querySelector('[data-playdeck-part="captions"]');
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
      expect(container.querySelector('[data-playdeck-part="captions"]')).toBe(
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
      '[data-playdeck-part="caption-line"]'
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
    // Carries engine-only fields, the way a real provider's cue object does
    // (hls.js hands over its own parsed cue, the native engine a VTTCue). The
    // assertion below only means anything against a cue that has something to
    // strip: with a fixture holding exactly the four public fields it passed
    // whether `normalizeCue` copied or returned the cue untouched (#101).
    emitCues([
      {
        id: 'c1',
        startTime: 0,
        endTime: 1,
        text: 'hello',
        line: 'auto',
        align: 'center',
        getCueAsHTML: () => undefined
      } as unknown as TextCue
    ]);
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
    const overlay = container.querySelector('[data-playdeck-part="captions"]');
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
    const cues = container.querySelectorAll(
      '[data-playdeck-part="caption-cue"]'
    );
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
    const overlay = container.querySelector('[data-playdeck-part="captions"]');
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
      if (!instance) return;
      (instance as unknown as InternalControllerAccess)[
        INTERNAL_CONTROLLER
      ].setProvider(adapter);
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
    const controller = (handle.current as unknown as InternalControllerAccess)[
      INTERNAL_CONTROLLER
    ];
    act(() => {
      controller.setProvider(adapter);
    });
    expect(setCaptionRenderer).toHaveBeenCalledWith('native');
  });
});

describe('Player.CaptionsButton', () => {
  test('renders nothing when the selectTextTrack capability is not available', () => {
    const { container } = renderWithPlayer(<Player.CaptionsButton />);
    expect(
      container.querySelector('[data-playdeck-part="captions-button"]')
    ).toBe(null);
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
      '[data-playdeck-part="captions-button"]'
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

  // The consumer spread sat above the literal label, so React's later-wins rule
  // discarded a consumer name (#446). Both directions are pinned, because the
  // consumer-name half alone would still pass against a control that had
  // stopped labelling itself at all.
  test('honours a consumer aria-label in both caption states', () => {
    const { container, emitState } = renderWithPlayer(
      <Player.CaptionsButton aria-label="Subtítulos" />
    );
    emitState({
      capabilities: withSelectTextTrack(available),
      textTracks: [track('en', 'English')],
      selectedTextTrackId: null
    });
    const button = container.querySelector(
      '[data-playdeck-part="captions-button"]'
    );
    expect(button?.getAttribute('aria-label')).toBe('Subtítulos');

    // One name, taken ownership of, held across the toggle rather than
    // reasserted as 'Disable captions' in the other state.
    emitState({ selectedTextTrackId: 'en' });
    expect(button?.getAttribute('aria-label')).toBe('Subtítulos');
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
      '[data-playdeck-part="captions-button"]'
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
      '[data-playdeck-part="captions-button"]'
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
      '[data-playdeck-part="captions-button"]'
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
      '[data-playdeck-part="captions-button"]'
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
    container.querySelector('[data-playdeck-part="captions-announcer"]')
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
      '[data-playdeck-part="captions-announcer"]'
    );
    expect(announcer?.getAttribute('aria-live')).toBe('polite');
  });
});

describe('captions toggle memory is player-scoped', () => {
  // #58: CaptionsButton and the Controls "C" shortcut each kept their own ref
  // for the last non-null selection, so the two only agreed while both were
  // mounted and watching the same selections. Mount one after the other has
  // already recorded a selection and they disagree.
  test('the shortcut restores a track selected through the button before it mounted', () => {
    const { container, emitState, rerender, selectTextTrack } =
      renderWithPlayer(<Player.CaptionsButton />);
    emitState({
      capabilities: withSelectTextTrack(available),
      textTracks: [track('en', 'English'), track('fr', 'French')],
      selectedTextTrackId: 'fr'
    });
    const button = container.querySelector(
      '[data-playdeck-part="captions-button"]'
    ) as HTMLButtonElement;
    fireEvent.click(button);
    expect(selectTextTrack).toHaveBeenCalledWith(null);
    emitState({ selectedTextTrackId: null });

    // Controls mounts only now, with captions already off — it never observed
    // the French selection.
    rerender(
      <Player.Root loading="interaction" source="/tracer.mp4">
        <Player.CaptionsButton />
        <Player.Controls>
          <Player.Time />
        </Player.Controls>
      </Player.Root>
    );
    const region = container.querySelector<HTMLElement>(
      '[data-playdeck-part="controls"]'
    )!;
    region.focus();
    fireEvent.keyDown(region, { key: 'c' });
    expect(selectTextTrack).toHaveBeenLastCalledWith('fr');
  });

  test('the button restores a track the shortcut turned off before it mounted', () => {
    const { container, emitState, rerender, selectTextTrack } =
      renderWithPlayer(
        <Player.Controls>
          <Player.Time />
        </Player.Controls>
      );
    emitState({
      capabilities: withSelectTextTrack(available),
      textTracks: [track('en', 'English'), track('fr', 'French')],
      selectedTextTrackId: 'fr'
    });
    const region = container.querySelector<HTMLElement>(
      '[data-playdeck-part="controls"]'
    )!;
    region.focus();
    fireEvent.keyDown(region, { key: 'c' });
    expect(selectTextTrack).toHaveBeenCalledWith(null);
    emitState({ selectedTextTrackId: null });

    rerender(
      <Player.Root loading="interaction" source="/tracer.mp4">
        <Player.Controls>
          <Player.Time />
        </Player.Controls>
        <Player.CaptionsButton />
      </Player.Root>
    );
    fireEvent.click(
      container.querySelector(
        '[data-playdeck-part="captions-button"]'
      ) as HTMLButtonElement
    );
    expect(selectTextTrack).toHaveBeenLastCalledWith('fr');
  });

  test('remembers a selection made while no captions control was mounted', () => {
    const { container, emitState, rerender, selectTextTrack } =
      renderWithPlayer(<Player.Time />);
    // A custom control calling selectTextTrack directly contributed to neither
    // component's memory before, because neither was rendering.
    emitState({
      capabilities: withSelectTextTrack(available),
      textTracks: [track('en', 'English'), track('fr', 'French')],
      selectedTextTrackId: 'fr'
    });
    emitState({ selectedTextTrackId: null });

    rerender(
      <Player.Root loading="interaction" source="/tracer.mp4">
        <Player.CaptionsButton />
      </Player.Root>
    );
    fireEvent.click(
      container.querySelector(
        '[data-playdeck-part="captions-button"]'
      ) as HTMLButtonElement
    );
    expect(selectTextTrack).toHaveBeenLastCalledWith('fr');
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
      '[data-playdeck-part="controls"]'
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
      '[data-playdeck-part="controls"]'
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
      '[data-playdeck-part="controls"]'
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

  test('renders no <track> for an entry whose src is rejected, keeping its siblings', () => {
    const { video } = renderMedia({
      textTracks: [
        { src: 'javascript:alert(1)', srcLang: 'en', label: 'English' },
        { src: '/captions/fr.vtt', srcLang: 'fr', label: 'French' }
      ]
    });
    const tracks = video.querySelectorAll('track');
    expect(tracks.length).toBe(1);
    expect(tracks[0]?.getAttribute('src')).toBe('/captions/fr.vtt');
    expect(tracks[0]?.getAttribute('srclang')).toBe('fr');
  });

  test('rejects unsafe textTracks src schemes and permits every safe form', () => {
    const { video } = renderMedia({
      textTracks: [
        { src: 'javascript:alert(1)', srcLang: 'a', label: 'A' },
        { src: 'data:text/vtt,x', srcLang: 'b', label: 'B' },
        { src: 'file:///etc/passwd', srcLang: 'c', label: 'C' },
        // No `type` reaches this site, so `blob:` -- permitted only for an
        // explicit `type: 'video'` source -- is refused here too (#219, #236).
        { src: 'blob:https://example.com/id', srcLang: 'd', label: 'D' },
        // A raw tab in the scheme position defeats a naive scheme read;
        // refused outright rather than reparsed (#219, #236).
        { src: 'java\tscript:alert(1)', srcLang: 'e', label: 'E' },
        { src: 'http://example.com/en.vtt', srcLang: 'f', label: 'F' },
        { src: 'https://example.com/es.vtt', srcLang: 'g', label: 'G' },
        { src: '//example.com/de.vtt', srcLang: 'h', label: 'H' },
        { src: '/relative/ja.vtt', srcLang: 'i', label: 'I' }
      ]
    });
    const tracks = Array.from(video.querySelectorAll('track'));
    expect(tracks.map((track) => track.getAttribute('src'))).toEqual([
      'http://example.com/en.vtt',
      'https://example.com/es.vtt',
      'https://example.com/de.vtt',
      '/relative/ja.vtt'
    ]);
  });

  test('drops every textTracks entry without throwing when all their src values are rejected', () => {
    expect(() =>
      renderMedia({
        textTracks: [
          { src: 'javascript:alert(1)', srcLang: 'en', label: 'English' }
        ]
      })
    ).not.toThrow();
    const { video } = renderMedia({
      textTracks: [
        { src: 'javascript:alert(1)', srcLang: 'en', label: 'English' }
      ]
    });
    expect(video.querySelectorAll('track').length).toBe(0);
  });
});

// Cue text and track labels are the two provider-supplied strings this package
// renders. They come out of a third-party player's payload, so the rule is that
// they are text and only text -- the markup below has to survive as characters,
// not become an element (#101).
describe('provider-supplied strings never render as markup', () => {
  const injection = '<img src=x onerror="throw new Error()"><b>bold</b>';

  test('cue text renders as text, not markup', () => {
    const { container, emitState, emitCues } = renderWithPlayer(
      <Player.Captions />
    );
    emitState({ captionRendering: 'custom' });
    emitCues([{ id: 'c1', startTime: 0, endTime: 1, text: injection }]);
    const cue = container.querySelector('[data-playdeck-part="caption-cue"]');
    expect(cue?.textContent).toBe(injection);
    expect(cue?.querySelector('img, b')).toBe(null);
  });

  test('text track labels render as text, not markup', () => {
    const { container, emitState } = renderWithPlayer(<Player.CaptionsMenu />);
    emitState({
      capabilities: withSelectTextTrack(available),
      textTracks: [track('en', injection)],
      selectedTextTrackId: 'en'
    });
    fireEvent.click(
      container.querySelector(
        '[data-playdeck-part="settings-menu-trigger"]'
      ) as HTMLButtonElement
    );
    const item = Array.from(
      container.querySelectorAll('[role="menuitemradio"]')
    ).find((candidate) => candidate.textContent === injection);
    expect(item).toBeDefined();
    expect(item?.querySelector('img, b')).toBe(null);
  });

  test('the caption announcer states a label as text, not markup', () => {
    const { container, emitState } = renderWithPlayer(
      <Player.CaptionsButton />
    );
    emitState({
      capabilities: withSelectTextTrack(available),
      textTracks: [track('en', injection)],
      selectedTextTrackId: null
    });
    emitState({ selectedTextTrackId: 'en' });
    const announcer = container.querySelector(
      '[data-playdeck-part="captions-announcer"]'
    );
    expect(announcer?.textContent).toBe(`${injection} captions on`);
    expect(announcer?.querySelector('img, b')).toBe(null);
  });
});

// #182: chapters are published as their own collection, so a source carrying a
// chapters track beside a captions track has exactly one track in `textTracks`.
// The provider half of that is tested against the media element's track list;
// this is the same claim at the layer a consumer sees it — nothing the captions
// menu lists, and nothing the captions toggle can resolve to, comes from
// chapters.
describe('a source carrying both a chapters track and a captions track', () => {
  const ChapterProbe = () => {
    const chapters = Player.usePlayerState((state) => state.chapters);
    return (
      <div data-testid="chapters">{chapters.map((c) => c.title).join('|')}</div>
    );
  };

  const renderWithBothCollections = (ui: ReactNode) => {
    const utils = renderWithPlayer(
      <>
        <ChapterProbe />
        {ui}
      </>
    );
    utils.emitState({
      capabilities: { ...withSelectTextTrack(available), chapters: available },
      chapters: [
        { id: 'c1', title: 'Introduction', startTime: 0, endTime: 30 },
        { id: 'c2', title: 'The build', startTime: 30, endTime: 90 }
      ],
      textTracks: [track('en', 'English')],
      selectedTextTrackId: null
    });
    // The chapters really did arrive: the assertions below say the captions
    // controls ignore them, which means nothing unless they are there to ignore.
    expect(utils.getByTestId('chapters').textContent).toBe(
      'Introduction|The build'
    );
    return utils;
  };

  test('the captions menu lists only the captions track', () => {
    const { container } = renderWithBothCollections(<Player.CaptionsMenu />);
    fireEvent.click(
      container.querySelector(
        '[data-playdeck-part="settings-menu-trigger"]'
      ) as HTMLButtonElement
    );
    const items = Array.from(
      container.querySelectorAll('[role="menuitemradio"]')
    );
    expect(items.map((item) => item.textContent)).toEqual(['Off', 'English']);
  });

  test('the captions button toggle resolves only to the captions track', () => {
    const { container, selectTextTrack } = renderWithBothCollections(
      <Player.CaptionsButton />
    );
    fireEvent.click(
      container.querySelector(
        '[data-playdeck-part="captions-button"]'
      ) as HTMLButtonElement
    );
    expect(selectTextTrack).toHaveBeenCalledWith('en');
    expect(selectTextTrack).toHaveBeenCalledTimes(1);
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
      container.querySelector('[data-playdeck-part="settings-menu-root"]')
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
      '[data-playdeck-part="settings-menu-trigger"]'
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
        '[data-playdeck-part="settings-menu-trigger"]'
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
        '[data-playdeck-part="settings-menu-trigger"]'
      ) as HTMLButtonElement
    );
    const off = Array.from(
      container.querySelectorAll('[role="menuitemradio"]')
    ).find((item) => item.textContent === 'Off') as HTMLButtonElement;
    fireEvent.click(off);
    expect(selectTextTrack).toHaveBeenCalledWith(null);
  });

  test('its content root inherits the keyboard-focusable default', () => {
    // CaptionsMenu is a preset over the same SettingsMenuContent and renders
    // it with no className and no tabIndex, so it carried the identical
    // `scrollable-region-focusable` gap. The default has to reach it without
    // a second edit here.
    const { container, emitState } = renderWithPlayer(<Player.CaptionsMenu />);
    emitState({
      capabilities: withSelectTextTrack(available),
      textTracks: [track('en', 'English')],
      selectedTextTrackId: 'en'
    });
    fireEvent.click(
      container.querySelector(
        '[data-playdeck-part="settings-menu-trigger"]'
      ) as HTMLButtonElement
    );
    const content = container.querySelector(
      '[data-playdeck-part="settings-menu"]'
    ) as HTMLDivElement;
    expect(content.tabIndex).toBe(0);
  });
});
