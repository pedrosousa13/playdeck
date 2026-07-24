// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react';
import { createRef, type ReactNode } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import {
  PlayerController,
  type ProviderAdapter,
  type ProviderStateListener,
  type ProviderStatePatch,
  type TextCue
} from '@reely/core';
import * as Player from '../src/index';

const ok = async () => ({ ok: true as const });

const createMockAdapter = () => {
  let cueListener: ((cues: readonly TextCue[]) => void) | undefined;
  let stateListener: ProviderStateListener | undefined;
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
    subscribeCues: (listener) => {
      cueListener = listener;
      return () => {
        cueListener = undefined;
      };
    }
  };
  return {
    adapter,
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
    emitCues: (cues: readonly TextCue[]) => act(() => mock.emitCues(cues)),
    emitState: (patch: ProviderStatePatch) => act(() => mock.emitState(patch))
  };
};

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
