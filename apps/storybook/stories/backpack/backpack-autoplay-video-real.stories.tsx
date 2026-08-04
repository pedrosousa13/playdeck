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

/** The media Backpack's own `WistiaVideo` points at, as it passes it. */
const wistiaUrl = 'https://ef-language.wistia.com/medias/n2xniej387';

/**
 * Backpack's 1×1 transparent PNG, verbatim: the image it overrides Wistia's own
 * poster with, so nothing flashes before the first frame.
 */
const transparentPosterDataUri =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

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
 * Backpack's `WistiaVideo` args (`AutoplayVideo.stories.tsx:67-85`,
 * `export const WistiaVideo`), and the one story where its point is visible:
 * muted autoplay with no poster flash. Backpack's own story is its `Default` in a
 * 600px box, so the player is in view when the story opens and the embed loads
 * and starts at once — with nothing showing before the first frame, which is
 * what the two options below are for. `InPage` is where the loading strategy is
 * watchable instead.
 *
 * ## What replaced what
 * `stillUrl` and `wmode: 'transparent'` are carried across as Backpack passes
 * them, and the wrapper translates them to the provider's `poster` and
 * `transparentLetterbox` — `poster` and `transparent-letterbox` on the element.
 *
 * Backpack's other three keys are gone, and nothing is lost with them:
 * `autoPlay: true`, `silentAutoPlay: 'allow'` and `preload: 'auto'` are refused
 * by this wrapper's `playerConfig` type, because `BackpackAutoplayVideo` already
 * answers all three through Reely's own activation — `loading="viewport"` for
 * when to load and `autoplay="muted"` for the silent start. Backpack's own note
 * warns that its `autoPlay` "starts the video on init regardless of viewport";
 * here the viewport is what starts it, which is what this file's header
 * describes and what makes the swap an improvement rather than a shortfall.
 */
export const WistiaVideo: Story = {
  args: {
    url: wistiaUrl,
    playerConfig: {
      wistia: { stillUrl: transparentPosterDataUri, wmode: 'transparent' }
    }
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
