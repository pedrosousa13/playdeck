import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor } from 'storybook/test';
import {
  useMockPlayer,
  type MockPlayerParameters
} from '../../.storybook/mock-player';
import { withCss } from '../../.storybook/theme';
import { ready } from '../support';
import {
  BackpackAutoplayVideo,
  type BackpackAutoplayVideoProps
} from './backpack-autoplay-video';
import { backpackVideoCss } from './backpack-video-styles';
import {
  clearOfTheEdge,
  fullyVisible,
  InPageLayout,
  inPageParts,
  scrollPanelHeight,
  scrollToVisibleFraction
} from './in-page-layout';
import { playerBox, playIcon } from './story-queries';

/*
 * Deterministic and offline, and it costs this file one thing the rest of the
 * parity suite keeps: Backpack's own `url`.
 *
 * ## Why the source below is not Backpack's Vimeo URL
 * Every other deterministic wrapper story passes a real provider URL and stays
 * offline anyway, because nothing there ever commits it —
 * `backpack-video.stories.tsx` loads on interaction and no story clicks the
 * activation button. This composition loads when the player's own box
 * scrolls into view, which is the whole point of it, so a resolvable source on screen is committed with nothing
 * clicked at all: an earlier revision of this file carried
 * `https://vimeo.com/336066147` and the suite's own no-external-request guard
 * caught the consequence — Vimeo's oEmbed resolve and a
 * `player.vimeo.com` iframe, from Reely's real provider load.
 *
 * So the source here is unresolvable by construction. `mock://` is not
 * `http(s)`, so Reely's source detection fails it
 * (`packages/react/src/use-activation.ts:330-336`), nothing is ever loaded, and
 * no URL in this file can reach the DOM — the same trick
 * `Backpack parity/Video`'s `PlaybackRequestedButNeverStarted` and
 * `CoverClickRequestsPlayback` use, and the one
 * `backpack-autoplay-video.contract.test.ts:33-42` writes up at length.
 * `Real playback/BackpackAutoplayVideo` carries Backpack's real URL.
 *
 * ## What the staged player can and cannot show
 * Playback is staged: each story hands the wrapper's own controller a mock
 * provider that reports itself ready and paused. The autoplay is then real —
 * the controller's own attempt is what moves it to playing, and nothing in any
 * `play` function below clicks anything.
 *
 * *When* a provider attaches is not, and cannot be, on either half of the
 * arrangement above: staging bypasses activation, and the unresolvable source
 * has no activation to bypass. So these stories have a ready player from mount
 * wherever the box happens to be. The activation observer, its zero preload
 * margin and the fact that nothing loads before it fires are pinned in
 * `backpack-autoplay-video.contract.test.ts`'s
 * `'BackpackAutoplayVideo viewport activation'` block, which can drive an
 * observer directly against an `http(s)` source it never intersects, and are
 * visible for real under `Real playback/BackpackAutoplayVideo`.
 *
 * `InPage` below is where that matters most, and its own comment says what it
 * therefore does and does not assert.
 */

const unresolvableUrl = 'mock://reely/unresolvable.mp4';

/**
 * Backpack's `a.storyblok.com` cover photo as something that can load offline —
 * the same 4×3 grey SVG `backpack-video.stories.tsx` uses, restated rather than
 * imported because a fixture is not an export a story file should be reaching
 * into another story file for. `Real playback/BackpackAutoplayVideo` carries
 * Backpack's real image.
 */
const coverImageDataUri =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="4" height="3"%3E%3Crect width="4" height="3" fill="%23808080"/%3E%3C/svg%3E';

/**
 * The staged player every story here runs against, and all three of its parts
 * are load-bearing:
 *
 * - `ready` — an autoplay attempt is made once, when the attached provider has
 *   finished loading (`packages/core/src/player-controller.ts:297-300`), so a
 *   provider that never reports itself ready never gets one.
 * - `playback: 'paused'` — so the playing state the assertions read is the
 *   attempt's own doing rather than a state the mock declared. Staging
 *   `playback: 'playing'` would let every story below pass with autoplay
 *   removed entirely.
 * - `reportsPlayback` — the mock's `play`/`pause` emit the confirming patch a
 *   real provider would (`mock-player.tsx:24-35`), which is what the wrapper
 *   reads playback off. Without it the attempt's `play()` would resolve into
 *   silence and no story could see that it happened.
 */
const autoplayingPlayer = {
  player: {
    ...ready({}, { playback: 'paused' }).player,
    reportsPlayback: true
  }
};

/**
 * Installs the workbench's mock provider into the `Player.Root` the wrapper
 * owns, exactly as `backpack-video.stories.tsx`'s own `MockedBackpackVideo`
 * does — the composition forwards `ref` through to it untouched.
 */
const MockedAutoplayVideo = ({
  player,
  ...props
}: BackpackAutoplayVideoProps & { readonly player: MockPlayerParameters }) => (
  <BackpackAutoplayVideo {...props} ref={useMockPlayer(player)} />
);

/**
 * The same composition inside Backpack's scroll-container layout. The layout
 * supplies `intersectionObserverRoot` and its own `onPlayChange`, both of which
 * win over the args spread before them; the story's spy goes to the layout,
 * which calls it under the badge.
 */
const MockedInPageAutoplayVideo = ({
  player,
  ...props
}: BackpackAutoplayVideoProps & { readonly player: MockPlayerParameters }) => (
  <InPageLayout
    height={scrollPanelHeight}
    onPlayChange={props.onPlayChange}
    video={(videoProps) => (
      <MockedAutoplayVideo {...props} {...videoProps} player={player} />
    )}
  />
);

const meta = {
  title: 'Backpack parity/AutoplayVideo',
  component: BackpackAutoplayVideo,
  // 600px, where `Backpack parity/Video` mounts 480px: Backpack's
  // `AutoplayVideo` stories all sit in a `TestWrapper maxWidth='600px'`
  // (`AutoplayVideo.stories.tsx:34-40`), and the width here lives on the player
  // box rather than on a wrapper element.
  decorators: [withCss(backpackVideoCss('600px'))],
  args: { onPlayChange: fn() },
  parameters: autoplayingPlayer,
  render: (args, { parameters }) => (
    <MockedAutoplayVideo
      {...args}
      player={parameters.player as MockPlayerParameters}
    />
  )
} satisfies Meta<typeof BackpackAutoplayVideo>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Backpack's `Default`, whose args are `url` and nothing else
 * (`AutoplayVideo.stories.tsx:30-41`) because everything this component is about
 * is a default — that `url` being the one thing this file cannot carry, for the
 * reason the header gives. Playback starts with nothing clicked, and the surface
 * reports it: `aria-pressed` is on, the play overlay is gone, and the toggle
 * offers the pause. That it starts *muted* is not observable from the DOM, so it
 * is pinned where the autoplay mode is — on the command sequence the attempt
 * issues, in `backpack-autoplay-video.contract.test.ts:194-208`,
 * `'plays muted with nothing clicked once the player is ready'`.
 *
 * Also where two consequences of the composed class name are pinned, since
 * every story in this file inherits them: `ef-autoplay-video` sits ahead of the
 * caller's own class (which the contract test pins with a caller class to
 * order against), and the transparent background it carries in Backpack
 * (`Video/video.styles.ts:5`) is reproduced over a player box that otherwise
 * fills itself.
 *
 * `Player.ActivationButton` is absent, which is the shape of the `viewport`
 * loading strategy on the surface rather than an incidental detail: it renders only
 * under interaction loading (`packages/react/src/loading-error.tsx:40`), so the
 * wrapper's own toggle is the only click target from the first frame.
 */
export const Default: Story = {
  args: { url: unresolvableUrl },
  play: async ({ args, canvas, canvasElement }) => {
    const surface = await canvas.findByRole('button', { name: 'Pause video' });
    await expect(surface).toHaveAttribute('aria-pressed', 'true');
    await expect(playIcon(canvasElement)).toBeNull();
    await waitFor(() => expect(args.onPlayChange).toHaveBeenCalledWith(true));
    // One transition, not a start reported twice: the attempt plays, and the
    // report it triggers is folded in rather than re-announced.
    await expect(args.onPlayChange).toHaveBeenCalledTimes(1);

    await expect(
      canvasElement.querySelector('[data-reely-part="activation"]')
    ).toBeNull();

    const box = playerBox(canvasElement);
    await expect(box).toHaveClass('ef-autoplay-video');
    await expect(getComputedStyle(box).backgroundColor).toBe(
      'rgba(0, 0, 0, 0)'
    );
  }
};

/**
 * Backpack's `WithCustomPlaceholderImage` args, with its `a.storyblok.com` image
 * swapped for `coverImageDataUri` and its `alt` string carried verbatim.
 *
 * What its own note promises is the assertion: "even when using a custom
 * placeholder image, the video will automatically play when it becomes visible"
 * (`AutoplayVideo.stories.tsx:43-46`). So the cover comes off without anything
 * being clicked, which is the one thing that separates this component from
 * `BackpackVideo` with a cover, where a click is what removes it. `HeldPaused`
 * below is where the cover can be seen at all.
 */
export const WithCustomPlaceholderImage: Story = {
  args: {
    url: unresolvableUrl,
    placeholderImageSrc: coverImageDataUri,
    alt: 'Custom placeholder image'
  },
  play: async ({ args, canvas }) => {
    await waitFor(() =>
      expect(canvas.queryByAltText('Custom placeholder image')).toBeNull()
    );
    await expect(args.onPlayChange).toHaveBeenLastCalledWith(true);
  }
};

/**
 * `playing: false`, which Backpack documents as this component's own escape
 * hatch (`AutoplayVideo.tsx:10-14`) without giving it a story — the same
 * position `WithThreshold` is in over in `Backpack parity/Video`.
 *
 * It earns one here because it is the only state in which the placeholder image
 * is on screen to look at, this component's cover otherwise lasting exactly as
 * long as the autoplay negotiation. It also pins the half of the `viewport`
 * loading strategy a held-paused video depends on: with no `Player.ActivationButton`
 * rendered, a surface that thought it was waiting for activation would offer
 * nothing to click, so the wrapper's own toggle has to be there and has to
 * start the video.
 */
export const HeldPaused: Story = {
  args: {
    url: unresolvableUrl,
    placeholderImageSrc: coverImageDataUri,
    alt: 'Custom placeholder image',
    playing: false
  },
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    const cover = await canvas.findByAltText('Custom placeholder image');
    await expect(cover).toHaveAttribute('src', coverImageDataUri);
    await expect(cover.closest('[data-reely-part="poster"]')).not.toBeNull();
    await expect(playIcon(canvasElement)).not.toBeNull();
    // Nothing was configured to autoplay, so nothing has been reported.
    await expect(args.onPlayChange).not.toHaveBeenCalled();

    const toggle = await canvas.findByRole('button', { name: 'Play video' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);

    await waitFor(() =>
      expect(args.onPlayChange).toHaveBeenLastCalledWith(true)
    );
    await waitFor(() =>
      expect(canvas.queryByAltText('Custom placeholder image')).toBeNull()
    );
  }
};

/**
 * Backpack's `InPage`: `WithCustomPlaceholderImage`'s args in a scroll
 * container, with a tall block above and below
 * (`AutoplayVideo.stories.tsx:87-107`). Real scrolls of a real container, and
 * the `IntersectionObserver` that pauses and resumes the video is the browser's
 * own — nothing about it is faked.
 *
 * ## What the opening two transitions are
 * The video mounts below the spacer, so it is off screen, and the staged
 * provider is ready there anyway (the file header says why it has to be). So
 * autoplay starts the video off screen and `pauseOnOutOfViewport` takes it
 * straight back — which is worth asserting rather than working around, because
 * it is the situation Backpack's own `AutoplayVideo` is in on every page: it
 * plays at mount wherever the box is and leaves this behaviour to correct it
 * (`AutoplayVideo.tsx:30`, `Video/useVideoPlayerState.ts:144-154`). What it is
 * *not* is evidence about when Reely loads — this composition would not have
 * loaded a real provider there at all, and only
 * `Real playback/BackpackAutoplayVideo → InPage` and the contract test can show
 * that.
 *
 * From there the cycle is the one Backpack's note describes: scrolled into view
 * it plays, scrolled clear it pauses, scrolled back it resumes. Every step is a
 * positive assertion, so each waits for the observer rather than for a clock,
 * and the sequence is pinned by position and by total count — the badge alone
 * could not tell a resume from a start that never stopped.
 */
export const InPage: Story = {
  args: {
    url: unresolvableUrl,
    placeholderImageSrc: coverImageDataUri,
    alt: 'Custom placeholder image'
  },
  parameters: { ...autoplayingPlayer, layout: 'fullscreen' },
  render: (args, { parameters }) => (
    <MockedInPageAutoplayVideo
      {...args}
      player={parameters.player as MockPlayerParameters}
    />
  ),
  play: async ({ args, canvas, canvasElement }) => {
    const { container, video } = inPageParts(canvasElement);
    const badge = canvas.getByRole('status');

    await waitFor(() =>
      expect(args.onPlayChange).toHaveBeenNthCalledWith(2, false)
    );
    await expect(args.onPlayChange).toHaveBeenNthCalledWith(1, true);
    await expect(badge).toHaveTextContent('Paused');

    scrollToVisibleFraction(container, video, fullyVisible);
    await waitFor(() => expect(badge).toHaveTextContent('Playing'));

    scrollToVisibleFraction(container, video, clearOfTheEdge);
    await waitFor(() => expect(badge).toHaveTextContent('Paused'));

    scrollToVisibleFraction(container, video, fullyVisible);
    await waitFor(() => expect(badge).toHaveTextContent('Playing'));

    // Five in all: the pair above, then one per scroll. A pause the hook did
    // not perform, or a resume of a video it had not paused, would add to this.
    await expect(args.onPlayChange).toHaveBeenCalledTimes(5);
  }
};
