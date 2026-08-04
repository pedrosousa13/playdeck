import type { Meta, StoryObj } from '@storybook/react-vite';
import { withCss } from '../../.storybook/theme';
import { BackpackAutoplayVideo } from './backpack-autoplay-video';
import { backpackVideoCss } from './backpack-video-styles';
import { InPageLayout } from './in-page-layout';

/*
 * `BackpackAutoplayVideo` against a real provider: real embed, real network.
 * Excluded from the deterministic story test suite (`!test`) and opted out of
 * the mock player (`real-playback`), so each story renders the composition's own
 * `Player.Root` with nothing staged into it — which is the point.
 *
 * A file of its own rather than more stories in `backpack-video-real.stories.tsx`
 * for the same reason the deterministic suites are two files: this is a
 * different component with a different props type, and it needs the 600px box
 * Backpack's `AutoplayVideo` stories use where those need 480px.
 *
 * These carry Backpack's own args, the Vimeo URL and the `a.storyblok.com` image
 * included. They are also the only place the loading strategy can be watched
 * doing its job: nothing is requested until the player's own box scrolls
 * into view, and the video starts there by itself. The deterministic suite has to stage a
 * provider to see any playback at all, which bypasses exactly that —
 * `backpack-autoplay-video.stories.tsx`'s header says so at length.
 */

/** Backpack's own cover photo, as its `AutoplayVideo.stories.tsx` passes it. */
const coverImageUrl =
  'https://a.storyblok.com/f/171771/4656x3492/bbf48d4721/wojciech-then-dija5f0vogq-unsplash.jpg';

const vimeoUrl = 'https://vimeo.com/336066147';

const meta = {
  title: 'Real playback/BackpackAutoplayVideo',
  component: BackpackAutoplayVideo,
  tags: ['real-playback', '!test'],
  decorators: [withCss(backpackVideoCss('600px'))],
  parameters: {
    docs: {
      description: {
        component:
          'The `BackpackAutoplayVideo` composition driving a real Vimeo embed. Nothing to click: the provider is loaded when the player box first scrolls into view, with no preload margin, and muted autoplay starts it as soon as that provider reports ready. `InPage` is where both halves are visible at once — scroll the panel and the video loads and starts on the way in, then pauses when it leaves and resumes when it comes back. Real network, so these are excluded from the deterministic story test suite (tagged `!test`); `Backpack parity/AutoplayVideo` covers the behaviour deterministically.'
      }
    }
  }
} satisfies Meta<typeof BackpackAutoplayVideo>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Backpack's `Default` args, verbatim. */
export const Default: Story = {
  args: { url: vimeoUrl }
};

/**
 * Backpack's `WithCustomPlaceholderImage` args, verbatim: its own image covers
 * the player until autoplay starts, rather than until something is clicked.
 */
export const WithCustomPlaceholderImage: Story = {
  args: {
    url: vimeoUrl,
    placeholderImageSrc: coverImageUrl,
    alt: 'Custom placeholder image'
  }
};

/**
 * Backpack's `InPage` args — `WithCustomPlaceholderImage`'s, in a scroll
 * container — at Backpack's own full-height panel, as
 * `Real playback/BackpackVideo`'s three in-page stories do.
 *
 * The one story where the whole mechanism is on screen at once: scroll down and
 * nothing has been requested yet, then the video loads and starts as its box
 * crosses into view, and the badge in the panel's top-right follows
 * `onPlayChange` from there as it leaves and comes back.
 */
export const InPage: Story = {
  args: {
    url: vimeoUrl,
    placeholderImageSrc: coverImageUrl,
    alt: 'Custom placeholder image'
  },
  parameters: { layout: 'fullscreen' },
  render: (args) => (
    <InPageLayout
      height="100vh"
      video={(videoProps) => (
        <BackpackAutoplayVideo {...args} {...videoProps} />
      )}
    />
  )
};
