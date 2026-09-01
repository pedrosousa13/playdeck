import * as Player from '@playdeck/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import { assetUrl } from './asset-url';
import { Frame, posterImage } from './support';

const meta = {
  title: 'Player/PosterImage',
  component: Player.PosterImage,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.PosterImage` renders the poster bitmap and tracks its own load lifecycle.',
          '',
          '**Contract** — `data-playdeck-part="poster-image"`, `data-state="idle" | "loading" | "loaded" | "error"`.',
          '',
          '**Capability** — not gated; state is driven purely by the image load.'
        ].join('\n')
      }
    }
  }
} satisfies Meta<typeof Player.PosterImage>;

export default meta;

type Story = StoryObj<typeof meta>;

/** No source configured: the image idles without requesting anything. */
export const Idle: Story = {
  render: () => (
    <Frame>
      <Player.Poster>
        <Player.PosterImage />
      </Player.Poster>
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    await expect(posterImage(canvasElement)).toHaveAttribute(
      'data-state',
      'idle'
    );
  }
};

/**
 * The dev server holds `/__playdeck__/pending.png` open forever, so the image
 * stays in `loading` deterministically. In a static Storybook build the URL
 * 404s and this story falls through to the error state instead.
 */
export const Loading: Story = {
  render: () => (
    <Frame>
      <Player.Poster>
        <Player.PosterImage src="/__playdeck__/pending.png" />
      </Player.Poster>
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    await expect(posterImage(canvasElement)).toHaveAttribute(
      'data-state',
      'loading'
    );
  }
};

/**
 * `isPermittedSourceUrl` refuses `data:` for a poster (#236), so a poster
 * fixture has to be a real request now. `/poster.svg` is served from this
 * app's `staticDirs`, and it resolves fast enough that the test's `waitFor`
 * catches `loaded` deterministically.
 */
export const Loaded: Story = {
  render: () => (
    <Frame>
      <Player.Poster>
        <Player.PosterImage src={assetUrl('poster.svg')} />
      </Player.Poster>
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(posterImage(canvasElement)).toHaveAttribute('data-state', 'loaded')
    );
  }
};

/**
 * A root-relative path with no matching asset 404s in both the dev server
 * and a static build, which is a request the image can fail deterministically
 * -- `data:` would have been refused outright by `isPermittedSourceUrl` (#236)
 * before the image ever got a URL to fail on.
 */
export const ErrorState: Story = {
  name: 'Error',
  render: () => (
    <Frame>
      <Player.Poster>
        <Player.PosterImage src="/__playdeck__/missing-poster.png" />
      </Player.Poster>
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(posterImage(canvasElement)).toHaveAttribute('data-state', 'error')
    );
  }
};
