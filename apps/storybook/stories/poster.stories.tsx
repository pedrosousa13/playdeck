import * as Player from '@reely/react';
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

const loadedPosterSrc = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#1d2733"/><circle cx="800" cy="450" r="180" fill="#3f8cff"/></svg>'
)}`;

const posterImage = (canvasElement: HTMLElement): HTMLElement => {
  const image = canvasElement.querySelector<HTMLElement>(
    '[data-reely-part="poster-image"]'
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
          '**Contract** — `data-reely-part="poster"`, `data-state="visible" | "hidden"`. The state is derived, so the `visibility` it computes is written after the consumer\'s `style` prop and cannot be overridden.',
          '',
          "**Note** — children replace the default image. The bitmap's own load lifecycle (`idle`/`loading`/`loaded`/`error`) belongs to `Player.PosterImage` and is documented on its page.",
          '',
          '**Styling** — plain CSS against the parts; the primitive keeps its own geometry and `visibility`. The `Styled` story below mounts this file as its own `<style>`. Turning the Theme toolbar toggle on adds `theme.css` underneath, not over: everything here is unlayered, and unlayered CSS beats the `@layer reely` the whole theme lives in:',
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
 * Poster's own contract, which is the surface rather than the bitmap inside it:
 * the part name, the `data-state` it publishes, the `aria-hidden` that keeps a
 * decorative overlay out of the accessibility tree, and the `visibility` it
 * derives from that state.
 *
 * Only `visible` is reachable here. `hidden` is set from a real `loadeddata`
 * on a real media element, which the mock provider never fires — so the
 * transition is covered where it can be driven for real, in `e2e/poster.spec.ts`.
 */
export const Default: Story = {
  render: () => (
    <Frame>
      <Player.Poster>
        <Player.PosterImage src={loadedPosterSrc} />
      </Player.Poster>
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    const poster = canvasElement.querySelector<HTMLElement>(
      '[data-reely-part="poster"]'
    );
    if (!poster) throw new Error('Expected a poster in the story.');
    await expect(poster).toHaveAttribute('data-state', 'visible');
    await expect(poster).toHaveAttribute('aria-hidden', 'true');
    await expect(globalThis.getComputedStyle(poster).visibility).toBe(
      'visible'
    );
  }
};

/**
 * The same poster with the CSS from this page's **Styling** section applied.
 * Mounted as a `<style>` inside this story's own tree, so it is torn down with
 * the story and no other story on the page sees it.
 */
export const Styled: Story = {
  decorators: [withCss(partCss)],
  render: () => (
    <Frame>
      <Player.Poster>
        <Player.PosterImage src={loadedPosterSrc} />
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
    const poster = canvasElement.querySelector('[data-reely-part="poster"]');
    await expect(poster).toHaveTextContent('Custom poster content');
  }
};
