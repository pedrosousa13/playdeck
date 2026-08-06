import type { PlayerHandle } from '@reely/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState, type RefObject } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import {
  useMockPlayer,
  type MockPlayerParameters
} from '../../.storybook/mock-player';
import { withCss } from '../../.storybook/theme';
import { ready } from '../support';
import {
  BackpackVideoHoverPreview,
  type BackpackVideoHoverPreviewProps
} from './backpack-video-hover-preview';
import { backpackVideoCss, backpackVideoStyles } from './backpack-video-styles';
import { playerBox, playIcon } from './story-queries';

/*
 * Deterministic and offline, and this file has to work for it in one way the
 * other two deterministic suites do not.
 *
 * ## Why every story here carries a cover image
 * `Backpack parity/Mock/Video` swaps Backpack's `a.storyblok.com` photo for a data
 * URI where a story passes one, and otherwise leaves the cover off: there a
 * cover is `light`'s business and `light` defaults off. Here the composition
 * resolves one unconditionally, because a hover preview has a resting state to
 * draw (`backpack-video-hover-preview.tsx:183`, its unguarded
 * `useVideoThumbnail`) — and {@link useVideoThumbnail} fetches the source's
 * oEmbed endpoint when no `placeholderImageSrc` is given
 * (`video-thumbnail.ts:56-57,73-98`). So a bare `vimeo.com` URL here is a real
 * request to `vimeo.com/api/oembed.json`, which the suite's own
 * no-external-request guard would fail (`.storybook/vitest.setup.ts:47-70`).
 * Every story below therefore passes `coverImageDataUri`, and the six Backpack
 * stories that show a *fetched* thumbnail have that half in
 * `Backpack parity/Real/VideoHoverPreview` instead.
 *
 * ## Why Backpack's own `url` is safe here anyway
 * For `Backpack parity/Mock/Video`'s reason, and one more. Each story stages a
 * provider that already reports `activation: 'ready'`, so no source is ever
 * committed and `Player.Media` mounts no embed. Hover would ordinarily be the
 * thing that loads it — the composition issues `activateFromInteraction()`
 * before `play()` — but that call returns early for any activation other than
 * `dormant` or a recoverable `error` (`packages/react/src/use-activation.ts:324`,
 * its `activateFromInteraction`, and `:354`, its
 * `if (activation !== 'dormant') return`). A staged-ready player has
 * nothing to activate, so hovering it reaches the provider as a `play` and
 * nothing else.
 *
 * ## Hover, and why `userEvent` is enough for it here
 * `Backpack parity/Mock/Video` drives hover through Vitest's browser-mode locator
 * (its own `hover` helper), and has to: what it observes is a CSS `:hover` rule,
 * which a browser matches from its own hit-testing rather than from any event
 * reaching the element — so that helper reports whether a driver was available
 * and its callers skip the check when one was not.
 *
 * Nothing here turns on CSS. The composition previews from React's
 * `onPointerEnter`/`onPointerLeave` (`:254-259`), which React derives from the
 * bubbling `pointerover`/`pointerout` pair, and a handler cannot tell a
 * dispatched pair from a driven one — so `userEvent.hover` and `userEvent.unhover`
 * deliver a preview either way, `pointerType: 'mouse'` carrying them past the
 * composition's touch filter, and the stories below assert unconditionally rather
 * than skipping.
 *
 * What a pointer cannot do is stay put while something else is clicked, in this
 * runner or under a real mouse. {@link PreviewWithPositions} is where that
 * matters and says what it does instead.
 *
 * ## What no story here can show
 * `muted` and `loop`, the two props `WithSound` and `WithoutLoop` exist for.
 * Both need a provider, and this suite attaches none — every route either prop
 * could travel is a provider's:
 *
 * - `muted` is reconciled by issuing `mute`/`unmute` at the controller
 *   (`packages/react/src/root.tsx:178`, `value ? controller.mute() :
 *   controller.unmute()`, from the reconcile at `:250-265`) and, on
 *   the native path only, by setting the property on a media element (`:333`,
 *   `media.muted = controlledMuted.current ?? desiredMuted.current`).
 *   With no source committed there is no element and no adapter to command
 *   (`packages/react/src/viewport-media.tsx:181-183,227-229`). The `mute` command
 *   `backpack-autoplay-video.contract.test.ts` watches for is not available
 *   either: `#attemptAutoplay` issues it only under `autoplay: 'muted'`
 *   (`packages/core/src/player-controller.ts:657-695`), and nothing here
 *   autoplays.
 * - `loop` travels in the `nativeOptions` handed to the provider loader
 *   (`root.tsx:439`, `nativeOptions: { endTime, loop, startTime }`), so nothing
 *   carries it when nothing loads.
 *
 * Both stories therefore pin what *is* here — the arg accepted, the preview
 * unchanged — and `Backpack parity/Real/VideoHoverPreview` is where `muted`
 * genuinely takes effect. `loop` is inert even there on a Vimeo or YouTube source
 * (SIDEPRO-210), which `WithoutLoop` says at its own call site.
 */

const vimeoUrl = 'https://vimeo.com/336066147';

/**
 * The 4×3 grey SVG the other two deterministic suites use, standing in for
 * Backpack's `a.storyblok.com` photo and, in the stories that pass no image at
 * all, for the thumbnail Backpack fetches. A `data:` URI is the offline guard's
 * documented escape hatch.
 */
const coverImageDataUri =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="4" height="3"%3E%3Crect width="4" height="3" fill="%23808080"/%3E%3C/svg%3E';

/**
 * The staged player every story runs against. `ready` with `playback: 'paused'`
 * so the preview's own hover is what starts anything, and `reportsPlayback` so
 * the mock's `play`/`pause` emit the patch a real provider would confirm with
 * (`mock-player.tsx:24-35`) — which is what the composition reads playback off,
 * and therefore what takes its cover away and brings it back.
 */
const previewPlayer = {
  player: {
    ...ready({}, { playback: 'paused' }).player,
    reportsPlayback: true
  }
};

/** The composition's own root, which carries the pointer handlers. */
const previewRoot = (canvasElement: HTMLElement): Element =>
  canvasElement.querySelector('.ef-video-hover-preview')!;

/** The resting cover image, or `null` while the preview is playing. */
const coverImage = (canvasElement: HTMLElement): Element | null =>
  canvasElement.querySelector('.ef-video-cover-image');

/**
 * Installs the workbench's mock provider into the `Player.Root` the composition
 * owns, exactly as the other two suites do — the composition forwards `ref`
 * through to it, alongside the handle it drives itself
 * (`backpack-video-hover-preview.tsx:190-197`, its `const setHandle`).
 */
const MockedHoverPreview = ({
  player,
  ...props
}: BackpackVideoHoverPreviewProps & {
  readonly player: MockPlayerParameters;
}) => <BackpackVideoHoverPreview {...props} ref={useMockPlayer(player)} />;

/**
 * Every position the player has reported, in order and de-duplicated, as text a
 * `play` function can read.
 *
 * The de-duplication is what makes it a trace of *positions* rather than of
 * state changes: a subscriber is called for every change, playback included, so
 * a hover alone would otherwise repeat whatever position was current. What is
 * left is the witness the restart needs, and it is the same one
 * `backpack-video-hover-preview.contract.test.ts` uses (`:68-71`, its
 * `seekedPositions`) — a story cannot inspect commands, but it can watch where
 * the position went.
 */
const ReportedPositions = ({
  handle
}: {
  readonly handle: RefObject<PlayerHandle | null>;
}) => {
  const [positions, setPositions] = useState<readonly number[]>([]);
  useEffect(() => {
    const player = handle.current;
    if (!player) return;
    const append = (time: number) =>
      setPositions((previous) =>
        previous[previous.length - 1] === time ? previous : [...previous, time]
      );
    append(player.getState().currentTime);
    return player.subscribe((state) => append(state.currentTime));
  }, [handle]);
  return <output>{positions.join(' ')}</output>;
};

/**
 * The composition with the reported position on screen, two buttons that move
 * it, and two that hold and release the preview.
 *
 * The position buttons are how a story stands in for playback the mock player
 * does not perform: nothing decodes here, so a seek is the only way a position
 * advances. That the composition cannot tell the two apart is the point — it
 * watches position rather than a clock, so a position arriving is a position
 * arriving. All four drive state from inside the rendered tree, as
 * `Backpack parity/Mock/Video`'s own external-control and `PlayerReports` stories do.
 *
 * ## Why the preview is held rather than hovered here
 * A click cannot coexist with a pointer-held preview: clicking a button below
 * the surface moves the pointer off it, which ends the hover, pauses the video
 * and rewinds it — so the position buttons would be pressing on a preview that
 * had just stopped. That is not an artefact of the automation driver, which
 * moves a real pointer here; a viewer in the workbench does the same thing with
 * a real mouse, and a story only usable by a test is not worth having.
 *
 * So the preview is held by `isHovered`, Backpack's own prop for "the preview is
 * currently being shown" (`VideoHoverPreview.tsx:32-35`), OR'd with the pointer
 * rather than replacing it (`:79`). `Default` above is where the pointer is what
 * starts a preview; this is the only story exercising the other way in — the one
 * that matters on a touch device, where there is no hover at all — since
 * Backpack has no story for the prop either.
 *
 * It is held from a button rather than from the args because the composition
 * acts on `isHovered` *changing*, never on the value it mounted with
 * (`backpack-video-hover-preview.tsx:231`, its `useOnChange(previewing`, and part 1's reason: acting on the
 * opening value would drive a player nobody had touched).
 */
const PreviewWithPositions = ({
  atWindow,
  player,
  shortOfWindow,
  ...props
}: BackpackVideoHoverPreviewProps & {
  readonly atWindow: number;
  readonly player: MockPlayerParameters;
  readonly shortOfWindow: number;
}) => {
  const handle = useMockPlayer(player);
  const [held, setHeld] = useState(false);
  return (
    <>
      <BackpackVideoHoverPreview {...props} isHovered={held} ref={handle} />
      <ReportedPositions handle={handle} />
      <button onClick={() => setHeld(true)} type="button">
        Hold preview
      </button>
      <button onClick={() => setHeld(false)} type="button">
        Release preview
      </button>
      <button
        onClick={() => void handle.current?.seekTo(shortOfWindow)}
        type="button"
      >
        Play to {shortOfWindow}s
      </button>
      <button
        onClick={() => void handle.current?.seekTo(atWindow)}
        type="button"
      >
        Play to {atWindow}s
      </button>
    </>
  );
};

const meta = {
  // 600px, as `Backpack parity/Mock/AutoplayVideo` mounts: Backpack's
  // `VideoHoverPreview` stories all sit in a `TestWrapper maxWidth='600px'`
  // (`VideoHoverPreview.stories.tsx:30-36`), and the width here lives on the
  // player box rather than on a wrapper element.
  decorators: [withCss(backpackVideoCss('600px'))],
  component: BackpackVideoHoverPreview,
  args: { onPlayChange: fn() },
  parameters: previewPlayer,
  render: (args, { parameters }) => (
    <MockedHoverPreview
      {...args}
      player={parameters.player as MockPlayerParameters}
    />
  ),
  title: 'Backpack parity/Mock/VideoHoverPreview'
} satisfies Meta<typeof BackpackVideoHoverPreview>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Backpack's `Default` args — `url` and nothing else — plus the cover image the
 * file header explains this suite cannot fetch.
 *
 * The whole cycle, which is the component: a cover at rest with the play icon
 * over it, the pointer arriving takes both away and starts playback, the pointer
 * leaving brings both back. The cover coming *back* is what separates this from
 * `Backpack parity/Mock/Video`'s covers, and it is why the composition owns its own
 * cover layer rather than using `Player.Poster`.
 *
 * Also where the defaults every other story here inherits are pinned:
 * `aspectRatios` is `{ s: 'natural' }`, which resolves to
 * `--reely-media-aspect-ratio` with a 16/9 fallback and the mock publishes no
 * dimensions, so the fallback applies; the play icon is Backpack's default `m`;
 * and the surface offers exactly one named control. The preview window's own
 * default of 5 seconds is not observable without moving the position, so it is
 * pinned in `backpack-video-hover-preview.contract.test.ts:321-339`, `'returns to the start once the preview window has elapsed'`, instead,
 * and `WithCustomDuration` below is where a story watches a window at all.
 */
export const Default: Story = {
  args: { url: vimeoUrl, placeholderImageSrc: coverImageDataUri },
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    await expect(coverImage(canvasElement)).toHaveAttribute(
      'src',
      coverImageDataUri
    );
    await expect(getComputedStyle(playerBox(canvasElement)).aspectRatio).toBe(
      '16 / 9'
    );
    await expect(playIcon(canvasElement)).toHaveAttribute(
      'data-play-icon-size',
      'm'
    );
    // One control, and it is the named one: the cover layer takes no clicks and
    // is not in the tab order, unlike Backpack's, which puts a nameless tab stop
    // over the video (`VideoCoverImage.tsx:99-100,102`).
    const resting = await canvas.findByRole('button', { name: 'Play video' });
    await expect(resting).toHaveAttribute('aria-pressed', 'false');
    await expect(canvas.getAllByRole('button')).toHaveLength(1);

    await userEvent.hover(previewRoot(canvasElement));
    await waitFor(() => expect(coverImage(canvasElement)).toBeNull());
    await expect(playIcon(canvasElement)).toBeNull();
    await expect(
      await canvas.findByRole('button', { name: 'Pause video' })
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(args.onPlayChange).toHaveBeenLastCalledWith(true);

    await userEvent.unhover(previewRoot(canvasElement));
    await waitFor(() => expect(coverImage(canvasElement)).not.toBeNull());
    await expect(playIcon(canvasElement)).not.toBeNull();
    await expect(
      await canvas.findByRole('button', { name: 'Play video' })
    ).toHaveAttribute('aria-pressed', 'false');
    await expect(args.onPlayChange).toHaveBeenLastCalledWith(false);
  }
};

/**
 * Backpack's `DefaultThemeConfig`, which dumps a style object so a reader can
 * see what a `themeConfig` may reach.
 *
 * Backpack dumps its `videoStyles` here (`VideoHoverPreview.stories.tsx:5,51`),
 * which is not the object this story's component reads: `VideoHoverPreview`
 * merges a `themeConfig` into `videoHoverPreviewStyles` instead
 * (`VideoHoverPreview.tsx:15,106-110`), so its own dump shows a reader the wrong
 * escape hatch. What this dumps is the object the composition actually reads —
 * `backpackVideoStyles`, through the `themeConfig` it forwards to
 * `BackpackVideo` in `...rest` — which is the answer
 * `Backpack parity/Mock/Video → Default Theme Config` already settled on. Rendered as
 * a `<pre>` of `JSON.stringify` where Backpack uses `react-json-view-lite`,
 * since the deterministic suite adds no dependency for a story.
 *
 * `url` is required on the component, so the args carry one; the render below
 * ignores them and mounts no player at all.
 */
export const DefaultThemeConfig: Story = {
  args: { url: vimeoUrl },
  render: () => <pre>{JSON.stringify(backpackVideoStyles, null, 2)}</pre>,
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('pre')).toHaveTextContent(
      '"root": "ef-video-player"'
    );
  }
};

/**
 * Backpack's `WithCustomDuration`: `duration: 3`, a preview window shorter than
 * the default 5.
 *
 * The window is a position rather than a clock, which is this composition's one
 * deliberate divergence from Backpack's implementation — Backpack arms
 * `setInterval(() => seekTo(0), duration * 1000)` when it *asks* for playback
 * (`VideoHoverPreview.tsx:89-103`), so load latency, a blocked play or a
 * buffering stall desynchronise the interval from the video's own position. So
 * the story reads the position trace: a report short of the window is left
 * alone, and the report that reaches it goes back to `0`. `0 2 3 0` is the whole
 * assertion — a wrapper that restarted at 2 would read `0 2 0 3 0`, and one that
 * restarted per report rather than per crossing would read `0 2 3 0 0`.
 *
 * Playback is unaffected by a restart: the preview loops rather than stopping,
 * so the surface still offers the pause, the cover stays away and nothing is
 * reported to the parent — a restart is a seek, not a stop.
 * {@link PreviewWithPositions} says why the preview is held rather than hovered.
 */
export const WithCustomDuration: Story = {
  args: {
    duration: 3,
    placeholderImageSrc: coverImageDataUri,
    url: vimeoUrl
  },
  render: (args, { parameters }) => (
    <PreviewWithPositions
      {...args}
      atWindow={3}
      player={parameters.player as MockPlayerParameters}
      shortOfWindow={2}
    />
  ),
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    const positions = canvas.getByRole('status');
    await expect(positions).toHaveTextContent('0');

    await userEvent.click(
      await canvas.findByRole('button', { name: 'Hold preview' })
    );
    await waitFor(() => expect(coverImage(canvasElement)).toBeNull());
    await canvas.findByRole('button', { name: 'Pause video' });

    await userEvent.click(
      await canvas.findByRole('button', { name: 'Play to 2s' })
    );
    await waitFor(() => expect(positions).toHaveTextContent('0 2'));

    await userEvent.click(
      await canvas.findByRole('button', { name: 'Play to 3s' })
    );
    await waitFor(() => expect(positions).toHaveTextContent('0 2 3 0'));

    await canvas.findByRole('button', { name: 'Pause video' });
    await expect(coverImage(canvasElement)).toBeNull();
    await expect(args.onPlayChange).toHaveBeenCalledTimes(1);

    // Released rather than left running, which pins the other half of the
    // external hold: the cover comes back for a preview no pointer ever started.
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Release preview' })
    );
    await waitFor(() => expect(coverImage(canvasElement)).not.toBeNull());
    await expect(args.onPlayChange).toHaveBeenLastCalledWith(false);
  }
};

/**
 * Backpack's `WithPlayIcon`: `showPlayIcon: true`, which is already the default
 * on both sides — Backpack's own destructuring (`VideoHoverPreview.tsx:57`) and
 * the wrapper's (`backpack-video.tsx:470`, its `showPlayIcon = true`) — so the arg changes nothing and the
 * story exists to carry it. What it pins is the icon's whole life: over the
 * resting cover, gone while the preview plays, back with the cover afterwards.
 */
export const WithPlayIcon: Story = {
  args: {
    placeholderImageSrc: coverImageDataUri,
    showPlayIcon: true,
    url: vimeoUrl
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await expect(playIcon(canvasElement)).not.toBeNull();

    await userEvent.hover(previewRoot(canvasElement));
    await waitFor(() => expect(playIcon(canvasElement)).toBeNull());

    await userEvent.unhover(previewRoot(canvasElement));
    await waitFor(() => expect(playIcon(canvasElement)).not.toBeNull());
    await canvas.findByRole('button', { name: 'Play video' });
  }
};

/**
 * Backpack's `WithSound`: `muted: false`, a preview that plays audibly.
 *
 * The sound is not observable *here*, and the assertion below is why rather than a
 * substitute for it: with no source committed there is neither a media element to
 * carry the property nor an adapter to issue `unmute` to. It does work where a
 * provider exists — `Backpack parity/Real/VideoHoverPreview → WithSound` carries
 * Backpack's arg over a real Vimeo embed, which implements `mute`/`unmute`
 * (`packages/provider-vimeo/src/index.ts:140-141`) and takes `muted` in its embed
 * URL (`provider-vimeo/src/attachment.ts:64`), with `Player.Root` reconciling the
 * controlled value through the controller (`packages/react/src/root.tsx:178`,
 * `value ? controller.mute() : controller.unmute()`). So
 * what this story pins is the arg being accepted and changing nothing else: the
 * preview still starts on hover and still stops on leave.
 */
export const WithSound: Story = {
  args: {
    muted: false,
    placeholderImageSrc: coverImageDataUri,
    url: vimeoUrl
  },
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    await expect(canvasElement.querySelector('video, audio')).toBeNull();

    await userEvent.hover(previewRoot(canvasElement));
    await canvas.findByRole('button', { name: 'Pause video' });
    await expect(args.onPlayChange).toHaveBeenLastCalledWith(true);

    await userEvent.unhover(previewRoot(canvasElement));
    await canvas.findByRole('button', { name: 'Play video' });
    await expect(args.onPlayChange).toHaveBeenLastCalledWith(false);
  }
};

/**
 * Backpack's `WithoutLoop`: `loop: false`, so a video shorter than the preview
 * window plays once instead of wrapping at its own end.
 *
 * Unobservable here for `WithSound`'s reason — `loop` travels to the provider
 * loader, and no provider is loaded — and, on the two providers Backpack's own
 * stories use, unobservable anywhere: Reely forwards its native playback options
 * to the HLS and native branches only, so neither `loop: false` nor the
 * composition's default `loop: true` reaches a Vimeo or YouTube source
 * (SIDEPRO-210).
 *
 * Which leaves this story in an odd position worth stating plainly: what Backpack's
 * `WithoutLoop` *shows* is a preview that does not loop, and that is exactly what
 * this shows too — because nothing here loops, whatever the prop says. The story
 * matches; the prop is inert. The case that would expose the difference is
 * `loop: true`, the composition's own default, and no story here or in Backpack
 * shows a video short enough for it to matter. The restart that does work
 * regardless is `WithCustomDuration`'s: the window is enforced by seeking, not by
 * looping.
 */
export const WithoutLoop: Story = {
  args: {
    loop: false,
    placeholderImageSrc: coverImageDataUri,
    url: vimeoUrl
  },
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    await userEvent.hover(previewRoot(canvasElement));
    await canvas.findByRole('button', { name: 'Pause video' });
    await expect(args.onPlayChange).toHaveBeenLastCalledWith(true);

    await userEvent.unhover(previewRoot(canvasElement));
    await canvas.findByRole('button', { name: 'Play video' });
    await expect(args.onPlayChange).toHaveBeenLastCalledWith(false);
  }
};

/**
 * Backpack's `WithCustomPlaceholderImage` args, its `alt` verbatim and its
 * `a.storyblok.com` image swapped for the data URI. A caller-supplied image
 * wins over any lookup — here it prevents one entirely, which is what keeps this
 * suite offline (`video-thumbnail.ts:56-57`).
 *
 * The cover's `alt` reaches the accessibility tree here, unlike
 * `BackpackVideo`'s: that one sits inside an `aria-hidden` `Player.Poster`
 * (`packages/react/src/poster.tsx:66`), while this layer is the composition's
 * own and is the resting representation of the video.
 */
export const WithCustomPlaceholderImage: Story = {
  args: {
    alt: 'custom placeholder image',
    placeholderImageSrc: coverImageDataUri,
    url: vimeoUrl
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const cover = await canvas.findByAltText('custom placeholder image');
    await expect(cover).toHaveAttribute('src', coverImageDataUri);

    await userEvent.hover(previewRoot(canvasElement));
    await waitFor(() =>
      expect(canvas.queryByAltText('custom placeholder image')).toBeNull()
    );

    // The same image, back: the layer is re-rendered from the resolved source
    // rather than restored, which is exactly what `Player.Poster` cannot do.
    await userEvent.unhover(previewRoot(canvasElement));
    await waitFor(() =>
      expect(canvas.queryByAltText('custom placeholder image')).not.toBeNull()
    );
  }
};

/**
 * Backpack's `WithRenderCustomImage` element, verbatim: it spreads the props it
 * is handed onto its own `<img>` before setting its own `alt`, so its `alt` wins
 * over the composition's. Pins that `renderCustomImage` receives the resolved
 * cover rather than rendering one itself, and that the custom element takes the
 * same place in the cycle — away while previewing, back at rest.
 */
export const WithRenderCustomImage: Story = {
  args: {
    placeholderImageSrc: coverImageDataUri,
    renderCustomImage: (props) => (
      <img
        id="custom-framework-image"
        {...props}
        alt="custom framework element"
      />
    ),
    url: vimeoUrl
  },
  play: async ({ canvasElement, userEvent }) => {
    const custom = () => canvasElement.querySelector('#custom-framework-image');
    await expect(custom()).toHaveAttribute('src', coverImageDataUri);
    await expect(custom()).toHaveAttribute('alt', 'custom framework element');
    await expect(custom()).toHaveClass('ef-video-cover-image');

    await userEvent.hover(previewRoot(canvasElement));
    await waitFor(() => expect(custom()).toBeNull());

    await userEvent.unhover(previewRoot(canvasElement));
    await waitFor(() => expect(custom()).not.toBeNull());
  }
};

/**
 * Backpack's `WithCustomAspectRatio`: `aspectRatios: '1/1'`, a square player.
 *
 * Both layers take the shape, which is what the ratio has to mean for a
 * composition whose resting state is an image: the player box is square, and the
 * cover — a 4×3 SVG — fills it rather than letterboxing inside it, by the
 * `object-fit: cover` the shared cover rules give it. The preview root shrinks to
 * that box instead of the width of its parent, which is what
 * `width: fit-content` on `.ef-video-hover-preview` is for
 * (`backpack-video-styles.ts:411,413` — the `.ef-video-hover-preview` rule and
 * its `width: fit-content`).
 */
export const WithCustomAspectRatio: Story = {
  args: {
    aspectRatios: '1/1',
    placeholderImageSrc: coverImageDataUri,
    url: vimeoUrl
  },
  play: async ({ canvasElement }) => {
    const box = playerBox(canvasElement);
    await expect(getComputedStyle(box).aspectRatio).toBe('1 / 1');
    const { height, width } = box.getBoundingClientRect();
    await expect(Math.round(height)).toBe(Math.round(width));

    const cover = coverImage(canvasElement)!;
    await expect(cover.getBoundingClientRect().height).toBe(height);
    await expect(cover.getBoundingClientRect().width).toBe(width);
    await expect(getComputedStyle(cover).objectFit).toBe('cover');

    const root = previewRoot(canvasElement);
    await expect(root.getBoundingClientRect().width).toBe(width);
  }
};
