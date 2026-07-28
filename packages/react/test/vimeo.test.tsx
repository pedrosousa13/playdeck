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
