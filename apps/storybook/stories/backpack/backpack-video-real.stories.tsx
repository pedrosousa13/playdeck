import type { Meta, StoryObj } from '@storybook/react-vite';
import { withCss } from '../../.storybook/theme';
import { backpackVideoCss } from './backpack-video-css';
import { BackpackVideo } from './backpack-video';

// The wrapper against real providers: real embeds, real network. Excluded from
// the deterministic story test suite (`!test`) and opted out of the mock player
// (`real-playback`), so each story below renders the wrapper's own
// `Player.Root` with nothing staged into it — which is the point. These are
// what show that `BackpackVideo` attaches a provider rather than only working
// against a mock; `Backpack parity/Video` covers the behaviour deterministically.

const meta = {
  title: 'Real playback/BackpackVideo',
  component: BackpackVideo,
  tags: ['real-playback', '!test'],
  decorators: [withCss(backpackVideoCss('640px'))],
  parameters: {
    docs: {
      description: {
        component:
          "The `BackpackVideo` wrapper driving real providers. Click the player to load and start it: without `playing`, the wrapper loads on interaction and `Player.ActivationButton` is the click target until the provider attaches, after which the wrapper's own play/pause toggle takes over. `StartsPlaying` needs no click — `playing` makes the wrapper load eagerly and autoplay. Real network, so these are excluded from the deterministic story test suite (tagged `!test`)."
      }
    }
  }
} satisfies Meta<typeof BackpackVideo>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Click the surface: Reely loads the Vimeo provider and the embed attaches. */
export const Vimeo: Story = {
  args: { url: 'https://vimeo.com/336066147', muted: true }
};

/** The same, resolving to the YouTube provider from the URL alone. */
export const YouTube: Story = {
  args: { url: 'https://www.youtube.com/watch?v=mhN3E_hlWmU', muted: true }
};

/**
 * Backpack's `playing` — "start playing on load". No click: the wrapper loads
 * eagerly and autoplays muted, which is the only way Reely permits a player to
 * start by itself.
 */
export const StartsPlaying: Story = {
  args: { url: 'https://vimeo.com/336066147', muted: true, playing: true }
};

/** `controls` with a real provider attached, alongside the real embed. */
export const WithControls: Story = {
  args: { url: 'https://vimeo.com/336066147', muted: true, controls: true }
};
