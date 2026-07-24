// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react';
import { createRef, type ReactNode } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import {
  PlayerController,
  type ProviderAdapter,
  type TextCue
} from '@reely/core';
import * as Player from '../src/index';

const ok = async () => ({ ok: true as const });

const createMockAdapter = () => {
  let cueListener: ((cues: readonly TextCue[]) => void) | undefined;
  const adapter: ProviderAdapter = {
    provider: 'native',
    attach: () => {},
    load: () => {},
    destroy: () => {},
    subscribe: () => () => {},
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
    emitCues: (cues: readonly TextCue[]) => cueListener?.(cues)
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
    emitCues: (cues: readonly TextCue[]) => act(() => mock.emitCues(cues))
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
