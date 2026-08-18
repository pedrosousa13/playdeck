// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen
} from '@testing-library/react';
import { createRef, type ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  type CommandResult,
  PlayerController,
  type PlayerError,
  type ProviderAdapter,
  type ProviderStateListener,
  type ProviderStatePatch
} from '@playdeck/core';
import * as Player from '../src/index';

const ok = async (): Promise<CommandResult> => ({ ok: true });

const createMockAdapter = () => {
  const listeners = new Set<ProviderStateListener>();
  const spies = {
    play: vi.fn(ok),
    pause: vi.fn(ok),
    retry: vi.fn(ok)
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

const recoverable: PlayerError = {
  category: 'network',
  fatal: false,
  recoverable: true,
  message: 'The network connection was lost.'
};

const fatal: PlayerError = {
  category: 'source',
  fatal: true,
  recoverable: false,
  message: 'This video is unavailable.'
};

const errorState = (error: PlayerError): ProviderStatePatch => ({
  lifecycle: 'error',
  activation: 'error',
  error
});

const attr = (element: Element | null, name: string): string | null =>
  element?.getAttribute(name) ?? null;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ErrorDisplay', () => {
  test('renders nothing when there is no error', () => {
    const { container } = renderWithPlayer(<Player.ErrorDisplay />);
    expect(container.querySelector('[data-playdeck-part="error"]')).toBeNull();
  });

  test('renders the error message and category from PlayerState.error', () => {
    renderWithPlayer(<Player.ErrorDisplay />, errorState(recoverable));
    const surface = screen.getByRole('alert');
    expect(attr(surface, 'data-playdeck-part')).toBe('error');
    expect(attr(surface, 'data-state')).toBe('network');
    expect(attr(surface, 'data-provider')).toBe('native');
    expect(surface.textContent).toContain('The network connection was lost.');
  });

  test('exposes a focusable retry action wired to retry() when recoverable', () => {
    const { spies } = renderWithPlayer(
      <Player.ErrorDisplay />,
      errorState(recoverable)
    );
    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    expect(document.activeElement).toBe(retry);
    fireEvent.click(retry);
    expect(spies.retry).toHaveBeenCalledTimes(1);
  });

  test('omits the retry action entirely when the error is not recoverable', () => {
    renderWithPlayer(<Player.ErrorDisplay />, errorState(fatal));
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    // Never disabled-but-visible.
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('passes className, style and ref through', () => {
    const ref = createRef<HTMLDivElement>();
    renderWithPlayer(
      <Player.ErrorDisplay className="c" ref={ref} style={{ color: 'red' }} />,
      errorState(recoverable)
    );
    const surface = screen.getByRole('alert');
    expect(ref.current).toBe(surface);
    expect(surface.classList.contains('c')).toBe(true);
    expect((surface as HTMLElement).style.color).toBe('red');
  });

  test('replaceable children receive the error and a capability-aware retry', () => {
    const { spies } = renderWithPlayer(
      <Player.ErrorDisplay>
        {({ error, retry }) => (
          <button disabled={!retry} onClick={() => retry?.()} type="button">
            {error.message}
          </button>
        )}
      </Player.ErrorDisplay>,
      errorState(recoverable)
    );
    const custom = screen.getByRole('button', {
      name: 'The network connection was lost.'
    });
    fireEvent.click(custom);
    expect(spies.retry).toHaveBeenCalledTimes(1);
  });

  test('render-prop retry is null when the error is not recoverable', () => {
    const retrySpy = vi.fn();
    renderWithPlayer(
      <Player.ErrorDisplay>
        {({ retry }) => {
          retrySpy(retry);
          return <span>content</span>;
        }}
      </Player.ErrorDisplay>,
      errorState(fatal)
    );
    expect(retrySpy).toHaveBeenLastCalledWith(null);
  });
});

describe('ErrorDisplay and ActivationButton', () => {
  // Both read `error.recoverable` and nothing else, so the two can never offer
  // and refuse the same retry at once again (#198).
  test.each([
    { error: recoverable, offered: true, subject: 'a recoverable error' },
    { error: fatal, offered: false, subject: 'a non-recoverable error' }
  ])('agree on what $subject offers', ({ error, offered }) => {
    const { controller } = renderWithPlayer(
      <>
        <Player.ActivationButton />
        <Player.ErrorDisplay />
      </>,
      errorState(error)
    );

    const activation = screen.getByRole('button', {
      name: offered ? 'Retry loading video' : 'Play video'
    });
    expect(attr(activation, 'aria-disabled')).toBe(offered ? null : 'true');
    expect(screen.queryAllByRole('button', { name: 'Retry' })).toHaveLength(
      offered ? 1 : 0
    );

    fireEvent.click(activation);
    expect(controller.getState().activation).toBe(
      offered ? 'eligible' : 'error'
    );
  });

  // The state where reading the flag beats reading the category, and the
  // composition guarantee #235 depends on: a non-fatal notice — a rejected
  // embed host, a rejected player colour — lands in the same single error slot
  // as an activation failure, and one that reports itself retryable must leave
  // the control operable however its category reads. The category rule this
  // replaced disabled the button here (#198).
  test('a recoverable error in the error state leaves the activation button operable whatever its category', () => {
    const { controller } = renderWithPlayer(
      <Player.ActivationButton />,
      errorState({
        category: 'configuration',
        fatal: false,
        recoverable: true,
        message: 'The player colour was rejected.'
      })
    );

    const activation = screen.getByRole('button', {
      name: 'Retry loading video'
    });
    expect(attr(activation, 'aria-disabled')).toBeNull();

    fireEvent.click(activation);
    expect(controller.getState().activation).toBe('eligible');
  });

  // And outside `error` the button never reads the slot at all: the `isError`
  // gate, not the retryability rule — a notice sitting there while activation is
  // `eligible` says nothing about a control that only ever acts on an
  // activation failure, whichever way its own retryability falls.
  test.each([true, false])(
    'an error reporting recoverable %s alongside eligible activation never reaches the activation button',
    (isRecoverable) => {
      renderWithPlayer(<Player.ActivationButton />, {
        activation: 'eligible',
        lifecycle: 'idle',
        error: {
          category: 'configuration',
          fatal: false,
          recoverable: isRecoverable,
          message: 'The player colour was rejected.'
        }
      });

      const activation = screen.getByRole('button', { name: 'Play video' });
      expect(attr(activation, 'aria-disabled')).toBeNull();
    }
  );
});
