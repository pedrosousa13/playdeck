import * as Player from '@playdeck/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import { withCss } from '../.storybook/theme';
import { assetUrl } from './asset-url';
import { Frame, posterImage } from './support';
// The stylesheet the Styled story mounts, read as text so the same string is
// both what renders and what the docs block below prints. `?raw` and not
// `?inline` for the reason spelled out in play-button.stories.tsx: a production
// build minifies `?inline` css, and the printed example has to stay readable.
import partCss from '../../../examples/css-poster.css?raw';

const meta = {
  title: 'Player/Poster',
  component: Player.Poster,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.Poster` is the pre-playback surface; wrap a `Player.PosterImage` or arbitrary children.',
          '',
          '**Contract** — `data-playdeck-part="poster"`, `data-state="visible" | "hidden"`. Two values, not the four `Player.PosterImage` carries: this part reports whether the pre-playback surface is showing, and `Player.Root` flips it to `hidden` once the media for the current source has data or playback starts. A new source brings it back to `visible`. The primitive also sets `visibility` inline from the same signal, so the surface disappears without a stylesheet.',
          '',
          '**Note** — children replace the default image.',
          '',
          "**Poster image states** — the bitmap's own load lifecycle (`idle`, `loading`, `loaded`, `error`) is a different attribute on a different part: `data-state` on `Player.PosterImage`, staged under `Player/PosterImage`. Neither story below stages `hidden` — nothing here plays, so the surface is `visible` throughout.",
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
        <Player.PosterImage src={assetUrl('poster.svg')} />
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
