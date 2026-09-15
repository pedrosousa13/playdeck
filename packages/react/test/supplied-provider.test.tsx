// @vitest-environment happy-dom

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import * as Player from '../src/index';
import { createFakeProvider } from './fixtures/fake-provider';

afterEach(() => cleanup());

// No module is mocked here, deliberately, unlike `hls.test.tsx` and its
// siblings: those mock the built-in provider PACKAGE `loadProvider`
// dispatches to, so this file's equivalent is the `providers` prop itself --
// `detect` and `load` below stand in for a real registration the same way an
// inline `providers={{ acme: { detect, load } }}` would in a consumer's own
// app. `Root`, `detectSourceWithProviders`, `loadProvider` and `Media` all run
// for real, so this is the one test in the suite that proves the seam's own
// wiring end to end rather than proving `loadProvider`'s dispatch in
// isolation (`provider-loaders.test.ts`) or an individual link in it.
//
// Demonstrated red (docs/agents/demonstrated-red.md's fallback: the feature
// is additive, so a substitute mutation stands in for reverting it).
// `detectSourceWithProviders` (`provider-loaders.ts`) short-circuited to
// `return builtin;` before ever consulting `providers`, run with
// `pnpm vitest run packages/react/test/supplied-provider.test.tsx`: all
// three tests below failed -- the first two on a `waitFor` timeout (no
// `[data-playdeck-part="media"]` node ever appears, `detectSourceWithProviders`
// never resolving the supplied kind), the third on `expect(node).not.toBeNull()`
// finding only the viewport, no media mount underneath it. Reverted
// afterwards.
test('mounts a media div and reaches attach/load for a supplied kind, end to end through Player.Root', async () => {
  const fake = createFakeProvider({ provider: 'native' });
  const detect = vi.fn((url: string) => {
    const match = /^https:\/\/acme\.example\/videos\/([\w-]+)$/.exec(url);
    return match
      ? ({ type: 'acme' as const, videoId: match[1]! } as const)
      : undefined;
  });
  const load = vi.fn(async () => () => fake.adapter);

  render(
    <Player.Root
      loading="eager"
      providers={{ acme: { detect, load } }}
      source="https://acme.example/videos/1"
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  // Neither of the five built-in kinds renders a `<div>` for `Media`'s own
  // sake -- video/hls get a `<video>`, youtube/vimeo/wistia already existed
  // before this feature. This is the mount `viewport-media.tsx`'s new
  // fallback branch adds: a supplied kind's own factory is handed exactly
  // this element as its mount point.
  const mount = await waitFor(() => {
    const node = document.querySelector('[data-playdeck-part="media"]');
    expect(node).not.toBeNull();
    return node as HTMLDivElement;
  });
  expect(mount.tagName).toBe('DIV');

  expect(detect).toHaveBeenCalledWith('https://acme.example/videos/1');
  await waitFor(() => expect(load).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(fake.counts()).toMatchObject({ attachCount: 1, loadCount: 1 })
  );
});

// The explicit-object counterpart to the test above: `source` is an object of
// the registered `acme` kind rather than a URL, so resolution goes through
// `detectSourceWithProviders`'s object path instead of `detect` -- `detect` is
// still supplied here and is asserted never called, which is what proves this
// end to end rather than merely at the unit level (`provider-loaders.test.ts`
// proves the same claim against `detectSourceWithProviders` directly).
test('mounts and loads a supplied kind from an explicit source object, end to end through Player.Root, without calling detect', async () => {
  const fake = createFakeProvider({ provider: 'native' });
  const detect = vi.fn<
    (url: string) => { type: 'acme'; videoId: string } | undefined
  >(() => undefined);
  const load = vi.fn(async () => () => fake.adapter);

  render(
    <Player.Root
      loading="eager"
      providers={{ acme: { detect, load } }}
      source={{ type: 'acme', videoId: '1' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() => {
    const node = document.querySelector('[data-playdeck-part="media"]');
    expect(node).not.toBeNull();
  });

  expect(detect).not.toHaveBeenCalled();
  await waitFor(() => expect(load).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(fake.counts()).toMatchObject({ attachCount: 1, loadCount: 1 })
  );
});

// The render-level counterpart of `provider-loaders.test.ts`'s
// `refuses a detect return carrying a forbidden scheme nested inside it, and
// continues to a later registration` -- proven here through `Player.Root`
// itself rather than against `detectSourceWithProviders` directly, so it is a
// claim about what a consumer of the real `providers` prop actually sees: a
// registration whose `detect` returns a value with a forbidden scheme nested
// inside it never gets that value acted on, and a later registration that
// would have matched the same URL honestly still mounts and loads.
test('skips a registration whose detect returns a forbidden nested scheme and mounts the next one that matches honestly', async () => {
  const fake = createFakeProvider({ provider: 'native' });
  const dishonest = vi.fn(() => ({
    type: 'acme',
    config: { url: 'javascript:alert(1)' }
  }));
  const honestLoad = vi.fn(async () => () => fake.adapter);
  const honest = vi.fn(() => ({ type: 'other', videoId: '1' }) as const);

  render(
    <Player.Root
      loading="eager"
      providers={{
        acme: { detect: dishonest, load: vi.fn() },
        other: { detect: honest, load: honestLoad }
      }}
      source="https://example.com/media/1"
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() => {
    const node = document.querySelector('[data-playdeck-part="media"]');
    expect(node).not.toBeNull();
  });

  expect(dishonest).toHaveBeenCalledWith('https://example.com/media/1');
  expect(honest).toHaveBeenCalledWith('https://example.com/media/1');
  await waitFor(() => expect(honestLoad).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(fake.counts()).toMatchObject({ attachCount: 1, loadCount: 1 })
  );
});

// A supplied kind's own providerOptions bag is compared the same way the
// four built-in bags are, the equivalent of `hls.test.tsx`'s and
// `vimeo.test.tsx`'s dedicated remount regression for a supplied kind's own
// bag: `providerOptionsEqual` (`use-activation.ts`) compares every bag it
// knows about generically, keyed by name, so a supplied kind's own key gets
// the same by-value comparison the four built-in bags do -- proven here
// through a `Player.Root` rerender rather than only at
// `provider-loaders.test.ts`'s unit level. Confirmed by adding
// `if (key === 'acme') continue;` at the top of `providerOptionsEqual`'s own
// key loop and running
// `pnpm vitest run packages/react/test/supplied-provider.test.tsx`: this test
// failed, because the second render was then judged equal to the first and
// the factory was never called again -- reverted afterwards.
test('re-attaches a supplied kind when its own providerOptions key changes', async () => {
  const fakes: ReturnType<typeof createFakeProvider>[] = [];
  const factory = vi.fn(
    (
      mount: HTMLVideoElement | HTMLDivElement | null,
      source: { type: 'acme'; videoId: string },
      options?: { quality?: 'sd' | 'hd' }
    ) => {
      void mount;
      void source;
      void options;
      const fake = createFakeProvider({ provider: 'native' });
      fakes.push(fake);
      return fake.adapter;
    }
  );
  const load = vi.fn(async () => factory);

  const { rerender } = render(
    <Player.Root
      loading="eager"
      providerOptions={{ acme: { quality: 'sd' } }}
      providers={{ acme: { detect: vi.fn(), load } }}
      source={{ type: 'acme', videoId: '1' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
  expect(factory.mock.calls[0]![2]).toMatchObject({ quality: 'sd' });

  rerender(
    <Player.Root
      loading="eager"
      providerOptions={{ acme: { quality: 'hd' } }}
      providers={{ acme: { detect: vi.fn(), load } }}
      source={{ type: 'acme', videoId: '1' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() => expect(factory).toHaveBeenCalledTimes(2));
  expect(factory.mock.calls[1]![2]).toMatchObject({ quality: 'hd' });
  await waitFor(() => expect(fakes[0]!.counts().destroyCount).toBe(1));
});
