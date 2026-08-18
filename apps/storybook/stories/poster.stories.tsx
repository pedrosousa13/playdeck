import * as Player from '@playdeck/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import type { ReactNode } from 'react';
import { withCss } from '../.storybook/theme';
// The stylesheet the Styled story mounts, read as text so the same string is
// both what renders and what the docs block below prints. `?raw` and not
// `?inline` for the reason spelled out in play-button.stories.tsx: a production
// build minifies `?inline` css, and the printed example has to stay readable.
import partCss from '../../../examples/css-poster.css?raw';

const Frame = ({ children }: { readonly children: ReactNode }) => (
  <Player.Viewport style={{ width: 480, height: 270, background: '#0b0e13' }}>
    {children}
  </Player.Viewport>
);

const posterImage = (canvasElement: HTMLElement): HTMLElement => {
  const image = canvasElement.querySelector<HTMLElement>(
    '[data-playdeck-part="poster-image"]'
  );
  if (!image) throw new Error('Expected a poster image in the story.');
  return image;
};

const meta = {
  title: 'Player/Poster',
  component: Player.Poster,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.Poster` is the pre-playback surface; wrap a `Player.PosterImage` or arbitrary children.',
          '',
          '**Contract** — `data-playdeck-part="poster"`, `data-state`.',
          '',
          '**Note** — children replace the default image.',
          '',
          "**Poster image states** — the bitmap's own load lifecycle (`idle`, `loading`, `loaded`, `error`) belongs to `Player.PosterImage` and is staged under `Player/PosterImage`.",
          '',
          '**Styling** — plain CSS against the parts; the primitive keeps its own geometry and `visibility`. The `Styled` story below mounts this file as its own `<style>`. Turning the Theme toolbar toggle on adds `theme.css` underneath, not over: everything here is unlayered, and unlayered CSS beats the `@layer playdeck` the whole theme lives in:',
          '```css',
          partCss.trim(),
          '```'
        ].join('\n')
      }
    }
  }
} satisfies Meta<typeof Player.Poster>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The same poster with the CSS from this page's **Styling** section applied.
 * Mounted as a `<style>` inside this story's own tree, so it is torn down with
 * the story and no other story on the page sees it.
 *
 * The `loaded` state needs a poster the image actually reaches `loaded` on;
 * `isPermittedSourceUrl` refuses `data:` (#236), so this uses `/poster.svg`
 * from this app's `staticDirs` instead of an inline data URI.
 */
export const Styled: Story = {
  decorators: [withCss(partCss)],
  render: () => (
    <Frame>
      <Player.Poster>
        <Player.PosterImage src="/poster.svg" />
      </Player.Poster>
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    const image = posterImage(canvasElement);
    await waitFor(() => expect(image).toHaveAttribute('data-state', 'loaded'));
    // The `[data-state='loaded']` rule, not the base one: the image starts at
    // opacity 0 and only the state selector brings it back.
    await waitFor(() =>
      expect(globalThis.getComputedStyle(image).opacity).toBe('1')
    );
  }
};

/** `Player.Poster` accepts arbitrary children instead of an image. */
export const CustomChild: Story = {
  render: () => (
    <Frame>
      <Player.Poster>
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'grid',
            placeItems: 'center',
            color: '#e8edf4',
            fontFamily: 'system-ui, sans-serif',
            background: 'linear-gradient(135deg, #16324f, #0b0e13)'
          }}
        >
          Custom poster content
        </div>
      </Player.Poster>
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    const poster = canvasElement.querySelector('[data-playdeck-part="poster"]');
    await expect(poster).toHaveTextContent('Custom poster content');
  }
};
