import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import {
  useMockPlayer,
  type MockPlayerParameters
} from '../../.storybook/mock-player';
import { withCss } from '../../.storybook/theme';
import { backpackVideoCss } from './backpack-video-css';
import { ready } from '../support';
import { BackpackVideo, type BackpackVideoProps } from './backpack-video';

// Deterministic and offline (apps/storybook/README.md), even though the args
// below are Backpack's own provider URLs: every story here stages a player that
// already reports `activation: 'ready'`, so `Player.ActivationButton` renders
// nothing, nothing commits the source, and `Player.Media` therefore mounts no
// embed. The URL is inert — nothing in this file can reach it, which the
// per-story no-external-request guard confirms. The stories that do attach a
// real provider are in `backpack-video-real.stories.tsx`, tagged `real-playback`
// and `!test` like every other real-media story in this repo.

const vimeoUrl = 'https://vimeo.com/336066147';
const youtubeUrl = 'https://www.youtube.com/watch?v=mhN3E_hlWmU';

/**
 * A cover image small enough to inline, standing in for Backpack's own
 * `a.storyblok.com` cover photo: an external URL may never reach the DOM here
 * (README's "Story conventions"), and a `data:` URI is the guard's documented
 * escape hatch. `Real playback/BackpackVideo` uses Backpack's real image.
 */
const coverImageDataUri =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="4" height="3"%3E%3Crect width="4" height="3" fill="%23808080"/%3E%3C/svg%3E';

const pausedPlayer = ready({}, { playback: 'paused' });
const playingPlayer = ready({}, { playback: 'playing' });

/** Every clickable thing in the story, as `TAG[accessible name]`. */
const affordances = (canvasElement: HTMLElement): string[] =>
  [...canvasElement.querySelectorAll('button, [role="button"]')].map(
    (element) =>
      `${element.tagName}[${element.getAttribute('aria-label') ?? element.textContent?.trim() ?? ''}]`
  );

const playIcon = (canvasElement: HTMLElement): Element | null =>
  canvasElement.querySelector('.ef-video-play-icon');

/**
 * The uniform scale factor of an element's computed `transform`: `1` for
 * `none` or an identity matrix, greater than `1` once the hover-zoom rule in
 * `backpack-video-css.ts` has applied.
 */
const scaleOf = (element: Element): number => {
  const { transform } = getComputedStyle(element);
  return transform === 'none' ? 1 : new DOMMatrix(transform).a;
};

/** Vitest browser mode's page handle — see {@link hover} for why it is lazy. */
type BrowserPage = Awaited<typeof import('vitest/browser')>['page'];

/**
 * Real `:hover`, not `userEvent.hover`'s dispatched events: a real browser
 * only matches `:hover` from its own hit-testing against actual pointer
 * position, which a synthetic (untrusted) event never updates. Vitest's
 * browser-mode locator drives the underlying automation provider (Playwright)
 * instead, which moves a real pointer.
 *
 * `vitest/browser` cannot be a static import. It is a virtual module that
 * exists only while Vitest browser mode is running; everywhere else the
 * specifier resolves to the stub shipped on disk
 * (`vitest/browser/context.js`), whose body is a bare `throw`. Imported at
 * module scope it would take this whole story file down in `pnpm dev`, and in
 * the static build — where the `throw` is tree-shaken and its `page` export
 * folds to `null` — it would leave a `null.elementLocator(...)` call to blow up
 * when the story renders. Resolved from inside `play` instead: under
 * `pnpm test:storybook` it always yields Playwright's driver, so the callers
 * below always assert; in the workbench it yields nothing and they skip the
 * settled-transform check, where a viewer hovers with a real pointer anyway.
 */
const browserPage = async (): Promise<BrowserPage | undefined> => {
  try {
    return (await import('vitest/browser')).page ?? undefined;
  } catch {
    return undefined;
  }
};

/**
 * Moves a real pointer over `element`. `false` — the caller skips whatever it
 * meant to observe — when no automation driver is available.
 */
const hover = async (element: Element): Promise<boolean> => {
  const driver = await browserPage();
  if (!driver) return false;
  await driver.elementLocator(element).hover();
  return true;
};

/**
 * Installs the workbench's mock provider into the wrapper's own `Player.Root`
 * (the wrapper owns it, because `url` is what Reely's source detection reads),
 * so these stories drive player state with no provider, no embed and no
 * network — the same contract `withMockPlayer` gives every other story.
 */
const MockedBackpackVideo = ({
  player,
  ...props
}: BackpackVideoProps & { readonly player: MockPlayerParameters }) => (
  <BackpackVideo {...props} ref={useMockPlayer(player)} />
);

/**
 * The same wrapper with the staged player state under story controls, so a play
 * function can walk it through a not-started → playing → paused sequence. The
 * mock stages state once per parameters object, so a second report needs a
 * second object.
 */
const PlayerReports = ({
  player,
  ...props
}: BackpackVideoProps & { readonly player: MockPlayerParameters }) => {
  const [staged, setStaged] = useState(player);
  return (
    <>
      <BackpackVideo {...props} ref={useMockPlayer(staged)} />
      <button onClick={() => setStaged(playingPlayer.player)} type="button">
        Report playing
      </button>
      <button onClick={() => setStaged(pausedPlayer.player)} type="button">
        Report paused
      </button>
    </>
  );
};

const meta = {
  title: 'Backpack parity/Video',
  component: BackpackVideo,
  decorators: [withCss(backpackVideoCss('480px'))],
  args: { onPlayChange: fn() },
  render: (args, { parameters }) => (
    <MockedBackpackVideo
      {...args}
      player={parameters.player as MockPlayerParameters}
    />
  )
} satisfies Meta<typeof BackpackVideo>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Backpack's `Default` args, verbatim. With `controls` off and the provider
 * attached, the whole player surface is the play/pause toggle and it is the
 * only clickable thing — Backpack's `VideoHiddenControls`.
 */
export const Default: Story = {
  args: { url: vimeoUrl, muted: true },
  parameters: pausedPlayer,
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    await expect(playIcon(canvasElement)).not.toBeNull();
    const paused = await canvas.findByRole('button', { name: 'Play video' });
    await expect(paused.tagName).toBe('BUTTON');
    await expect(paused).toHaveAttribute('aria-pressed', 'false');
    // The toggle has taken over from the activation affordance, and there is
    // no control bar, so it is the only click target on the player.
    await expect(affordances(canvasElement)).toEqual(['BUTTON[Play video]']);

    await userEvent.click(paused);
    const playing = await canvas.findByRole('button', { name: 'Pause video' });
    await expect(playing).toHaveAttribute('aria-pressed', 'true');
    await expect(playIcon(canvasElement)).toBeNull();
    await expect(args.onPlayChange).toHaveBeenLastCalledWith(true);

    await userEvent.click(playing);
    await expect(
      await canvas.findByRole('button', { name: 'Play video' })
    ).toHaveAttribute('aria-pressed', 'false');
    await expect(playIcon(canvasElement)).not.toBeNull();
    await expect(args.onPlayChange).toHaveBeenLastCalledWith(false);
  }
};

/**
 * Before a provider attaches there is nothing to toggle, so Reely's own
 * activation affordance is the click target — it is what loads the provider.
 * Clicking it here would load the real one, which is what
 * `Real playback/BackpackVideo` is for; this story only pins that the
 * affordance is present, is Reely's, and is alone on the surface.
 */
export const AwaitingActivation: Story = {
  args: { url: vimeoUrl, muted: true },
  parameters: { player: {} },
  play: async ({ canvas, canvasElement }) => {
    const activate = await canvas.findByRole('button', { name: 'Play video' });
    await expect(activate).toHaveAttribute('data-reely-part', 'activation');
    await expect(activate).toHaveAttribute('data-state', 'dormant');
    await expect(affordances(canvasElement)).toEqual(['BUTTON[Play video]']);
    // Paused and never started, so the icon sits over the activation target.
    await expect(playIcon(canvasElement)).not.toBeNull();
  }
};

/**
 * `playing` asks for playback on load, but only the player can say it started.
 * Here it never does: the source resolves to nothing, so no provider attaches
 * and nothing ever reports playing. A real page reaches the same state when the
 * browser blocks an audible autoplay — `playing` with `muted` off asks for one.
 * (An unresolvable source is what makes this deterministic; a resolvable one
 * would load a real provider, which this suite forbids.) The label, the icon
 * and `aria-pressed` must report what the player is doing, not what was asked.
 */
export const PlaybackRequestedButNeverStarted: Story = {
  args: { url: 'mock://reely/unresolvable.mp4', muted: false, playing: true },
  parameters: { player: {} },
  play: async ({ canvas, canvasElement }) => {
    const surface = await canvas.findByRole('button', { name: 'Play video' });
    await expect(surface).toHaveAttribute('aria-pressed', 'false');
    await expect(playIcon(canvasElement)).not.toBeNull();
    await expect(affordances(canvasElement)).toEqual(['BUTTON[Play video]']);
  }
};

/**
 * A state change nobody clicked for: the player itself reports playback, the
 * way a provider does when it starts. The label, the overlay and
 * `onPlayChange` all follow the player.
 */
export const ProgrammaticPlayback: Story = {
  args: { url: vimeoUrl, muted: true },
  parameters: playingPlayer,
  play: async ({ args, canvas, canvasElement }) => {
    const surface = await canvas.findByRole('button', { name: 'Pause video' });
    await expect(surface).toHaveAttribute('aria-pressed', 'true');
    await expect(playIcon(canvasElement)).toBeNull();
    await expect(args.onPlayChange).toHaveBeenCalledWith(true);
  }
};

/** Backpack's `YouTube Video` args, verbatim. */
export const YouTubeVideo: Story = {
  name: 'YouTube Video',
  args: { url: youtubeUrl, muted: true },
  parameters: pausedPlayer,
  play: async ({ canvas, canvasElement }) => {
    await expect(
      await canvas.findByRole('button', { name: 'Play video' })
    ).toHaveAttribute('aria-pressed', 'false');
    await expect(affordances(canvasElement)).toEqual(['BUTTON[Play video]']);
  }
};

/**
 * Backpack's `WithControls` args (its `light: false` is out of this slice and
 * is left off rather than half-implemented). Backpack forwards `controls` to
 * react-player, which shows the provider's own chrome; the wrapper shows
 * Reely's `Player.Controls` instead, because Reely renders its controls itself.
 * What matches is that the controls replace the click-to-toggle surface —
 * Backpack's `VideoHiddenControls` returns `null` for exactly this case — and
 * that the play icon stays up until playback has started.
 */
export const WithControls: Story = {
  args: { url: vimeoUrl, muted: true, controls: true },
  parameters: pausedPlayer,
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole('button', { name: 'Play' });
    await expect(affordances(canvasElement)).toEqual(['BUTTON[Play]']);
    await expect(playIcon(canvasElement)).not.toBeNull();
  }
};

/**
 * Backpack's `Loop` args. `loop` reaches `Player.Root`, but Reely forwards its
 * native playback options to the HLS and native providers only, so a Vimeo or
 * YouTube source never receives it (SIDEPRO-210). Nothing for a story to
 * observe, so this one holds the args and the render.
 */
export const Loop: Story = {
  args: { url: vimeoUrl, muted: true, controls: true, loop: true },
  parameters: pausedPlayer,
  play: async ({ canvas }) => {
    await canvas.findByRole('button', { name: 'Play' });
  }
};

/**
 * Once playback has started and the controls are shown, the play icon does not
 * come back on pause — the controls are the affordance from then on. This is
 * the `startedPlaying` half of Backpack's overlay condition.
 */
export const PlayIconYieldsToControls: Story = {
  args: { url: vimeoUrl, muted: true, controls: true },
  parameters: pausedPlayer,
  render: (args, { parameters }) => (
    <PlayerReports
      {...args}
      player={parameters.player as MockPlayerParameters}
    />
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    await expect(playIcon(canvasElement)).not.toBeNull();

    await userEvent.click(
      await canvas.findByRole('button', { name: 'Report playing' })
    );
    await waitFor(() => expect(playIcon(canvasElement)).toBeNull());

    await userEvent.click(
      await canvas.findByRole('button', { name: 'Report paused' })
    );
    await waitFor(() => expect(playIcon(canvasElement)).toBeNull());
  }
};

/**
 * `showPlayIcon` off with `controls` defaulting off: no overlay and no control
 * bar, so the invisible toggle is the only thing on the surface.
 */
export const WithoutPlayIcon: Story = {
  args: { url: vimeoUrl, muted: true, showPlayIcon: false },
  parameters: pausedPlayer,
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole('button', { name: 'Play video' });
    await expect(playIcon(canvasElement)).toBeNull();
    await expect(affordances(canvasElement)).toEqual(['BUTTON[Play video]']);
  }
};

/**
 * `className` is added to the component's own class, not swapped for it.
 * `controls` defaults off here too, so the overlay is expected and a control
 * bar is not.
 */
export const WithClassName: Story = {
  args: { url: vimeoUrl, muted: true, className: 'story-video' },
  parameters: pausedPlayer,
  play: async ({ canvasElement }) => {
    const player = canvasElement.querySelector('.ef-video-player');
    await expect(player).toHaveClass('story-video');
    await expect(playIcon(canvasElement)).not.toBeNull();
    await expect(affordances(canvasElement)).toEqual(['BUTTON[Play video]']);
  }
};

/**
 * Backpack's `CustomCoverImage` args (its `a.storyblok.com` URL swapped for
 * `coverImageDataUri`). Pristine mock player, so the cover sits over
 * `Player.Poster` above `Player.ActivationButton` — nothing has attached yet.
 * Pins: the cover renders with the caller's `alt` and `src`; `Player.Media`
 * mounts nothing because no source is committed; and the hover-zoom rule
 * settles the cover to a scale above `1`.
 *
 * Clicking through to activation is deliberately not exercised here: with a
 * pristine player and this real, resolvable `url`, that click is exactly what
 * commits the source and starts loading the real Vimeo provider (an iframe
 * pointed at `player.vimeo.com` lands a moment later) — precisely what
 * `Real playback/BackpackVideo` is for, and what this suite's offline guard
 * forbids. `CoverYieldsToPlayback` below pins "clicking removes the cover"
 * against a player that never needs to attach one for real.
 */
export const CustomCoverImage: Story = {
  args: {
    url: vimeoUrl,
    muted: true,
    light: true,
    placeholderImageSrc: coverImageDataUri,
    alt: 'custom cover image'
  },
  parameters: { player: {} },
  play: async ({ canvas, canvasElement }) => {
    const cover = await canvas.findByAltText('custom cover image');
    await expect(cover).toHaveAttribute('src', coverImageDataUri);
    await expect(cover.closest('[data-reely-part="poster"]')).not.toBeNull();
    await expect(
      canvasElement.querySelector('[data-reely-part="media"]')
    ).toBeNull();

    // The cover itself is `pointer-events: none` (it sits inside
    // `Player.Poster`), so the hover has to land on the player surface that
    // carries the CSS hover rule instead.
    const player = canvasElement.querySelector('.ef-video-player');
    await expect(player).not.toBeNull();
    if (await hover(player as Element)) {
      await waitFor(() => expect(scaleOf(cover)).toBeGreaterThan(1));
    }
  }
};

/**
 * The same over a YouTube source. The cover-removal and hover behavior are
 * already pinned above, so this only pins that the cover renders and mounts
 * no media over a different provider's URL.
 */
export const CustomCoverImageYouTube: Story = {
  args: {
    url: youtubeUrl,
    muted: true,
    light: true,
    placeholderImageSrc: coverImageDataUri,
    alt: 'custom cover image'
  },
  parameters: { player: {} },
  play: async ({ canvas, canvasElement }) => {
    const cover = await canvas.findByAltText('custom cover image');
    await expect(cover).toHaveAttribute('src', coverImageDataUri);
    await expect(
      canvasElement.querySelector('[data-reely-part="media"]')
    ).toBeNull();
  }
};

/**
 * `hoverEffect: false` (Backpack's `WithoutHoverEffect`) sets
 * `data-hover-effect="false"` on `Player.Poster` and the CSS hover rule in
 * `backpack-video-css.ts` no longer matches, so hovering leaves the cover at
 * its resting scale instead of zooming.
 */
export const WithoutHoverEffect: Story = {
  args: {
    url: vimeoUrl,
    muted: true,
    light: true,
    placeholderImageSrc: coverImageDataUri,
    alt: 'custom cover image',
    hoverEffect: false
  },
  parameters: { player: {} },
  play: async ({ canvas, canvasElement }) => {
    const cover = await canvas.findByAltText('custom cover image');
    await expect(
      canvasElement.querySelector('.ef-video-cover')
    ).toHaveAttribute('data-hover-effect', 'false');

    const player = canvasElement.querySelector('.ef-video-player');
    await expect(player).not.toBeNull();
    if (await hover(player as Element)) {
      await waitFor(() => expect(scaleOf(cover)).toBe(1));
    }
  }
};

/**
 * Backpack's `WithRenderCustomImage` element, verbatim: it spreads the
 * wrapper's own `props` (`src`, `className` and the wrapper's `alt`) onto its
 * `<img>` before setting its own `alt`, so its `alt` wins over the one passed
 * to `BackpackVideo` — pinning that `renderCustomImage` hands the resolved
 * cover through rather than rendering it itself.
 */
export const WithRenderCustomImage: Story = {
  args: {
    url: vimeoUrl,
    muted: true,
    light: true,
    placeholderImageSrc: coverImageDataUri,
    renderCustomImage: (props) => (
      <img
        id="custom-framework-image"
        {...props}
        alt="custom framework element"
      />
    )
  },
  parameters: { player: {} },
  play: async ({ canvasElement }) => {
    const image = canvasElement.querySelector('#custom-framework-image');
    await expect(image).toHaveAttribute('src', coverImageDataUri);
    await expect(image).toHaveAttribute('alt', 'custom framework element');
  }
};

/**
 * Backpack's `YouTubeShortsVideoAndCustomCoverImage` args, minus
 * `aspectRatios` (SIDEPRO-202). `light: false` pins that a caller-supplied
 * `placeholderImageSrc` shows a cover regardless — the wrapper's own
 * `hasCustomCoverImage` independence from `light`.
 */
export const YouTubeShortsVideoAndCustomCoverImage: Story = {
  args: {
    url: 'https://www.youtube.com/shorts/n3eC51ZaDlk',
    muted: true,
    light: false,
    placeholderImageSrc: coverImageDataUri,
    alt: 'custom cover image',
    hoverEffect: true
  },
  parameters: { player: {} },
  play: async ({ canvas }) => {
    const cover = await canvas.findByAltText('custom cover image');
    await expect(cover).toHaveAttribute('src', coverImageDataUri);
  }
};

/**
 * The other half of the acceptance criteria, deterministically: once the
 * provider is ready (`pausedPlayer`), `Player.ActivationButton` renders
 * nothing and the wrapper's own toggle is the only click target. Clicking it
 * requests playback, which is enough to remove the cover — proving the cover
 * yields to playback having started rather than to any particular click
 * target, and doing so with a player that never has to attach a real
 * provider, unlike a click on `CustomCoverImage`'s pristine activation
 * button.
 */
export const CoverYieldsToPlayback: Story = {
  args: {
    url: vimeoUrl,
    muted: true,
    light: true,
    placeholderImageSrc: coverImageDataUri,
    alt: 'custom cover image'
  },
  parameters: pausedPlayer,
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    await canvas.findByAltText('custom cover image');
    await expect(
      canvasElement.querySelector('[data-reely-part="activation"]')
    ).toBeNull();

    const toggle = await canvas.findByRole('button', { name: 'Play video' });
    await userEvent.click(toggle);
    await waitFor(() =>
      expect(canvas.queryByAltText('custom cover image')).toBeNull()
    );
    await expect(args.onPlayChange).toHaveBeenLastCalledWith(true);
  }
};

/**
 * The other click target, pinned on its own: while the cover is up and no
 * provider has attached, `Player.ActivationButton` is what the viewer clicks,
 * and the wrapper hangs its own `onClick` on it (Backpack's
 * `onClickPreview={start}`). That handler is the optimistic half — it removes
 * the cover and reports `onPlayChange(true)` at click time, without waiting
 * for the player to confirm anything — so this story pins exactly that, with
 * neither a staged player nor a real one to confirm it.
 *
 * `mock://reely/unresolvable.mp4` is what keeps it deterministic and offline:
 * the scheme is not `http(s)`, so Reely's source detection fails it, no
 * provider is ever loaded and `Player.Media` mounts nothing — the same trick
 * `PlaybackRequestedButNeverStarted` above uses. Clicking this button on
 * `CustomCoverImage`'s resolvable Vimeo URL would instead load the real
 * provider, which this suite forbids.
 */
export const CoverClickRequestsPlayback: Story = {
  args: {
    url: 'mock://reely/unresolvable.mp4',
    muted: true,
    light: true,
    placeholderImageSrc: coverImageDataUri,
    alt: 'custom cover image'
  },
  parameters: { player: {} },
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    await canvas.findByAltText('custom cover image');
    const activate = await canvas.findByRole('button', { name: 'Play video' });
    await expect(activate).toHaveAttribute('data-reely-part', 'activation');

    await userEvent.click(activate);
    await waitFor(() =>
      expect(canvas.queryByAltText('custom cover image')).toBeNull()
    );
    await expect(args.onPlayChange).toHaveBeenLastCalledWith(true);
    // Nothing confirmed playback — no provider can attach to this source — so
    // the removal and the report came from the wrapper's own `onClick`.
    await expect(
      canvasElement.querySelector('[data-reely-part="media"]')
    ).toBeNull();
  }
};
