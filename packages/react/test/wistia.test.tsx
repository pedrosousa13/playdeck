// @vitest-environment happy-dom

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { createWistiaProvider } from '@reely/provider-wistia';
import * as Player from '../src/index';

const harness = vi.hoisted(() => ({
  fakes: [] as Array<{
    adapter: import('@reely/core').ProviderAdapter;
    counts: () => Record<string, number>;
    emit: (patch: import('@reely/core').ProviderStatePatch) => void;
  }>
}));

vi.mock('@reely/provider-wistia', async () => {
  const { createFakeProvider } = await import('./fixtures/fake-provider');
  return {
    createWistiaProvider: vi.fn(() => {
      const fake = createFakeProvider({ provider: 'wistia' });
      harness.fakes.push(fake);
      return fake.adapter;
    })
  };
});

const mockedCreateWistiaProvider = vi.mocked(createWistiaProvider);

afterEach(() => {
  cleanup();
  harness.fakes.length = 0;
  vi.clearAllMocks();
});

const renderWistia = (
  props: { endTime?: number; loop?: boolean; startTime?: number } = {}
) =>
  render(
    <Player.Root
      loading="eager"
      source={{ type: 'wistia', mediaId: 'oifkgmxnkb' }}
      {...props}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

// SIDEPRO-210: `loop` is a `Root` prop, and reaches this provider through the
// wistia bag rather than `nativeOptions`, which `loadProvider` hands to the
// native and HLS providers only. The bag key it lands on is the one Wistia's
// adapter already reads to set `endVideoBehavior`; what changed is that `Root`
// now writes it, and `PlayerProviderOptions` no longer lets a consumer do so.
test("folds Root's loop into the wistia provider option bag", async () => {
  renderWistia({ loop: true });

  await waitFor(() =>
    expect(mockedCreateWistiaProvider).toHaveBeenCalledTimes(1)
  );
  const [, , options] = mockedCreateWistiaProvider.mock.calls[0]!;
  expect(options).toMatchObject({ loop: true });
});

test('leaves the wistia bag un-looped when Root omits the prop', async () => {
  renderWistia();

  await waitFor(() =>
    expect(mockedCreateWistiaProvider).toHaveBeenCalledTimes(1)
  );
  const [, , options] = mockedCreateWistiaProvider.mock.calls[0]!;
  expect(options?.loop).toBeUndefined();
});

// #214: `startTime` and `endTime` are `Root` props too, and reach this provider
// by the same fold `loop` takes. They used to travel only in `nativeOptions`,
// which `loadProvider` hands to the native and HLS providers alone, so both were
// silently inert on a Wistia source.
test("folds Root's startTime and endTime into the wistia provider option bag", async () => {
  renderWistia({ endTime: 20, startTime: 12 });

  await waitFor(() =>
    expect(mockedCreateWistiaProvider).toHaveBeenCalledTimes(1)
  );
  const [, , options] = mockedCreateWistiaProvider.mock.calls[0]!;
  expect(options).toMatchObject({ endTime: 20, startTime: 12 });
});

test('leaves the wistia bag unbounded when Root omits the time props', async () => {
  renderWistia();

  await waitFor(() =>
    expect(mockedCreateWistiaProvider).toHaveBeenCalledTimes(1)
  );
  const [, , options] = mockedCreateWistiaProvider.mock.calls[0]!;
  expect(options?.startTime).toBeUndefined();
  expect(options?.endTime).toBeUndefined();
});

test('keeps a consumer-supplied wistia bag alongside the folded loop', async () => {
  render(
    <Player.Root
      loading="eager"
      loop
      providerOptions={{ wistia: { playerColor: 'ff0000' } }}
      source={{ type: 'wistia', mediaId: 'oifkgmxnkb' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(mockedCreateWistiaProvider).toHaveBeenCalledTimes(1)
  );
  const [, , options] = mockedCreateWistiaProvider.mock.calls[0]!;
  expect(options).toMatchObject({ loop: true, playerColor: 'ff0000' });
});
