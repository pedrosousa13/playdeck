// @vitest-environment happy-dom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { createYouTubeProvider } from '@reely/provider-youtube';
import * as Player from '../src/index';
import { loadProvider } from '../src/provider-loaders';

const harness = vi.hoisted(() => ({
  fakes: [] as Array<{
    adapter: import('@reely/core').ProviderAdapter;
    counts: () => Record<string, number>;
    emit: (patch: import('@reely/core').ProviderStatePatch) => void;
  }>
}));

vi.mock('@reely/provider-youtube', async () => {
  const { createFakeProvider } = await import('./fixtures/fake-provider');
  return {
    createYouTubeProvider: vi.fn(() => {
      const fake = createFakeProvider({ provider: 'youtube' });
      harness.fakes.push(fake);
      return fake.adapter;
    })
  };
});

const mockedCreateYouTubeProvider = vi.mocked(createYouTubeProvider);

afterEach(() => {
  cleanup();
  harness.fakes.length = 0;
  vi.clearAllMocks();
});

test('loads the YouTube adapter lazily against an embed mount', async () => {
  render(
    <Player.Root
      loading="eager"
      source="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    >
      <Player.Viewport data-testid="viewport">
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(mockedCreateYouTubeProvider).toHaveBeenCalledTimes(1)
  );
  const [mount, videoId] = mockedCreateYouTubeProvider.mock.calls[0]!;
  expect(videoId).toBe('dQw4w9WgXcQ');
  expect(mount).toBeInstanceOf(HTMLDivElement);
  expect((mount as HTMLElement).dataset.reelyPart).toBe('media');
  expect(document.querySelector('video')).toBeNull();
});

test('sizes the YouTube embed mount to fill its viewport by default', async () => {
  // #150: the mount states its geometry inline, so it fills the viewport for a
  // consumer who ships no stylesheet. `style-precedence.test.tsx` pins that
  // each of these is overridable.
  render(
    <Player.Root
      loading="eager"
      source={{ type: 'youtube', videoId: 'dQw4w9WgXcQ' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  // Awaited so the lazy provider load settles inside this test rather than
  // landing in the next one.
  await waitFor(() =>
    expect(mockedCreateYouTubeProvider).toHaveBeenCalledTimes(1)
  );
  const mount = document.querySelector<HTMLElement>(
    '[data-reely-part="media"]'
  )!;
  expect(mount.style.position).toBe('relative');
  expect(mount.style.zIndex).toBe('0');
  expect(mount.style.width).toBe('100%');
  expect(mount.style.height).toBe('100%');
});

test('the loader rejects a YouTube source without an embed mount', async () => {
  await expect(
    loadProvider({
      media: null,
      nativeOptions: {},
      source: { type: 'youtube', videoId: 'dQw4w9WgXcQ' }
    })
  ).rejects.toThrow('The YouTube provider requires a media mount.');
  expect(mockedCreateYouTubeProvider).not.toHaveBeenCalled();
});

const emitYouTubeReady = (
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

test('replays desired preferences once the YouTube provider is ready', async () => {
  render(
    <Player.Root
      loading="eager"
      muted
      playbackRate={1.5}
      source={{ type: 'youtube', videoId: 'dQw4w9WgXcQ' }}
      volume={0.5}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(mockedCreateYouTubeProvider).toHaveBeenCalledTimes(1)
  );
  const fake = harness.fakes[0]!;
  expect(fake.counts()).toMatchObject({
    muteCount: 0,
    playbackRateCount: 0,
    volumeCount: 0
  });

  emitYouTubeReady(fake);

  await waitFor(() =>
    expect(fake.counts()).toMatchObject({
      muteCount: 1,
      playbackRateCount: 1,
      volumeCount: 1
    })
  );
});

test('replays uncontrolled default preferences once the provider is ready', async () => {
  render(
    <Player.Root
      defaultMuted
      loading="eager"
      source={{ type: 'youtube', videoId: 'dQw4w9WgXcQ' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(mockedCreateYouTubeProvider).toHaveBeenCalledTimes(1)
  );
  const fake = harness.fakes[0]!;

  emitYouTubeReady(fake);

  await waitFor(() => expect(fake.counts()).toMatchObject({ muteCount: 1 }));
  expect(fake.counts()).toMatchObject({ unmuteCount: 0, volumeCount: 0 });
});

test('skips the preference replay when the ready state already matches', async () => {
  render(
    <Player.Root
      loading="eager"
      source={{ type: 'youtube', videoId: 'dQw4w9WgXcQ' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(mockedCreateYouTubeProvider).toHaveBeenCalledTimes(1)
  );
  const fake = harness.fakes[0]!;

  emitYouTubeReady(fake);
  emitYouTubeReady(fake);

  await waitFor(() =>
    expect(fake.counts()).toMatchObject({
      muteCount: 0,
      playbackRateCount: 0,
      unmuteCount: 0,
      volumeCount: 0
    })
  );
});

test('renders no Reely control layer over a ready YouTube embed', async () => {
  render(
    <Player.Root
      loading="interaction"
      source={{ type: 'youtube', videoId: 'dQw4w9WgXcQ' }}
    >
      <Player.Viewport data-testid="viewport">
        <Player.Media />
        <Player.ActivationButton />
        <Player.LoadingIndicator />
      </Player.Viewport>
    </Player.Root>
  );

  expect(mockedCreateYouTubeProvider).not.toHaveBeenCalled();

  screen.getByRole('button', { name: 'Play video' }).click();
  await waitFor(() =>
    expect(mockedCreateYouTubeProvider).toHaveBeenCalledTimes(1)
  );

  act(() => {
    harness.fakes[0]!.emit({
      lifecycle: 'ready',
      activation: 'ready',
      capabilities: {
        seek: { status: 'available' },
        setVolume: { status: 'available' },
        setPlaybackRate: { status: 'available' },
        selectQuality: { status: 'unavailable', reason: 'provider' },
        selectTextTrack: { status: 'unavailable', reason: 'source' },
        fullscreen: { status: 'available' },
        pictureInPicture: { status: 'unavailable', reason: 'provider' },
        airPlay: { status: 'unavailable', reason: 'provider' },
        customControls: { status: 'unavailable', reason: 'policy' }
      }
    });
  });

  await waitFor(() => {
    expect(document.querySelector('[data-reely-part="activation"]')).toBeNull();
  });
  // The live region persists (for announcements) but is idle and empty over a
  // ready embed — no active loading layer. Awaited rather than asserted
  // synchronously: the indicator holds a provider load for a 500ms minimum so
  // a fast load does not strobe it (#35), and this embed loads instantly.
  const loadingIndicator = document.querySelector(
    '[data-reely-part="loading-indicator"]'
  );
  await waitFor(
    () => expect(loadingIndicator?.getAttribute('data-state')).toBe('idle'),
    { timeout: 2_000 }
  );
  expect(loadingIndicator?.textContent).toBe('');
  expect(document.querySelector('[data-reely-part="media"]')).not.toBeNull();
});
