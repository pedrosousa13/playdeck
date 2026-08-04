import type { Meta, StoryObj } from '@storybook/react-vite';
import { withCss } from '../../.storybook/theme';
import { BackpackVideoHoverPreview } from './backpack-video-hover-preview';
import { backpackVideoCss } from './backpack-video-styles';

/*
 * `BackpackVideoHoverPreview` against a real provider: real embed, real network,
 * and a real hover to start it. Excluded from the deterministic story test suite
 * (`!test`) and opted out of the mock player (`real-playback`), so each story
 * renders the composition's own `Player.Root` with nothing staged into it — which
 * is the point.
 *
 * A file of its own rather than more stories in `backpack-video-real.stories.tsx`
 * for the reason the deterministic suites are separate files too: this is a
 * different component with a different props type.
 *
 * These carry Backpack's args verbatim, and two things live here that the
 * deterministic suite cannot have at all:
 *
 * - **The fetched cover.** Six of Backpack's nine stories pass no image and show
 *   the thumbnail the source's oEmbed endpoint returns. That is a real request,
 *   so `Backpack parity/VideoHoverPreview` substitutes a data URI in every story
 *   and only here does a cover arrive the way Backpack's does.
 * - **Sound and looping.** `muted` is applied to a media element and `loop`
 *   travels to the provider loader, so neither exists without a provider. See
 *   `WithSound` and `WithoutLoop` below — the second is a caveat rather than a
 *   demonstration.
 *
 * Hovering is also the only interaction, and with a real provider it is doing two
 * jobs at once: the composition loads on interaction, so the first hover attaches
 * the Vimeo provider and starts playback, and the cover stays up until playback
 * is actually reported. A second hover has nothing left to load and previews at
 * once — the composition keeps the provider attached where Backpack unmounts its
 * player on every hover end, through the `light={!isPlaying}` it composes
 * (`VideoHoverPreview.tsx:167`).
 */

/** Backpack's own cover photo, as its `VideoHoverPreview.stories.tsx` passes it. */
const coverImageUrl =
  'https://a.storyblok.com/f/171771/4656x3492/bbf48d4721/wojciech-then-dija5f0vogq-unsplash.jpg';

const vimeoUrl = 'https://vimeo.com/336066147';

const meta = {
  component: BackpackVideoHoverPreview,
  decorators: [withCss(backpackVideoCss('600px'))],
  parameters: {
    docs: {
      description: {
        component:
          'The `BackpackVideoHoverPreview` composition driving a real Vimeo embed. Hover the video: the provider loads on that first hover, muted playback starts, and the cover comes off once the player reports it. Move the pointer away and the cover returns with the video paused and rewound. The preview returns to the start every 5 seconds — `WithCustomDuration` shortens that to 3 — and, unlike Backpack, it does so when the video reaches that position rather than that many seconds after playback was requested. The cover image is the source’s own oEmbed thumbnail wherever no `placeholderImageSrc` is given, which is why these stories cannot be part of the deterministic suite. Real network, so they are excluded from the story test suite (tagged `!test`); `Backpack parity/VideoHoverPreview` covers the behaviour deterministically.'
      }
    }
  },
  tags: ['real-playback', '!test'],
  title: 'Real playback/BackpackVideoHoverPreview'
} satisfies Meta<typeof BackpackVideoHoverPreview>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Backpack's `Default` args, verbatim: a `url` and nothing else, so the resting
 * cover is Vimeo's own thumbnail, fetched from its oEmbed endpoint.
 */
export const Default: Story = {
  args: { url: vimeoUrl }
};

/**
 * Backpack's `WithCustomDuration` args, verbatim: a 3-second preview window.
 *
 * The window is watched against the video's own position here, where Backpack
 * counts 3 seconds of wall clock from the moment it asked for playback
 * (`VideoHoverPreview.tsx:89-103`) — so a first hover, which is also the hover
 * that loads the provider, is where the two visibly disagree. Backpack's interval
 * spends part of its first window on the load and seeks early; this one seeks when
 * the video reaches 3 seconds, however long it took to get there.
 */
export const WithCustomDuration: Story = {
  args: { duration: 3, url: vimeoUrl }
};

/** Backpack's `WithPlayIcon` args, verbatim — `true` is already the default. */
export const WithPlayIcon: Story = {
  args: { showPlayIcon: true, url: vimeoUrl }
};

/**
 * Backpack's `WithSound` args, verbatim: `muted: false`, the one story where the
 * preview has any sound to have.
 *
 * With a caveat that is Backpack's too, and is the reason this is the only place
 * the prop means anything: a hover is not a user gesture, so a browser is free to
 * refuse an audible play from one on a page nobody has clicked yet. Click
 * anywhere on the page first and the preview plays with sound; hover a freshly
 * loaded page and it may not play at all. Nothing in either implementation can
 * change that — an unmuted autoplay is the browser's decision — which is why the
 * deterministic story pins the arg being carried rather than the sound.
 */
export const WithSound: Story = {
  args: { muted: false, url: vimeoUrl }
};

/**
 * Backpack's `WithoutLoop` args, verbatim: `loop: false`.
 *
 * Carried rather than demonstrated. Reely forwards its native playback options to
 * the HLS and native providers only, so neither `loop: false` nor the
 * composition's default `loop: true` reaches this Vimeo source at all
 * (SIDEPRO-210) — the preview restarts because it is seeked back at the window,
 * not because anything loops. The prop becomes visible on an HLS or file source,
 * or once SIDEPRO-210 plumbs it through.
 */
export const WithoutLoop: Story = {
  args: { loop: false, url: vimeoUrl }
};

/**
 * Backpack's `WithCustomPlaceholderImage` args, verbatim, its own
 * `a.storyblok.com` photo included: a caller's image replaces the fetched
 * thumbnail, and no lookup is made at all.
 */
export const WithCustomPlaceholderImage: Story = {
  args: {
    alt: 'custom placeholder image',
    placeholderImageSrc: coverImageUrl,
    url: vimeoUrl
  }
};

/**
 * Backpack's `WithRenderCustomImage` args and element, verbatim: the cover is
 * rendered through the consumer's own element, which receives the resolved
 * source and sets its own `alt` after the spread.
 */
export const WithRenderCustomImage: Story = {
  args: {
    placeholderImageSrc: coverImageUrl,
    renderCustomImage: (props) => (
      <img
        id="custom-framework-image"
        {...props}
        alt="custom framework element"
      />
    ),
    url: vimeoUrl
  }
};

/**
 * Backpack's `WithCustomAspectRatio` args, verbatim: `aspectRatios: '1/1'`, with
 * the fetched thumbnail filling the square box and the embed playing inside it.
 */
export const WithCustomAspectRatio: Story = {
  args: { aspectRatios: '1/1', url: vimeoUrl }
};
