// @vitest-environment happy-dom

// #89. One contract, stated once, for every primitive that sets geometry of
// its own:
//
//   Static geometry is a DEFAULT the consumer's `style` prop overrides.
//   Properties derived from player state are the primitive's OUTPUT and are
//   not overridable.
//
// Before #89 the library was split — 15 spread sites put `...style` last and
// 7 put it first, with no principle separating them (`Captions` at z-index 20
// and `Gestures` at inset 0 were overridable; `ActivationButton` at inset 0,
// z-index 30 was not). These tests are where that rule lives; the per-feature
// suites keep asserting the defaults themselves.

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen
} from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { PlayerController, type ProviderStatePatch } from '@reely/core';
import * as Player from '../src/index';
import { loadProvider } from '../src/provider-loaders';
import { createFakeProvider, deferred } from './fixtures/fake-provider';

vi.mock('../src/provider-loaders', () => ({
  loadProvider: vi.fn()
}));

const mockedLoadProvider = vi.mocked(loadProvider);

// `PosterImage` is not on the public `Player` namespace's declared surface in
// the same way the composed parts are; `index.test.tsx` reaches for it the
// same way.
const posterPrimitives = Player as typeof Player & {
  PosterImage: (props: {
    objectFit?: React.CSSProperties['objectFit'];
    style?: React.CSSProperties;
  }) => React.ReactNode;
};

// Attaches a provider directly through the handle, skipping activation — the
// shortest route to an arbitrary player state (`error-display.test.tsx` uses
// the same one).
const renderWithProvider = (
  ui: React.ReactNode,
  initial?: ProviderStatePatch
) => {
  const handle = createRef<Player.PlayerHandle>();
  const utils = render(
    <Player.Root ref={handle} source="/tracer.mp4">
      {ui}
    </Player.Root>
  );
  const controller = handle.current as unknown as PlayerController;
  const fake = createFakeProvider();
  act(() => {
    controller.setProvider(fake.adapter);
    fake.emit({
      lifecycle: 'ready',
      activation: 'ready',
      provider: 'native',
      ...initial
    });
  });
  return utils;
};

const part = (name: string): HTMLElement =>
  document.querySelector<HTMLElement>(`[data-reely-part="${name}"]`)!;

afterEach(() => {
  cleanup();
  mockedLoadProvider.mockReset();
});

test('Viewport geometry is a default the consumer can override', () => {
  render(
    <Player.Root source="/tracer.mp4">
      <Player.Viewport style={{ position: 'static', overflow: 'visible' }} />
    </Player.Root>
  );

  const viewport = part('viewport');
  expect(viewport.style.position).toBe('static');
  expect(viewport.style.overflow).toBe('visible');
});

test('ActivationButton geometry is a default the consumer can override', () => {
  render(
    <Player.Root loading="interaction" source="/tracer.mp4">
      <Player.Viewport>
        <Player.ActivationButton
          style={{ position: 'static', inset: '8px', zIndex: 1 }}
        />
      </Player.Viewport>
    </Player.Root>
  );

  const activation = part('activation');
  expect(activation.style.position).toBe('static');
  expect(activation.style.inset).toBe('8px');
  expect(activation.style.zIndex).toBe('1');
});

test('ErrorDisplay geometry is a default the consumer can override', () => {
  renderWithProvider(
    <Player.Viewport>
      <Player.ErrorDisplay style={{ position: 'static', zIndex: 5 }} />
    </Player.Viewport>,
    {
      lifecycle: 'error',
      error: {
        category: 'source',
        fatal: true,
        recoverable: false,
        message: 'This video is unavailable.'
      }
    }
  );

  const error = part('error');
  expect(error.style.position).toBe('static');
  expect(error.style.zIndex).toBe('5');
});

test('LoadingIndicator geometry is a default the consumer can override in both branches', () => {
  // Never resolves, so the indicator stays in `loading-provider` for the
  // duration of the test rather than racing an import.
  mockedLoadProvider.mockReturnValue(deferred().promise as never);
  render(
    <Player.Root loading="interaction" source="/tracer.mp4">
      <Player.Viewport>
        <Player.Media />
        <Player.ActivationButton />
        <Player.LoadingIndicator
          style={{ position: 'static', width: '50%', zIndex: 1 }}
        />
      </Player.Viewport>
    </Player.Root>
  );

  // Idle branch: the visually-hidden geometry is a default too. #32 pins what
  // that default *is* when no `style` is passed; this pins that a consumer
  // who does pass one is not ignored.
  const idle = screen.getByRole('status');
  expect(idle.dataset.state).toBe('idle');
  expect(idle.style.position).toBe('static');
  expect(idle.style.width).toBe('50%');

  fireEvent.click(screen.getByRole('button', { name: 'Play video' }));

  // Active branch: same node, same rule.
  const loading = screen.getByRole('status');
  expect(loading).toBe(idle);
  expect(loading.dataset.state).toBe('loading-provider');
  expect(loading.style.position).toBe('static');
  expect(loading.style.zIndex).toBe('1');
});

test('Poster visibility is state-derived and the consumer cannot override it', () => {
  // `eager`, not the default `viewport`: the default needs an
  // IntersectionObserver to make the media eligible, and the observer is not
  // what this test is about.
  mockedLoadProvider.mockResolvedValue(createFakeProvider().adapter);
  render(
    <Player.Root loading="eager" source="/tracer.mp4">
      <Player.Viewport>
        <Player.Media />
        <Player.Poster style={{ visibility: 'visible', zIndex: 999 }}>
          <span>Poster</span>
        </Player.Poster>
      </Player.Viewport>
    </Player.Root>
  );

  const poster = part('poster');
  // Static geometry alongside it still obeys the consumer, which is what
  // makes this a carve-out rather than the old blanket invariant.
  expect(poster.style.zIndex).toBe('999');
  expect(poster.dataset.state).toBe('visible');

  fireEvent.loadedData(screen.getByLabelText('Reely media'));

  // The poster has hidden itself. A static `style` must not pin it open —
  // that would defeat the hide permanently, for every source, and it is not
  // a layout override in any useful sense.
  expect(poster.dataset.state).toBe('hidden');
  expect(poster.style.visibility).toBe('hidden');
});

test('PosterImage resolves object-fit as prop, then style, then the theming default', () => {
  const { PosterImage } = posterPrimitives;
  const { rerender } = render(<PosterImage />);
  const image = document.querySelector('img')!;

  expect(image.style.objectFit).toBe('var(--reely-poster-fit, cover)');

  rerender(<PosterImage style={{ objectFit: 'contain' }} />);
  expect(image.style.objectFit).toBe('contain');

  // The explicit prop is more specific than the generic style bag, so it wins
  // the collision — the one place in the library where `style` is not the
  // outermost layer.
  rerender(<PosterImage objectFit="fill" style={{ objectFit: 'contain' }} />);
  expect(image.style.objectFit).toBe('fill');
});
