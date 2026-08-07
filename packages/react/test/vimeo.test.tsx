// @vitest-environment happy-dom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { createVimeoProvider } from '@reely/provider-vimeo';
import * as Player from '../src/index';
import { loadProvider } from '../src/provider-loaders';

const harness = vi.hoisted(() => ({
  fakes: [] as Array<{
    adapter: import('@reely/core').ProviderAdapter;
    counts: () => Record<string, number>;
    emit: (patch: import('@reely/core').ProviderStatePatch) => void;
  }>
}));

vi.mock('@reely/provider-vimeo', async () => {
  const { createFakeProvider } = await import('./fixtures/fake-provider');
  return {
    createVimeoProvider: vi.fn(() => {
      const fake = createFakeProvider({ provider: 'vimeo' });
      harness.fakes.push(fake);
      return fake.adapter;
    })
  };
});

const mockedCreateVimeoProvider = vi.mocked(createVimeoProvider);

afterEach(() => {
  cleanup();
  harness.fakes.length = 0;
  vi.clearAllMocks();
});

test('loads the Vimeo adapter lazily against an embed mount with the source', async () => {
  render(
    <Player.Root loading="eager" source="https://vimeo.com/76979871?h=abc123">
      <Player.Viewport data-testid="viewport">
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(mockedCreateVimeoProvider).toHaveBeenCalledTimes(1)
  );
  const [mount, source] = mockedCreateVimeoProvider.mock.calls[0]!;
  expect(source).toEqual({
    type: 'vimeo',
    videoId: '76979871',
    hash: 'abc123'
  });
  expect(mount).toBeInstanceOf(HTMLDivElement);
  expect((mount as HTMLElement).dataset.reelyPart).toBe('media');
  expect(document.querySelector('video')).toBeNull();
});

test('sizes the Vimeo embed mount to fill its viewport by default', async () => {
  // #150: the mount states its geometry inline, so it fills the viewport for a
  // consumer who ships no stylesheet. `style-precedence.test.tsx` pins that
  // each of these is overridable.
  render(
    <Player.Root
      loading="eager"
      source={{ type: 'vimeo', videoId: '76979871' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  // Awaited so the lazy provider load settles inside this test rather than
  // landing in the next one.
  await waitFor(() =>
    expect(mockedCreateVimeoProvider).toHaveBeenCalledTimes(1)
  );
  const mount = document.querySelector<HTMLElement>(
    '[data-reely-part="media"]'
  )!;
  expect(mount.style.position).toBe('relative');
  expect(mount.style.zIndex).toBe('0');
  expect(mount.style.width).toBe('100%');
  expect(mount.style.height).toBe('100%');
});

// SIDEPRO-210: `loop` is a `Root` prop, and reaches this provider the same way
// `controls` does -- folded into the vimeo bag, not carried in `nativeOptions`,
// which `loadProvider` hands to the native and HLS providers only.
test("folds Root's loop into the vimeo provider option bag", async () => {
  render(
    <Player.Root
      loading="eager"
      loop
      source={{ type: 'vimeo', videoId: '76979871' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(mockedCreateVimeoProvider).toHaveBeenCalledTimes(1)
  );
  const [, , options] = mockedCreateVimeoProvider.mock.calls[0]!;
  expect(options).toMatchObject({ loop: true });
});

test('leaves the vimeo bag un-looped when Root omits the prop', async () => {
  render(
    <Player.Root
      loading="eager"
      source={{ type: 'vimeo', videoId: '76979871' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(mockedCreateVimeoProvider).toHaveBeenCalledTimes(1)
  );
  const [, , options] = mockedCreateVimeoProvider.mock.calls[0]!;
  expect(options?.loop).toBeUndefined();
});

// #214: `startTime` and `endTime` are `Root` props too, and reach this provider
// by the same fold `loop` takes. They used to travel only in `nativeOptions`,
// which `loadProvider` hands to the native and HLS providers alone, so both were
// silently inert on a Vimeo source.
test("folds Root's startTime and endTime into the vimeo provider option bag", async () => {
  render(
    <Player.Root
      endTime={20}
      loading="eager"
      source={{ type: 'vimeo', videoId: '76979871' }}
      startTime={12}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(mockedCreateVimeoProvider).toHaveBeenCalledTimes(1)
  );
  const [, , options] = mockedCreateVimeoProvider.mock.calls[0]!;
  expect(options).toMatchObject({ endTime: 20, startTime: 12 });
});

test('leaves the vimeo bag unbounded when Root omits the time props', async () => {
  render(
    <Player.Root
      loading="eager"
      source={{ type: 'vimeo', videoId: '76979871' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(mockedCreateVimeoProvider).toHaveBeenCalledTimes(1)
  );
  const [, , options] = mockedCreateVimeoProvider.mock.calls[0]!;
  expect(options?.startTime).toBeUndefined();
  expect(options?.endTime).toBeUndefined();
});

test('the loader rejects a Vimeo source without an embed mount', async () => {
  await expect(
    loadProvider({
      media: null,
      nativeOptions: {},
      source: { type: 'vimeo', videoId: '76979871' }
    })
  ).rejects.toThrow('The Vimeo provider requires a media mount.');
  expect(mockedCreateVimeoProvider).not.toHaveBeenCalled();
});

const emitVimeoReady = (
  fake: (typeof harness.fakes)[number],
  overrides: Partial<import('@reely/core').PlayerState> = {}
) =>
  act(() => {
    fake.emit({
      lifecycle: 'ready',
      activation: 'ready',
      muted: false,
      volume: 1,
      playbackRate: 1,
      ...overrides
    });
  });

test('replays desired preferences once the Vimeo provider is ready', async () => {
  render(
    <Player.Root
      loading="eager"
      muted
      playbackRate={1.5}
      source={{ type: 'vimeo', videoId: '76979871' }}
      volume={0.4}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(mockedCreateVimeoProvider).toHaveBeenCalledTimes(1)
  );
  const fake = harness.fakes[0]!;
  expect(fake.counts()).toMatchObject({
    muteCount: 0,
    playbackRateCount: 0,
    volumeCount: 0
  });

  emitVimeoReady(fake);

  await waitFor(() =>
    expect(fake.counts()).toMatchObject({
      muteCount: 1,
      playbackRateCount: 1,
      volumeCount: 1
    })
  );
});

test('forwards the Root controls prop to createVimeoProvider', async () => {
  render(
    <Player.Root
      controls
      loading="eager"
      source={{ type: 'vimeo', videoId: '76979871' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(mockedCreateVimeoProvider).toHaveBeenCalledTimes(1)
  );
  const [, , options] = mockedCreateVimeoProvider.mock.calls[0]!;
  expect(options).toEqual({ controls: true });
});

test('reaches createVimeoProvider as chromeless when controls is unset', async () => {
  render(
    <Player.Root
      loading="eager"
      source={{ type: 'vimeo', videoId: '76979871' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(mockedCreateVimeoProvider).toHaveBeenCalledTimes(1)
  );
  const [, , options] = mockedCreateVimeoProvider.mock.calls[0]!;
  expect(options).toEqual({ controls: undefined });
});

test('forwards the vimeo provider option bag to createVimeoProvider', async () => {
  render(
    <Player.Root
      loading="eager"
      providerOptions={{ vimeo: { customControls: true, dnt: false } }}
      source={{ type: 'vimeo', videoId: '76979871' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(mockedCreateVimeoProvider).toHaveBeenCalledTimes(1)
  );
  const [, , options] = mockedCreateVimeoProvider.mock.calls[0]!;
  expect(options).toEqual({
    controls: undefined,
    customControls: true,
    dnt: false
  });
});

// SIDEPRO's regression, mirrored from `youtube.test.tsx`: `providerOptionsEqual`
// in `use-activation.ts` must compare the `vimeo` bag by value, or a changed
// bag looks unchanged and the embed never re-attaches to pick it up. This is
// the trap: delete the `providerBagEqual(left?.vimeo, right?.vimeo)` line and
// this test fails, because the second render is then judged equal to the
// first and `createVimeoProvider` is never called again.
test('re-attaches the Vimeo adapter when the controls prop changes', async () => {
  const { rerender } = render(
    <Player.Root
      controls={false}
      loading="eager"
      source={{ type: 'vimeo', videoId: '76979871' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(mockedCreateVimeoProvider).toHaveBeenCalledTimes(1)
  );

  rerender(
    <Player.Root
      controls
      loading="eager"
      source={{ type: 'vimeo', videoId: '76979871' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(mockedCreateVimeoProvider).toHaveBeenCalledTimes(2)
  );
  const [, , options] = mockedCreateVimeoProvider.mock.calls[1]!;
  expect(options).toEqual({ controls: true });
  expect(harness.fakes[0]!.counts().destroyCount).toBe(1);
});

test('keeps the installed Vimeo adapter when a value-equal provider option bag is passed again', async () => {
  const { rerender } = render(
    <Player.Root
      loading="eager"
      providerOptions={{ vimeo: { customControls: true } }}
      source={{ type: 'vimeo', videoId: '76979871' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(mockedCreateVimeoProvider).toHaveBeenCalledTimes(1)
  );

  // A fresh object literal with the same values, as an inline prop produces
  // on every render.
  rerender(
    <Player.Root
      loading="eager"
      providerOptions={{ vimeo: { customControls: true } }}
      source={{ type: 'vimeo', videoId: '76979871' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );
  await act(async () => undefined);

  expect(mockedCreateVimeoProvider).toHaveBeenCalledTimes(1);
});

test('interaction loading keeps Vimeo sources dormant until the activation click', async () => {
  render(
    <Player.Root loading="interaction" source="https://vimeo.com/76979871">
      <Player.Viewport>
        <Player.Media />
        <Player.ActivationButton />
      </Player.Viewport>
    </Player.Root>
  );

  expect(mockedCreateVimeoProvider).not.toHaveBeenCalled();
  expect(document.querySelector('[data-reely-part="media"]')).toBeNull();

  act(() => {
    screen.getByRole('button', { name: 'Play video' }).click();
  });
  await waitFor(() =>
    expect(mockedCreateVimeoProvider).toHaveBeenCalledTimes(1)
  );
});
