// @vitest-environment happy-dom

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { createHlsProvider } from '@playdeck/provider-hls';
import * as Player from '../src/index';

const harness = vi.hoisted(() => ({
  fakes: [] as Array<{
    adapter: import('@playdeck/core').ProviderAdapter;
    counts: () => Record<string, number>;
    emit: (patch: import('@playdeck/core').ProviderStatePatch) => void;
  }>
}));

vi.mock('@playdeck/provider-hls', async () => {
  const { createFakeProvider } = await import('./fixtures/fake-provider');
  return {
    createHlsProvider: vi.fn(() => {
      const fake = createFakeProvider({ provider: 'hls' });
      harness.fakes.push(fake);
      return fake.adapter;
    })
  };
});

const mockedCreateHlsProvider = vi.mocked(createHlsProvider);

afterEach(() => {
  cleanup();
  harness.fakes.length = 0;
  vi.clearAllMocks();
});

// #579: `build` is the primitive `PlayerProviderOptions.hls` carries through
// `Player.Root` -- the route that did not exist before, and the one
// `loadProvider` (`packages/react/src/provider-loaders.ts`) now merges into
// the native options it already passed `createHlsProvider`.
test('forwards the hls build option to the hls adapter through Player.Root', async () => {
  render(
    <Player.Root
      loading="eager"
      providerOptions={{ hls: { build: 'light' } }}
      source={{ type: 'hls', src: '/hls/master.m3u8' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(mockedCreateHlsProvider).toHaveBeenCalledTimes(1)
  );
  const [mount, source, options] = mockedCreateHlsProvider.mock.calls[0]!;
  expect(mount).toBeInstanceOf(HTMLVideoElement);
  expect(source).toEqual({ type: 'hls', src: '/hls/master.m3u8' });
  expect(options).toMatchObject({ build: 'light' });
});

// The regression #579 exists to prevent: `providerOptionsEqual`
// (`use-activation.ts`) must compare the `hls` bag by value, or a changed bag
// looks unchanged and the adapter never re-attaches to pick it up. Delete the
// `providerBagEqual(left?.hls, right?.hls)` line and this test fails, because
// the second render is then judged equal to the first and `createHlsProvider`
// is never called again -- mirrored from the same regression `vimeo.test.tsx`
// and `youtube.test.tsx` guard for their own bags.
test('re-attaches the HLS adapter when the build option changes', async () => {
  const { rerender } = render(
    <Player.Root
      loading="eager"
      providerOptions={{ hls: { build: 'full' } }}
      source={{ type: 'hls', src: '/hls/master.m3u8' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(mockedCreateHlsProvider).toHaveBeenCalledTimes(1)
  );

  rerender(
    <Player.Root
      loading="eager"
      providerOptions={{ hls: { build: 'light' } }}
      source={{ type: 'hls', src: '/hls/master.m3u8' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(mockedCreateHlsProvider).toHaveBeenCalledTimes(2)
  );
  const [, , options] = mockedCreateHlsProvider.mock.calls[1]!;
  expect(options).toMatchObject({ build: 'light' });
  expect(harness.fakes[0]!.counts().destroyCount).toBe(1);
});

// The trap the design guards against: `providerOptions={{ hls: { build:
// 'light' } }}` written inline is a new object every render, exactly as a
// consumer writing it in JSX would produce. Without `providerBagEqual`
// comparing the bag by value, this looks like a change on every render and
// tears the hls.js engine down and rebuilds it, losing playback position --
// the hazard `docs/provider-setup.md`'s HLS section and this issue are about.
test('keeps the installed HLS adapter when a value-equal provider option bag is passed again', async () => {
  const { rerender } = render(
    <Player.Root
      loading="eager"
      providerOptions={{ hls: { build: 'light' } }}
      source={{ type: 'hls', src: '/hls/master.m3u8' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(mockedCreateHlsProvider).toHaveBeenCalledTimes(1)
  );

  // A fresh object literal with the same value, as an inline prop produces on
  // every render.
  rerender(
    <Player.Root
      loading="eager"
      providerOptions={{ hls: { build: 'light' } }}
      source={{ type: 'hls', src: '/hls/master.m3u8' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );
  await act(async () => undefined);

  expect(mockedCreateHlsProvider).toHaveBeenCalledTimes(1);
});
