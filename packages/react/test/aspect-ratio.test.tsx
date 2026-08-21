// @vitest-environment happy-dom

// #174. The media's intrinsic aspect ratio is published onto the viewport as
// `--playdeck-media-aspect-ratio`, written imperatively to the DOM node. It is
// deliberately NOT part of `PlayerState`: a state field would re-render every
// consumer of that state on every source change and every dimension change,
// for a value only CSS ever reads. The no-rerender test below is the one that
// holds that line.

import { act, cleanup, render } from '@testing-library/react';
import { createRef, Profiler } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import {
  PlayerController,
  type MediaDimensions,
  type ProviderAdapter
} from '@playdeck/core';
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
});

const PROPERTY = '--playdeck-media-aspect-ratio';

// A fake provider that also carries the optional dimension channel, and one
// that deliberately does not — YouTube is the real adapter with no channel,
// and its viewport must keep the property unset rather than defaulted.
const measuringProvider = () => {
  const base = createFakeProvider();
  const listeners = new Set<
    (dimensions: MediaDimensions | undefined) => void
  >();
  const adapter: ProviderAdapter = {
    ...base.adapter,
    subscribeDimensions: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
  return {
    adapter,
    publish: (dimensions: MediaDimensions | undefined) =>
      act(() => listeners.forEach((listener) => listener(dimensions)))
  };
};

const viewport = (): HTMLElement =>
  document.querySelector<HTMLElement>('[data-playdeck-part="viewport"]')!;

const ratio = (): string => viewport().style.getPropertyValue(PROPERTY);

const renderPlayer = (
  children: React.ReactNode = <Player.Viewport />
): PlayerController => {
  const handle = createRef<Player.PlayerHandle>();
  render(
    <Player.Root ref={handle} source="/tracer.mp4">
      {children}
    </Player.Root>
  );
  return (handle.current as unknown as InternalControllerAccess)[
    INTERNAL_CONTROLLER
  ];
};

test('publishes the intrinsic aspect ratio onto the viewport', () => {
  const controller = renderPlayer();
  const media = measuringProvider();
  act(() => controller.setProvider(media.adapter));

  media.publish({ width: 1080, height: 1920 });

  expect(ratio()).toBe('1080 / 1920');
});

test('leaves the property unset before any measurement arrives', () => {
  const controller = renderPlayer();
  act(() => controller.setProvider(measuringProvider().adapter));

  expect(ratio()).toBe('');
});

// Absent, not defaulted — that distinction is the whole reason the consumer's
// `var()` fallback works. YouTube is the real adapter in this shape: a bare
// <div> mount with no measurable media, so it declares no channel at all.
test('leaves the property absent for a provider with no dimension channel', () => {
  const controller = renderPlayer();

  act(() => controller.setProvider(createFakeProvider().adapter));

  expect(viewport().style.getPropertyValue(PROPERTY)).toBe('');
  expect(viewport().getAttribute('style')).not.toContain(PROPERTY);
});

test('republishes when a differently shaped source replaces the first', () => {
  const controller = renderPlayer();
  const portrait = measuringProvider();
  act(() => controller.setProvider(portrait.adapter));
  portrait.publish({ width: 1080, height: 1920 });
  expect(ratio()).toBe('1080 / 1920');

  const landscape = measuringProvider();
  act(() => controller.setProvider(landscape.adapter));
  landscape.publish({ width: 1920, height: 1080 });

  expect(ratio()).toBe('1920 / 1080');
});

// The same defect the controller test guards, seen from the DOM end.
test('clears the property when the next source has no known ratio', () => {
  const controller = renderPlayer();
  const portrait = measuringProvider();
  act(() => controller.setProvider(portrait.adapter));
  portrait.publish({ width: 1080, height: 1920 });
  expect(ratio()).toBe('1080 / 1920');

  act(() => controller.setProvider(createFakeProvider().adapter));

  expect(ratio()).toBe('');
  expect(viewport().getAttribute('style')).not.toContain(PROPERTY);
});

test('clears the property when the measurement becomes unknown', () => {
  const controller = renderPlayer();
  const media = measuringProvider();
  act(() => controller.setProvider(media.adapter));
  media.publish({ width: 1080, height: 1920 });
  expect(ratio()).toBe('1080 / 1920');

  media.publish(undefined);

  expect(ratio()).toBe('');
});

// The whole point of the issue. A dimension change must reach the DOM without
// rendering anything: not the state consumers (which a `PlayerState` field
// would wake), and not the viewport subtree itself (which a
// `useSyncExternalStore` subscription inside `Viewport` would wake). The
// property assertion sits in the same test so it cannot pass by doing nothing.
test('writes the ratio without rendering anything', () => {
  const stateSpy = vi.fn();
  const commitSpy = vi.fn();
  // The whole state object, so the probe wakes on *any* state change — a
  // narrow selector would bail out and hide a `PlayerState` field being added.
  const StateConsumer = () => {
    Player.usePlayerState((state) => state);
    stateSpy();
    return null;
  };
  const controller = renderPlayer(
    <>
      <Profiler id="viewport" onRender={commitSpy}>
        <Player.Viewport />
      </Profiler>
      <StateConsumer />
    </>
  );
  const media = measuringProvider();
  act(() => controller.setProvider(media.adapter));
  const stateRenders = stateSpy.mock.calls.length;
  const commits = commitSpy.mock.calls.length;

  media.publish({ width: 1080, height: 1920 });

  expect(ratio()).toBe('1080 / 1920');
  expect(stateSpy).toHaveBeenCalledTimes(stateRenders);
  expect(commitSpy).toHaveBeenCalledTimes(commits);
});

test('writes the ratio without rendering when the source changes shape', () => {
  const stateSpy = vi.fn();
  const StateConsumer = () => {
    Player.usePlayerState((state) => state);
    stateSpy();
    return null;
  };
  const controller = renderPlayer(
    <>
      <Player.Viewport />
      <StateConsumer />
    </>
  );
  const media = measuringProvider();
  act(() => controller.setProvider(media.adapter));
  media.publish({ width: 1080, height: 1920 });
  const stateRenders = stateSpy.mock.calls.length;

  media.publish({ width: 1920, height: 1080 });

  expect(ratio()).toBe('1920 / 1080');
  expect(stateSpy).toHaveBeenCalledTimes(stateRenders);
});
