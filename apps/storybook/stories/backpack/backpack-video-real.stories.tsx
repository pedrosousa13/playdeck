import type { Meta, StoryObj } from '@storybook/react-vite';
import { withCss } from '../../.storybook/theme';
import { backpackVideoCss } from './backpack-video-css';
import { BackpackVideo } from './backpack-video';
import { InPageLayout } from './in-page-layout';

// The wrapper against real providers: real embeds, real network. Excluded from
// the deterministic story test suite (`!test`) and opted out of the mock player
// (`real-playback`), so each story below renders the wrapper's own
// `Player.Root` with nothing staged into it — which is the point. These are
// what show that `BackpackVideo` attaches a provider rather than only working
// against a mock; `Backpack parity/Video` covers the behaviour deterministically.

/** Backpack's own cover photo, as its `Video.stories.tsx` stories pass it. */
const coverImageUrl =
  'https://a.storyblok.com/f/171771/4656x3492/bbf48d4721/wojciech-then-dija5f0vogq-unsplash.jpg';

const meta = {
  title: 'Real playback/BackpackVideo',
  component: BackpackVideo,
  tags: ['real-playback', '!test'],
  decorators: [withCss(backpackVideoCss('640px'))],
  parameters: {
    docs: {
      description: {
        component:
          "The `BackpackVideo` wrapper driving real providers. Click the player to load and start it: without `playing`, the wrapper loads on interaction and `Player.ActivationButton` is the click target until the provider attaches, after which the wrapper's own play/pause toggle takes over. `StartsPlaying` needs no click — `playing` makes the wrapper load eagerly and autoplay. The `light` and cover-image stories fetch a real thumbnail or load a real cover image, which is why they live here rather than in the deterministic suite. Real network, so these are excluded from the deterministic story test suite (tagged `!test`)."
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

/**
 * Backpack's `Light` args: fetches Vimeo's own oEmbed thumbnail and shows it
 * as a cover until the player is activated.
 */
export const Light: Story = {
  args: { url: 'https://vimeo.com/336066147', muted: true, light: true }
};

/** The same, with the cover's hover-zoom disabled. */
export const WithoutHoverEffect: Story = {
  args: {
    url: 'https://vimeo.com/336066147',
    muted: true,
    light: true,
    hoverEffect: false
  }
};

/**
 * Backpack keeps `VimeoCoverImage` as its own story even though its args are
 * identical to `Light`'s — this duplicates that here too, so the matrix row
 * maps one-to-one to a Reely story of its own.
 */
export const VimeoCoverImage: Story = {
  args: { url: 'https://vimeo.com/336066147', muted: true, light: true }
};

/**
 * Backpack's `YouTubeCoverImage` args: the same fetched-thumbnail cover, over
 * YouTube's oEmbed endpoint.
 */
export const YouTubeCoverImage: Story = {
  args: {
    url: 'https://www.youtube.com/watch?v=mhN3E_hlWmU',
    muted: true,
    light: true
  }
};

/**
 * Backpack's `CustomCoverImage` args, verbatim: its own image wins over the
 * fetched Vimeo thumbnail.
 */
export const CustomCoverImage: Story = {
  args: {
    url: 'https://vimeo.com/336066147',
    muted: true,
    light: true,
    placeholderImageSrc: coverImageUrl,
    alt: 'custom cover image'
  }
};

/** The same, over YouTube. */
export const CustomCoverImageYouTube: Story = {
  args: {
    url: 'https://www.youtube.com/watch?v=mhN3E_hlWmU',
    muted: true,
    light: true,
    placeholderImageSrc: coverImageUrl,
    alt: 'custom cover image'
  }
};

/** Backpack's `WithRenderCustomImage` args, verbatim. */
export const WithRenderCustomImage: Story = {
  args: {
    url: 'https://vimeo.com/336066147',
    muted: true,
    light: true,
    placeholderImageSrc: coverImageUrl,
    renderCustomImage: (props) => (
      <img
        id="custom-framework-image"
        {...props}
        alt="custom framework element"
      />
    )
  }
};

/**
 * Backpack's `YouTubeShortsVideoAndCustomCoverImage` args minus
 * `aspectRatios: '9/16'`, which SIDEPRO-202 brings.
 */
export const YouTubeShortsVideoAndCustomCoverImage: Story = {
  args: {
    url: 'https://www.youtube.com/shorts/n3eC51ZaDlk',
    muted: true,
    light: false,
    placeholderImageSrc: coverImageUrl,
    alt: 'custom cover image',
    hoverEffect: true
  }
};

/*
 * Backpack's three `InPageLayout` stories, with its args verbatim. Click the
 * video to start it, then scroll the panel: `pauseOnOutOfViewport` pauses it
 * when it leaves and resumes it when it comes back, and the badge in the
 * panel's top-right tracks what `onPlayChange` reports.
 *
 * `InPage` is muted where the other two are not — Backpack's own inconsistency
 * (`Video.stories.tsx:367-395`), reproduced rather than tidied, since these
 * stories exist to carry its args. Unmuted playback works here because it takes
 * a click to start: what a browser blocks is an *autoplay* with sound, which is
 * `playing` rather than anything on this page. `Backpack parity/Video` covers
 * the behaviour deterministically, and stays muted throughout.
 *
 * All three render the wrapper in that layout at Backpack's own `h-screen`, so
 * the render is the factory below and each story is its args.
 */

const inPageStory = (args: Story['args']): Story => ({
  args,
  parameters: { layout: 'fullscreen' },
  render: (storyArgs) => (
    <InPageLayout
      height="100vh"
      video={(videoProps) => <BackpackVideo {...storyArgs} {...videoProps} />}
    />
  )
});

/** Backpack's `InPage`: `pauseOnOutOfViewport` on, muted. */
export const InPage: Story = inPageStory({
  url: 'https://vimeo.com/336066147',
  muted: true,
  pauseOnOutOfViewport: true
});

/** Backpack's `WithoutPauseOnOutOfViewport`: it keeps playing off screen. */
export const WithoutPauseOnOutOfViewport: Story = inPageStory({
  url: 'https://vimeo.com/336066147',
  muted: false,
  pauseOnOutOfViewport: false
});

/** Backpack's `WithPauseOnOutOfViewport`: the same as `InPage`, unmuted. */
export const WithPauseOnOutOfViewport: Story = inPageStory({
  url: 'https://vimeo.com/336066147',
  muted: false,
  pauseOnOutOfViewport: true
});
