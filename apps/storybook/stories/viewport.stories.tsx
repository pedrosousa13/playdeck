import * as Player from '@playdeck/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { withCss } from '../.storybook/theme';
// The one consumer rule under test here, read as text so what is mounted is
// the same file the Contract docs page prints and `pnpm docs:check` gates.
// `?raw` and not `?inline` for the reason spelled out in
// play-button.stories.tsx: a production build minifies `?inline` css.
import aspectRatioCss from '../../../examples/css-media-aspect-ratio.css?raw';

// `Real playback/AspectRatio` shows this rule against real media and is tagged
// `!test` for it. These stories are the other half: no media at all, so they
// run in the deterministic browser suite, where a real Chromium actually
// resolves `var()` and computes an `aspect-ratio`. happy-dom does not — it
// stores custom properties but resolves nothing — so this is the only place
// the fallback half of the contract can be verified rather than demonstrated.
const meta = {
  title: 'Player/Viewport',
  component: Player.Viewport,
  // Mounted inside each story's own tree, so it is torn down with the story
  // rather than reshaping every other player on the page.
  decorators: [withCss(aspectRatioCss)],
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.Viewport` is the box every other part is laid into, and the node the library writes `--playdeck-media-aspect-ratio` onto once a provider has measured its media.',
          '',
          '**Contract** — renders `data-playdeck-part="viewport"`. The custom property is written imperatively and is *absent* until something is measured, which is what lets a consumer rule supply its own fallback:',
          '```css',
          aspectRatioCss.trim(),
          '```'
        ].join('\n')
      }
    }
  },
  render: () => <Player.Viewport style={{ width: 240 }} />
} satisfies Meta<typeof Player.Viewport>;

export default meta;

type Story = StoryObj<typeof meta>;

const viewport = (canvasElement: HTMLElement): HTMLElement => {
  const node = canvasElement.querySelector<HTMLElement>(
    '[data-playdeck-part="viewport"]'
  );
  if (!node) throw new Error('No viewport part rendered.');
  return node;
};

/**
 * No provider has measured anything, so the property is never written and the
 * consumer's own fallback is what shapes the box. This is every YouTube
 * player, and every other source until its metadata lands.
 */
export const UnmeasuredFallback: Story = {
  play: async ({ canvasElement }) => {
    const node = viewport(canvasElement);

    // Absent, not empty-valued: the inline style carries no such property at
    // all, which is the precondition for `var()` reaching its fallback.
    await expect(
      node.style.getPropertyValue('--playdeck-media-aspect-ratio')
    ).toBe('');
    // The assertion the whole rule exists for, and the one only a real browser
    // can make: the computed `aspect-ratio` resolved to the fallback.
    await expect(globalThis.getComputedStyle(node).aspectRatio).toBe('16 / 9');
  }
};

/**
 * The same rule, once a provider has published a portrait measurement through
 * the real controller channel. Proves the box follows the property rather than
 * the fallback being a coincidence.
 */
export const MeasuredRatio: Story = {
  parameters: { player: { dimensions: { width: 360, height: 640 } } },
  play: async ({ canvasElement }) => {
    const node = viewport(canvasElement);

    await expect(
      node.style.getPropertyValue('--playdeck-media-aspect-ratio')
    ).toBe('360 / 640');
    await expect(globalThis.getComputedStyle(node).aspectRatio).toBe(
      '360 / 640'
    );
  }
};
