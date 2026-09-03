// @vitest-environment happy-dom

// The idle attribute's transitions, as DOM tests against `Viewport` alone.
// `data-idle` is written straight to the node for the same reason
// `--playdeck-media-aspect-ratio` is, so these assert the attribute rather
// than any rendered output. The focus-within rule that keeps the bar visible
// while a control holds focus is CSS and not a JS branch, so it is not
// testable here and is covered as an e2e check instead.

import { act, cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import {
  INTERNAL_CONTROLLER,
  type InternalControllerAccess
} from '../src/internal-controller';
import * as Player from '../src/index';
import { loadProvider } from '../src/provider-loaders';
import { createFakeProvider } from './fixtures/fake-provider';

vi.mock('../src/provider-loaders', () => ({
  loadProvider: vi.fn()
}));

const mockedLoadProvider = vi.mocked(loadProvider);

afterEach(() => {
  cleanup();
  mockedLoadProvider.mockReset();
  vi.useRealTimers();
});

const IDLE_DELAY_MS = 2500;

const viewport = (): HTMLElement =>
  document.querySelector<HTMLElement>('[data-playdeck-part="viewport"]')!;

const idle = (): string | null => viewport().getAttribute('data-idle');

// Attaches a provider directly through the handle and brings it to `ready`,
// the shape `style-precedence.test.tsx`'s `renderWithProvider` uses. The
// fixture itself is returned, not just `adapter`: later patches
// (`playback: 'playing'` / `'paused'`) are emitted on it, which discarding it
// as `createFakeProvider().adapter` would make impossible.
const startPlayer = () => {
  const handle = createRef<Player.PlayerHandle>();
  const utils = render(
    <Player.Root ref={handle} source="/tracer.mp4">
      <Player.Viewport />
    </Player.Root>
  );
  const controller = (handle.current as unknown as InternalControllerAccess)[
    INTERNAL_CONTROLLER
  ];
  const fake = createFakeProvider();
  act(() => {
    controller.setProvider(fake.adapter);
    fake.emit({ lifecycle: 'ready', activation: 'ready', provider: 'native' });
  });
  return { controller, fake, utils };
};

const QUALIFYING_EVENTS = [
  'pointermove',
  'pointerdown',
  'touchstart',
  'keydown',
  'focusin'
] as const;

test('starts not idle, and stays not idle while paused', () => {
  vi.useFakeTimers();
  startPlayer();
  expect(idle()).toBe('false');
  // Several times the delay, because a timer armed while paused is the naive
  // implementation's mistake and one delay's wait would not separate it from a
  // timer that is merely slow.
  act(() => {
    vi.advanceTimersByTime(IDLE_DELAY_MS * 5);
  });
  expect(idle()).toBe('false');
});

test('goes idle 2500ms after playback starts with no qualifying event', () => {
  vi.useFakeTimers();
  const { fake } = startPlayer();
  act(() => {
    fake.emit({ playback: 'playing' });
  });
  expect(idle()).toBe('false');
  act(() => {
    vi.advanceTimersByTime(IDLE_DELAY_MS - 1);
  });
  expect(idle()).toBe('false');
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(idle()).toBe('true');
});

test.each(QUALIFYING_EVENTS)(
  'a %s event resets the timer and clears idle if it was set',
  (type) => {
    vi.useFakeTimers();
    const { fake } = startPlayer();
    act(() => {
      fake.emit({ playback: 'playing' });
    });
    act(() => {
      vi.advanceTimersByTime(IDLE_DELAY_MS);
    });
    expect(idle()).toBe('true');

    act(() => {
      viewport().dispatchEvent(new Event(type, { bubbles: true }));
    });
    expect(idle()).toBe('false');

    act(() => {
      vi.advanceTimersByTime(IDLE_DELAY_MS - 1);
    });
    expect(idle()).toBe('false');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(idle()).toBe('true');
  }
);

test('pausing clears idle immediately and disarms the timer', () => {
  vi.useFakeTimers();
  const { fake } = startPlayer();
  act(() => {
    fake.emit({ playback: 'playing' });
  });
  act(() => {
    vi.advanceTimersByTime(1000);
  });

  act(() => {
    fake.emit({ playback: 'paused' });
  });
  expect(idle()).toBe('false');

  act(() => {
    vi.advanceTimersByTime(IDLE_DELAY_MS * 5);
  });
  expect(idle()).toBe('false');
});

test('a timer armed while playing does not survive unmount', () => {
  vi.useFakeTimers();
  const { utils, fake } = startPlayer();
  act(() => {
    fake.emit({ playback: 'playing' });
  });
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  act(() => {
    utils.unmount();
  });
  expect(vi.getTimerCount()).toBe(0);
});
