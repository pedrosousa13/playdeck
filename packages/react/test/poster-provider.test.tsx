// @vitest-environment happy-dom

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { createVimeoProvider } from '@playdeck/provider-vimeo';
import { createYouTubeProvider } from '@playdeck/provider-youtube';
import * as Player from '../src/index';

const harness = vi.hoisted(() => ({
  fakes: [] as Array<{
    adapter: import('@playdeck/core').ProviderAdapter;
    counts: () => Record<string, number>;
    emit: (patch: import('@playdeck/core').ProviderStatePatch) => void;
  }>
}));

vi.mock('@playdeck/provider-youtube', async () => {
  const { createFakeProvider } = await import('./fixtures/fake-provider');
  return {
    createYouTubeProvider: vi.fn(() => {
      const fake = createFakeProvider({ provider: 'youtube' });
      harness.fakes.push(fake);
      return fake.adapter;
    })
  };
});

vi.mock('@playdeck/provider-vimeo', async () => {
  const { createFakeProvider } = await import('./fixtures/fake-provider');
  return {
    createVimeoProvider: vi.fn(() => {
      const fake = createFakeProvider({ provider: 'vimeo' });
      harness.fakes.push(fake);
      return fake.adapter;
    })
  };
});

const mockedCreateYouTubeProvider = vi.mocked(createYouTubeProvider);
const mockedCreateVimeoProvider = vi.mocked(createVimeoProvider);

afterEach(() => {
  cleanup();
  harness.fakes.length = 0;
  vi.clearAllMocks();
});

const posterImage = (): HTMLImageElement | null =>
  document.querySelector('[data-playdeck-part="poster-image"]');

// Consumers who never touch `poster` are the overwhelming majority, and the
// issue's own acceptance criterion is that they see no behavioural change at
// all -- not "unlikely to notice one".
test('renders no default poster image when Root sets no poster prop', async () => {
  render(
    <Player.Root
      loading="eager"
      source="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    >
      <Player.Viewport>
        <Player.Media />
        <Player.Poster />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(mockedCreateYouTubeProvider).toHaveBeenCalledTimes(1)
  );
  act(() => {
    harness.fakes[0]!.emit({
      lifecycle: 'ready',
      activation: 'ready',
      providerPosterUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
    });
  });

  expect(posterImage()).toBeNull();
});

test('poster="provider" renders the resolved still as Player.Poster\'s default image', async () => {
  render(
    <Player.Root
      loading="eager"
      poster="provider"
      source="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    >
      <Player.Viewport>
        <Player.Media />
        <Player.Poster />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(mockedCreateYouTubeProvider).toHaveBeenCalledTimes(1)
  );
  expect(posterImage()).toBeNull();

  act(() => {
    harness.fakes[0]!.emit({
      lifecycle: 'ready',
      activation: 'ready',
      providerPosterUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
    });
  });

  await waitFor(() =>
    expect(posterImage()?.getAttribute('src')).toBe(
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
    )
  );
});

test('a literal poster URL populates the default image without any provider request', async () => {
  render(
    <Player.Root
      loading="eager"
      poster="https://example.com/mine.jpg"
      source="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    >
      <Player.Viewport>
        <Player.Media />
        <Player.Poster />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(posterImage()?.getAttribute('src')).toBe(
      'https://example.com/mine.jpg'
    )
  );
});

test('a consumer-supplied poster wins over the resolved provider still', async () => {
  render(
    <Player.Root
      loading="eager"
      poster="provider"
      source="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    >
      <Player.Viewport>
        <Player.Media />
        <Player.Poster>
          <Player.PosterImage src="https://example.com/mine.jpg" />
        </Player.Poster>
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(mockedCreateYouTubeProvider).toHaveBeenCalledTimes(1)
  );
  act(() => {
    harness.fakes[0]!.emit({
      lifecycle: 'ready',
      activation: 'ready',
      providerPosterUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
    });
  });

  await waitFor(() =>
    expect(posterImage()?.getAttribute('src')).toBe(
      'https://example.com/mine.jpg'
    )
  );
});

test('folds poster="provider" into the vimeo bag as resolvePoster', async () => {
  render(
    <Player.Root
      loading="eager"
      poster="provider"
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
  expect(options).toMatchObject({ resolvePoster: true });
});

test('leaves the vimeo bag opted out of resolvePoster when Root has no poster prop', async () => {
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
  expect(options).toMatchObject({ resolvePoster: false });
});
