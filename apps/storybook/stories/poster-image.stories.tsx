import * as Player from '@reely/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import type { ReactNode } from 'react';

const Frame = ({ children }: { readonly children: ReactNode }) => (
  <Player.Viewport style={{ width: 480, height: 270, background: '#0b0e13' }}>
    {children}
  </Player.Viewport>
);

const loadedSrc = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#1d2733"/></svg>'
)}`;

const image = (root: HTMLElement): HTMLElement => {
  const el = root.querySelector<HTMLElement>(
    '[data-reely-part="poster-image"]'
  );
  if (!el) throw new Error('Expected a poster image in the story.');
  return el;
};

const meta = {
  title: 'Player/PosterImage',
  component: Player.PosterImage,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.PosterImage` renders the poster bitmap and tracks its own load lifecycle.',
          '',
          '**Contract** — `data-reely-part="poster-image"`, `data-state="idle" | "loading" | "loaded" | "error"`.',
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
    await expect(image(canvasElement)).toHaveAttribute('data-state', 'idle');
  }
};

/**
 * The dev server holds `/__reely__/pending.png` open forever, so the image
 * stays in `loading` deterministically. In a static Storybook build the URL
 * 404s and this story falls through to the error state instead.
 */
export const Loading: Story = {
  render: () => (
    <Frame>
      <Player.Poster>
        <Player.PosterImage src="/__reely__/pending.png" />
      </Player.Poster>
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    await expect(image(canvasElement)).toHaveAttribute('data-state', 'loading');
  }
};

/** A data-URI poster resolves without any request leaving the page. */
export const Loaded: Story = {
  render: () => (
    <Frame>
      <Player.Poster>
        <Player.PosterImage src={loadedSrc} />
      </Player.Poster>
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(image(canvasElement)).toHaveAttribute('data-state', 'loaded')
    );
  }
};

/** An unparsable data URI fails to decode without touching the network. */
export const ErrorState: Story = {
  name: 'Error',
  render: () => (
    <Frame>
      <Player.Poster>
        <Player.PosterImage src="data:image/png;base64,AAAA" />
      </Player.Poster>
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(image(canvasElement)).toHaveAttribute('data-state', 'error')
    );
  }
};
