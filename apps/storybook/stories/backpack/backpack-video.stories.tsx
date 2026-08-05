import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import {
  useMockPlayer,
  type MockPlayerParameters
} from '../../.storybook/mock-player';
import { withCss } from '../../.storybook/theme';
import { backpackVideoCss, backpackVideoStyles } from './backpack-video-styles';
import { ready } from '../support';
import { BackpackVideo, type BackpackVideoProps } from './backpack-video';
import {
  mergeWistiaPlayerConfig,
  translateWistiaPlayerConfig
} from './backpack-video-player-config';
import {
  clearOfTheEdge,
  fullyVisible,
  InPageLayout,
  inPageParts,
  quarterVisible,
  scrollPanelHeight,
  scrollToVisibleFraction
} from './in-page-layout';
import { playerBox, playIcon } from './story-queries';

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
const wistiaUrl = 'https://wesleyluyten.wistia.com/medias/oifkgmxnkb';

/**
 * A cover image small enough to inline, standing in for Backpack's own
 * `a.storyblok.com` cover photo: an external URL may never reach the DOM here
 * (README's "Story conventions"), and a `data:` URI is the guard's documented
 * escape hatch. `Backpack parity/Real/Video` uses Backpack's real image.
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

/**
 * The uniform scale factor of an element's computed `transform`: `1` for
 * `none` or an identity matrix, greater than `1` once the hover-zoom rule in
 * `backpack-video-styles.ts` has applied.
 */
const scaleOf = (element: Element): number => {
  const { transform } = getComputedStyle(element);
  return transform === 'none' ? 1 : new DOMMatrix(transform).a;
};

/**
 * Resolves once the element's own transition has had time to run, read from
 * the element rather than hard-coded so it tracks `backpack-video-styles.ts`.
 * What a negative hover assertion needs: the cover's resting scale is already
 * `1`, so a `waitFor` alone would pass on its first tick without ever giving a
 * zoom the chance to apply, and a rule that did match would go unnoticed.
 */
const afterTransition = (element: Element): Promise<void> => {
  const { transitionDuration } = getComputedStyle(element);
  const settleMs = Number.parseFloat(transitionDuration) * 1000 + 50;
  return new Promise((resolve) => {
    window.setTimeout(resolve, settleMs);
  });
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
 * Resolves once an `IntersectionObserver` of the story's own reports the video
 * at `visible`. A fresh observer reports its target's current state on its first
 * frame, so creating one after a scroll is what samples the new geometry. Its
 * options are the wrapper's: the same root, and the `0` threshold the two
 * stories that call this leave at Backpack's default.
 *
 * What a story asserting "it did *not* pause" needs. Two scrolls issued in one
 * task are one scroll as far as an `IntersectionObserver` is concerned — it
 * samples at frame boundaries — so without waiting for the browser to observe
 * the video leaving, such a story would pass over a wrapper that pauses
 * diligently and be unable to fail. It is also the only settle point available
 * that is an event rather than a clock: observers on one document are notified
 * in creation order, so by the time this one has been called the wrapper's own
 * has been too.
 */
const observedVisibility = (
  container: Element,
  video: Element,
  visible: boolean
): Promise<void> =>
  new Promise((resolve) => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[entries.length - 1]?.isIntersecting !== visible) return;
        observer.disconnect();
        resolve();
      },
      { root: container, threshold: 0 }
    );
    observer.observe(video);
  });

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
 * The same wrapper inside Backpack's scroll-container layout, which is what
 * every `pauseOnOutOfViewport` story renders — they differ only in their args.
 * The layout supplies `intersectionObserverRoot` and its own `onPlayChange`,
 * both of which therefore win over the args spread before them; the story's
 * spy is handed to the layout instead, which calls it under the badge.
 */
const MockedInPageVideo = ({
  player,
  ...props
}: BackpackVideoProps & { readonly player: MockPlayerParameters }) => (
  <InPageLayout
    height={scrollPanelHeight}
    onPlayChange={props.onPlayChange}
    video={(videoProps) => (
      <MockedBackpackVideo {...props} {...videoProps} player={player} />
    )}
  />
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
  title: 'Backpack parity/Mock/Video',
  component: BackpackVideo,
  decorators: [withCss(backpackVideoCss('600px'))],
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
 *
 * Also where the two appearance defaults are pinned, because every other story
 * in this file inherits them: `aspectRatios` defaults to `{ s: 'natural' }`,
 * which is `--reely-media-aspect-ratio` with a 16/9 fallback — and the mock
 * player publishes no dimensions, so the fallback is what applies. The play
 * icon defaults to Backpack's `m`, a 3rem box.
 */
export const Default: Story = {
  args: { url: vimeoUrl, muted: true },
  parameters: pausedPlayer,
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    await expect(getComputedStyle(playerBox(canvasElement)).aspectRatio).toBe(
      '16 / 9'
    );
    await expect(playIcon(canvasElement)).not.toBeNull();
    await expect(playIcon(canvasElement)).toHaveAttribute(
      'data-play-icon-size',
      'm'
    );
    await expect(playIcon(canvasElement)!.getBoundingClientRect().width).toBe(
      48
    );
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
 * `Backpack parity/Real/Video` is for; this story only pins that the
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
 * Backpack's `WistiaVideo` args, verbatim (`Video.stories.tsx:145-152`,
 * `export const WistiaVideo`).
 *
 * A third provider's URL through the same surface, and offline the same way
 * every story here is: `pausedPlayer` is staged, so `Player.ActivationButton` renders
 * nothing, nothing commits the source, and `Player.Media` mounts no embed. The
 * last two assertions are what pin that rather than assume it — a `<wistia-player>`
 * that reached the document would upgrade and fetch its own media data from
 * Wistia, which is exactly what this suite forbids and what
 * `Backpack parity/Real/Video → Wistia` is for.
 */
export const WistiaVideo: Story = {
  args: { url: wistiaUrl, muted: true, light: false },
  parameters: pausedPlayer,
  play: async ({ canvas, canvasElement }) => {
    await expect(
      await canvas.findByRole('button', { name: 'Play video' })
    ).toHaveAttribute('aria-pressed', 'false');
    await expect(affordances(canvasElement)).toEqual(['BUTTON[Play video]']);
    await expect(
      canvasElement.querySelector('[data-reely-part="media"]')
    ).toBeNull();
    await expect(canvasElement.querySelector('wistia-player')).toBeNull();
  }
};

/**
 * Backpack's `Wistia with playerConfig` args, verbatim
 * (`Video.stories.tsx:162-176`, `export const WistiaWithPlayerConfig`): the
 * Wistia swatch — its blurred placeholder — switched off, and the player colour
 * set to red.
 *
 * ## Why this asserts the translated option bag and not the element's attributes
 * `swatch` and `player-color` are attributes on a `<wistia-player>`, and this
 * suite may not mount one: an element that upgrades fetches its own media data
 * from Wistia, which the per-story no-external-request guard forbids
 * (`apps/storybook/README.md`, "Story conventions"). The two ways to reach an
 * element anyway are both closed to a story — stubbing Wistia's SDK needs
 * `loadWistiaPlayer`, which only `@reely/provider-wistia` exports and this app
 * does not depend on, and calling Reely's own `loadProvider` means reaching into
 * `@reely/react`'s private modules, which
 * `backpack-video-player-config.contract.test.ts:26-43`, from its
 * `` `mergeWistiaPlayerConfig`/`translateWistiaPlayerConfig` above `` comment, turns
 * down for the same
 * reason `external-control.contract.test.ts:30-40`, from `Reaching a genuinely`, does.
 *
 * So the nearest boundary a story can honestly reach is the option bag the
 * wrapper builds out of these very args, which the second assertion pins. Each
 * layer past it is pinned where it can be: that `BackpackVideoInternal` hands
 * that bag to `Player.Root` in
 * `backpack-video-player-config.contract.test.ts:143-159`,
 * `'hands Player.Root the caller’s playerConfig, merged and translated'`, that `Player.Root`
 * hands it to the loader in `packages/react/test/activation.test.tsx:738-753`
 * (`'forwards the provider option bag from Root to the loader'`), and that the
 * provider writes it as `player-color` and `swatch` in
 * `packages/provider-wistia/test/index.test.ts:241-249`. What a human checks is
 * `Backpack parity/Real/Video → WistiaWithPlayerConfig`: a red player with no
 * blurred placeholder behind it.
 */
export const WistiaWithPlayerConfig: Story = {
  name: 'Wistia with playerConfig',
  args: {
    url: wistiaUrl,
    muted: true,
    light: false,
    playerConfig: { wistia: { swatch: false, playerColor: 'ff0000' } }
  },
  parameters: pausedPlayer,
  play: async ({ args, canvas, canvasElement }) => {
    await canvas.findByRole('button', { name: 'Play video' });
    // Backpack's own two option names, as this story renders them.
    await expect(args.playerConfig?.wistia).toEqual({
      playerColor: 'ff0000',
      swatch: false
    });
    // What the wrapper makes of them: `playerColor` straight across, the
    // caller's `swatch: false` explicit rather than defaulted, and the two
    // keys these args leave out staying unset rather than becoming an
    // attribute with a computed value.
    await expect(
      translateWistiaPlayerConfig(
        mergeWistiaPlayerConfig(args.playerConfig?.wistia)
      )
    ).toEqual({
      playerColor: 'ff0000',
      poster: undefined,
      swatch: false,
      transparentLetterbox: undefined
    });
    await expect(
      canvasElement.querySelector('[data-reely-part="media"]')
    ).toBeNull();
  }
};

/**
 * Backpack's `WithControls` args (its `light: false` is out of this slice and
 * is left off rather than half-implemented). Backpack forwards `controls` to
 * react-player, which hands the underlying element the provider's own chrome;
 * the wrapper forwards it to `Player.Root`, which does the same through the
 * provider's embed or the `<video controls>` attribute — so the chrome now
 * matches, where an earlier revision drew Reely's own `Player.Controls` over it
 * (SIDEPRO-222 found the two bars that made on YouTube).
 *
 * With a provider attached, that leaves the wrapper drawing nothing at all:
 * no control bar, no click-to-toggle surface — Backpack's `VideoHiddenControls`
 * returns `null` for exactly this case — and no play icon, which is the one
 * place this diverges from Backpack (`docs/backpack-parity.md` records it).
 * An empty affordance list is the whole assertion, and it is also the settle
 * point: the activation button is on the surface until the mock reports
 * `activation: 'ready'`, so a list that has gone empty is a provider that has
 * attached.
 */
export const WithControls: Story = {
  args: { url: vimeoUrl, muted: true, controls: true },
  parameters: pausedPlayer,
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(affordances(canvasElement)).toEqual([]));
    await expect(playIcon(canvasElement)).toBeNull();
  }
};

/**
 * Backpack's `Loop` args. `loop` reaches `Player.Root`, but Reely forwards its
 * native playback options to the HLS and native providers only, so a Vimeo or
 * YouTube source never receives it (SIDEPRO-210). Nothing of `loop` for a story
 * to observe, so what this one holds is Backpack's args and the render; its
 * `controls: true` half is `WithControls` above.
 */
export const Loop: Story = {
  args: { url: vimeoUrl, muted: true, controls: true, loop: true },
  parameters: pausedPlayer,
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(affordances(canvasElement)).toEqual([]));
  }
};

/**
 * The play icon never comes back under `controls: true`, on any report: not
 * before playback, not while playing, and not on the pause afterwards. Reely's
 * icon and the provider's own chrome are two play affordances over one video,
 * which is the defect SIDEPRO-222 found in the control bar this story used to
 * watch the icon yield to.
 *
 * The not-started half is `WithControls` above. What this adds is the pause
 * after playback — the state where the icon *does* come back under
 * `controls: false`, because there it is the resting affordance over the
 * wrapper's own toggle. Together the two stories say the icon's gate reads
 * `controls` and nothing else.
 */
export const NoPlayIconUnderProviderControls: Story = {
  args: { url: vimeoUrl, muted: true, controls: true },
  parameters: pausedPlayer,
  render: (args, { parameters }) => (
    <PlayerReports
      {...args}
      player={parameters.player as MockPlayerParameters}
    />
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    await expect(playIcon(canvasElement)).toBeNull();

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
 * `Backpack parity/Real/Video` is for, and what this suite's offline guard
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
 * `backpack-video-styles.ts` no longer matches, so hovering leaves the cover at
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
      await afterTransition(cover);
      await expect(scaleOf(cover)).toBe(1);
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
 * Backpack's `YouTube Shorts Video` args, verbatim, and its own narrower box
 * with them: Backpack wraps this story in `TestWrapper maxWidth='400px'` where
 * the 600px of every other story here comes from the meta's. The width lives on
 * the player box rather than a wrapper, so it arrives as a second stylesheet —
 * one rule, not a second copy of `backpackVideoCss`, which would re-emit some
 * 300 lines to change one declaration.
 *
 * The mechanism is cascade order: a story's own decorators render inside the
 * meta's, so this `<style>` comes later in the document and its
 * `.ef-video-player` rule wins the tie at equal specificity. The `width`
 * assertion below is what makes that load-bearing — reorder the decorators and
 * the story fails loudly rather than silently rendering at 600px.
 *
 * A portrait player, which is the point of the story: `aspectRatios: '9/16'`
 * applies at every width, so the 400px box is 711px tall and the play icon sits
 * centred in it — by `inset: 0; margin: auto`, which knows nothing about the
 * box's shape.
 */
export const YouTubeShortsVideo: Story = {
  name: 'YouTube Shorts Video',
  args: {
    url: 'https://www.youtube.com/shorts/n3eC51ZaDlk',
    muted: true,
    light: false,
    aspectRatios: '9/16'
  },
  decorators: [
    withCss(`
.ef-video-player {
  width: 400px;
}
`)
  ],
  parameters: pausedPlayer,
  play: async ({ canvas, canvasElement }) => {
    const player = playerBox(canvasElement);
    await expect(getComputedStyle(player).aspectRatio).toBe('9 / 16');
    const { height, width } = player.getBoundingClientRect();
    await expect(width).toBe(400);
    await expect(Math.round(height)).toBe(Math.round((400 * 16) / 9));

    // The icon is inside the portrait box, and centred in it.
    const icon = playIcon(canvasElement)!;
    const box = icon.getBoundingClientRect();
    await expect(Math.round(box.left + box.width / 2)).toBe(
      Math.round(player.getBoundingClientRect().left + width / 2)
    );
    await canvas.findByRole('button', { name: 'Play video' });
  }
};

/**
 * Backpack's `YouTubeShortsVideoAndCustomCoverImage` args, now including its
 * `aspectRatios: '9/16'`. `light: false` pins that a caller-supplied
 * `placeholderImageSrc` shows a cover regardless — the wrapper's own
 * `hasCustomCoverImage` independence from `light` — and the cover fills the
 * portrait box rather than a 16/9 one.
 *
 * "Fills" is both dimensions and the fit: the cover image is a 4×3 SVG, so
 * `object-fit: cover` is the whole of what makes it fill a 9/16 box instead of
 * letterboxing inside it.
 */
export const YouTubeShortsVideoAndCustomCoverImage: Story = {
  args: {
    url: 'https://www.youtube.com/shorts/n3eC51ZaDlk',
    muted: true,
    light: false,
    placeholderImageSrc: coverImageDataUri,
    alt: 'custom cover image',
    hoverEffect: true,
    aspectRatios: '9/16'
  },
  parameters: { player: {} },
  play: async ({ canvas, canvasElement }) => {
    const cover = await canvas.findByAltText('custom cover image');
    await expect(cover).toHaveAttribute('src', coverImageDataUri);
    const player = playerBox(canvasElement);
    await expect(getComputedStyle(player).aspectRatio).toBe('9 / 16');
    const box = player.getBoundingClientRect();
    await expect(cover.getBoundingClientRect().height).toBe(box.height);
    await expect(cover.getBoundingClientRect().width).toBe(box.width);
    await expect(getComputedStyle(cover).objectFit).toBe('cover');
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

/**
 * A breakpoint map, which no Backpack story exercises. `s` is the unprefixed
 * base and `m` is its 768px query, so the wrapper writes `9 / 16` for `s` and
 * carries `16 / 9` from `m` up through the three wider breakpoints the args do
 * not name — the same thing Backpack's `aspect-9-16 md:aspect-16-9` does, where
 * a min-width prefix keeps applying above its own breakpoint.
 *
 * Which of the five applies is the runner's own window width, so the story reads
 * it from `matchMedia` against the same query the stylesheet declares rather
 * than assuming a viewport size — and the five properties are asserted
 * directly, so what the wrapper wrote is pinned whichever branch the window
 * takes. That the stylesheet declares a query per breakpoint at all is pinned
 * in `backpack-video-styles.contract.test.ts`, which does not need a window.
 */
export const AspectRatiosPerBreakpoint: Story = {
  args: { url: vimeoUrl, muted: true, aspectRatios: { s: '9/16', m: '16/9' } },
  parameters: pausedPlayer,
  play: async ({ canvasElement }) => {
    const styles = getComputedStyle(playerBox(canvasElement));
    const property = (name: string) => styles.getPropertyValue(name).trim();

    await expect(property('--ef-video-aspect-s')).toBe('9 / 16');
    await expect(property('--ef-video-aspect-m')).toBe('16 / 9');
    await expect(property('--ef-video-aspect-l')).toBe('16 / 9');
    await expect(property('--ef-video-aspect-xl')).toBe('16 / 9');
    await expect(property('--ef-video-aspect-xxl')).toBe('16 / 9');

    const wide = window.matchMedia('(min-width: 768px)').matches;
    await expect(styles.aspectRatio).toBe(wide ? '16 / 9' : '9 / 16');
  }
};

/**
 * `'natural'` — Backpack's default value, and the one mapping this wrapper
 * deliberately does not copy. Backpack's `'natural'` for a video is
 * `aspect-video`, a fixed 16/9 (`useAspectRatio.tsx:15-17`); here it is
 * `aspect-ratio: var(--reely-media-aspect-ratio, 16 / 9)`, so the box follows
 * whatever the media measures and falls back to Backpack's value until
 * something does. `Default` pins the fallback; this pins the measurement, with
 * the mock player publishing 640×480 through its `dimensions` knob rather than
 * any real media — a 4:3 ratio precisely because it is neither the 16/9
 * fallback nor a portrait ratio another story already shows.
 */
export const NaturalAspectRatio: Story = {
  args: { url: vimeoUrl, muted: true, aspectRatios: 'natural' },
  parameters: {
    player: { ...pausedPlayer.player, dimensions: { width: 640, height: 480 } }
  },
  play: async ({ canvasElement }) => {
    const player = playerBox(canvasElement);
    // `Player.Viewport` publishes the property from an effect after mount
    // (`packages/react/src/viewport-media.tsx:95-108`), so the first frame is
    // still the fallback.
    await waitFor(() =>
      expect(getComputedStyle(player).aspectRatio).toBe('640 / 480')
    );
    const { height, width } = player.getBoundingClientRect();
    await expect(Math.round((width / height) * 100)).toBe(133);
  }
};

/**
 * Backpack's `WithShadowVariant` args. `variant` resolves to a class from
 * `backpackVideoStyles`, and the story-local CSS approximates Backpack's
 * `shadow-dark-m-15` token with the value that token resolves to.
 */
export const WithShadowVariant: Story = {
  args: { url: vimeoUrl, muted: true, variant: 'shadow-m' },
  parameters: pausedPlayer,
  play: async ({ canvasElement }) => {
    const player = playerBox(canvasElement);
    await expect(player).toHaveClass('ef-video-variant-shadow-m');
    await expect(getComputedStyle(player).boxShadow).toBe(
      'rgba(26, 26, 26, 0.15) 0px 2px 8px 0px'
    );
  }
};

/**
 * Backpack's `WithOutlineVariant` args: a 1px border in its `mono-gray-300`.
 * The box keeps the 600px the stylesheet gives it and draws the border inside
 * that, here as in Backpack: Backpack loads Tailwind's preflight
 * (`src/scss/base/_index.scss:1` is `@tailwind base`, and `tailwind.config.cjs`
 * overrides neither `preflight` nor `corePlugins`), whose reset puts
 * `box-sizing: border-box` on every element — so the border comes out of the
 * declared width rather than being added to it. `backpack-video-styles.ts`
 * declares the same on `.ef-video-player`, and the width below is what pins it:
 * a content-box would measure 602.
 */
export const WithOutlineVariant: Story = {
  args: { url: vimeoUrl, muted: true, variant: 'outline' },
  parameters: pausedPlayer,
  play: async ({ canvasElement }) => {
    const player = playerBox(canvasElement);
    await expect(player).toHaveClass('ef-video-variant-outline');
    const styles = getComputedStyle(player);
    await expect(styles.borderTopWidth).toBe('1px');
    await expect(styles.borderTopColor).toBe('rgb(191, 191, 191)');
    await expect(styles.boxSizing).toBe('border-box');
    await expect(player.getBoundingClientRect().width).toBe(600);
  }
};

/**
 * Backpack's `WithXLSizePlayIcon` args. `xl` is a 4rem box against the default
 * `m`'s 3rem, which `Default` pins — the sizes Backpack's `IconWrapper` gets
 * from `size-16` and `size-12`.
 */
export const WithXLSizePlayIcon: Story = {
  args: { url: vimeoUrl, muted: true, playIconSize: 'xl' },
  parameters: pausedPlayer,
  play: async ({ canvasElement }) => {
    const icon = playIcon(canvasElement)!;
    await expect(icon).toHaveAttribute('data-play-icon-size', 'xl');
    const { height, width } = icon.getBoundingClientRect();
    await expect(width).toBe(64);
    await expect(height).toBe(64);
  }
};

/**
 * Backpack's `With themeConfig` args, with a story-local class name in place of
 * its Tailwind: `border-4 border-pink-base bg-blue-dark` becomes the rule the
 * decorator below mounts, at the values those two tokens resolve to.
 *
 * The override replaces the variant's own class rather than joining it, which
 * is what Backpack's `deepMerge` plus `twMerge` amounts to — so the assertion
 * is that `ef-video-variant-outline` is gone and the 1px border with it.
 */
export const WithThemeConfig: Story = {
  name: 'With themeConfig',
  args: {
    url: vimeoUrl,
    muted: true,
    variant: 'outline',
    themeConfig: {
      variants: { variant: { outline: { root: 'story-video-theme-config' } } }
    }
  },
  decorators: [
    withCss(`
.story-video-theme-config {
  border: 4px solid rgb(218, 35, 129);
  background: rgb(0, 52, 100);
}
`)
  ],
  parameters: pausedPlayer,
  play: async ({ canvasElement }) => {
    const player = playerBox(canvasElement);
    await expect(player).toHaveClass('story-video-theme-config');
    await expect(player).not.toHaveClass('ef-video-variant-outline');
    const styles = getComputedStyle(player);
    await expect(styles.borderTopWidth).toBe('4px');
    await expect(styles.borderTopColor).toBe('rgb(218, 35, 129)');
    await expect(styles.backgroundColor).toBe('rgb(0, 52, 100)');
  }
};

/**
 * Backpack's `DefaultThemeConfig`, which dumps its `videoStyles` object so a
 * reader can see what a `themeConfig` may reach. This dumps the wrapper's own
 * default style object, which is a much smaller thing: the wrapper approximates
 * Backpack's styling in a stylesheet, so the only classes it resolves at
 * runtime are the root's and the variants' — and those are the only ones the
 * escape hatch overrides. Backpack renders the dump with `react-json-view-lite`;
 * a `<pre>` stands in for it, since this repo adds no dependency for a story.
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
    await expect(canvasElement.querySelector('pre')).toHaveTextContent(
      '"root": "ef-video-variant-outline"'
    );
  }
};

/*
 * The `pauseOnOutOfViewport` stories. Deterministic in the same way as every
 * story above — `pausedPlayer` is staged, so the wrapper's own toggle is the
 * click target, no provider attaches and the Vimeo URL stays inert — but the
 * `IntersectionObserver` doing the work is the browser's own: this suite runs
 * in Chromium, so the scrolls below are real scrolls observed for real, and
 * nothing here fakes the API. `Backpack parity/Real/Video` carries Backpack's
 * exact args for the same three.
 *
 * Two properties of the wrapper are left to `off-screen-pause.contract.test.ts`,
 * which can drive the observer directly. Neither is observable here: a pause
 * the viewer issues while the video is off screen (the automation driver
 * scrolls an element into view before clicking it, which would undo the scroll
 * under test), and the precedence between an off-screen intent and a `playing`
 * prop that change in one commit.
 *
 * All four render the same thing — `MockedInPageVideo` over a staged paused
 * player, full-bleed — and open the same way, so the render and the opening are
 * the two helpers below. What is left in each story is its args and the scroll
 * sequence it asserts, which is all they differ on.
 */

const inPageStory = (args: Story['args'], play: Story['play']): Story => ({
  args,
  parameters: { ...pausedPlayer, layout: 'fullscreen' },
  render: (storyArgs, { parameters }) => (
    <MockedInPageVideo
      {...storyArgs}
      player={parameters.player as MockPlayerParameters}
    />
  ),
  play
});

/** The context a `play` function is given, for {@link startPlaying} to take. */
type PlayContext = Parameters<NonNullable<Story['play']>>[0];

/**
 * The opening all four share: the badge at rest, "scroll down to see the
 * video", and playback started from the wrapper's own toggle. Returns the three
 * things the rest of a scroll sequence is written against.
 */
const startPlaying = async ({
  canvas,
  canvasElement,
  userEvent
}: PlayContext) => {
  const { container, video } = inPageParts(canvasElement);
  const badge = canvas.getByRole('status');
  await expect(badge).toHaveTextContent('Paused');

  scrollToVisibleFraction(container, video, fullyVisible);
  await userEvent.click(
    await canvas.findByRole('button', { name: 'Play video' })
  );
  await waitFor(() => expect(badge).toHaveTextContent('Playing'));

  return { badge, container, video };
};

/**
 * Backpack's `InPage`: its `InPageLayout` with `pauseOnOutOfViewport` on and
 * muted. Pins the behaviour end to end — playback starts, scrolling the video
 * clear of the container pauses it, scrolling it back resumes it — through the
 * badge the layout drives from `onPlayChange`. Every step is a positive
 * assertion, so each one waits for the observer rather than for a clock.
 */
export const InPage: Story = inPageStory(
  { url: vimeoUrl, muted: true, pauseOnOutOfViewport: true },
  async (context) => {
    const { args } = context;
    const { badge, container, video } = await startPlaying(context);

    scrollToVisibleFraction(container, video, clearOfTheEdge);
    await waitFor(() => expect(badge).toHaveTextContent('Paused'));

    scrollToVisibleFraction(container, video, fullyVisible);
    await waitFor(() => expect(badge).toHaveTextContent('Playing'));

    await expect(args.onPlayChange).toHaveBeenCalledTimes(3);
  }
);

/**
 * Backpack's `WithoutPauseOnOutOfViewport` args (muted here, unmuted in
 * `Backpack parity/Real/Video`): a video scrolled clear of the container keeps
 * playing.
 *
 * The story cannot assert that on the badge, which shows the same "Playing" it
 * showed before — so it asserts it on the transition count, and the two scrolls
 * are each awaited on an observer of the story's own. Without that wait the two
 * would land in one frame, the browser would never sample the video off screen,
 * and this story would pass over a wrapper that pauses on every scroll. The
 * hand pause at the end is the settle point: a positive transition, awaited
 * long enough that an off-screen-driven one would have been reported by then too.
 */
export const WithoutPauseOnOutOfViewport: Story = inPageStory(
  { url: vimeoUrl, muted: true, pauseOnOutOfViewport: false },
  async (context) => {
    const { args, canvas, userEvent } = context;
    const { badge, container, video } = await startPlaying(context);

    scrollToVisibleFraction(container, video, clearOfTheEdge);
    await observedVisibility(container, video, false);
    scrollToVisibleFraction(container, video, fullyVisible);
    await observedVisibility(container, video, true);

    await userEvent.click(
      await canvas.findByRole('button', { name: 'Pause video' })
    );
    await waitFor(() => expect(badge).toHaveTextContent('Paused'));

    // Two transitions in the whole story, the two clicks. A pause on the way
    // out would have added one and its resume another.
    await expect(args.onPlayChange).toHaveBeenCalledTimes(2);
  }
);

/**
 * Backpack's `WithPauseOnOutOfViewport` args, which differ from its `InPage`
 * only in `muted` — so where the deterministic `InPage` above pins the
 * pause-and-resume cycle, this one pins the exception to it: a video the viewer
 * paused by hand is not started again by scrolling it back into view, because a
 * resume restores playback the wrapper interrupted and there was none to
 * interrupt. Backpack's equivalent bookkeeping is `wasPlayingBeforeOutOfViewRef`
 * (`useVideoPlayerState.ts:147,150-151`).
 *
 * The hand pause happens while the video is on screen, which is the half of
 * that guard a browser can show: pausing it while it is off screen means
 * clicking an element the automation driver would scroll into view first, so
 * that half stays in `off-screen-pause.contract.test.ts`. Same shape as above —
 * both scrolls awaited on the story's own observer, and the final click is the
 * settle point.
 */
export const WithPauseOnOutOfViewport: Story = inPageStory(
  { url: vimeoUrl, muted: true, pauseOnOutOfViewport: true },
  async (context) => {
    const { args, canvas, userEvent } = context;
    const { badge, container, video } = await startPlaying(context);

    await userEvent.click(
      await canvas.findByRole('button', { name: 'Pause video' })
    );
    await waitFor(() => expect(badge).toHaveTextContent('Paused'));

    scrollToVisibleFraction(container, video, clearOfTheEdge);
    await observedVisibility(container, video, false);
    scrollToVisibleFraction(container, video, fullyVisible);
    await observedVisibility(container, video, true);

    await userEvent.click(
      await canvas.findByRole('button', { name: 'Play video' })
    );
    await waitFor(() => expect(badge).toHaveTextContent('Playing'));

    // Three transitions, the three clicks: the video went off screen already
    // paused, so there was nothing to pause and nothing to come back to.
    await expect(args.onPlayChange).toHaveBeenCalledTimes(3);
  }
);

/**
 * `threshold`, which Backpack exposes but has no story for. At `0.5` the
 * observer calls the video out of view once less than half of it is showing, so
 * a video still a quarter on screen pauses — which a `threshold: 0` observer
 * would have called intersecting and left alone. That is the whole discrimination
 * this story makes, and it is why both positions are a wide margin from the
 * threshold rather than a pixel either side of it.
 */
export const WithThreshold: Story = inPageStory(
  {
    url: vimeoUrl,
    muted: true,
    pauseOnOutOfViewport: true,
    threshold: 0.5
  },
  async (context) => {
    const { args } = context;
    const { badge, container, video } = await startPlaying(context);

    scrollToVisibleFraction(container, video, quarterVisible);
    await waitFor(() => expect(badge).toHaveTextContent('Paused'));

    scrollToVisibleFraction(container, video, fullyVisible);
    await waitFor(() => expect(badge).toHaveTextContent('Playing'));

    await expect(args.onPlayChange).toHaveBeenCalledTimes(3);
  }
);

/*
 * SIDEPRO-201's two stories. Both stage the mock player already `ready` with
 * `reportsPlayback: true` (`mock-player.tsx:24-35`), so `play`/`pause` issued
 * through the `PlayerHandle` ref actually move `state.playback` — the same
 * gap `createReportingProvider` closes for the contract tests
 * (`reporting-provider.ts`), given a story instead. Both drive that ref from
 * a button *inside* the rendered tree rather than reaching in from a `play`
 * function: the button's own `onClick` closes over the ref exactly as an
 * external consumer's own code would, and the `play` function only clicks
 * it and reads the result — no merged ref, no imperative handle exported
 * out of the story, because nothing outside the tree needs one here.
 */

/**
 * The external "play" command SIDEPRO-201 documents: `activateFromInteraction`
 * then `play`, in that order, against the same `PlayerHandle` ref
 * (`activateFromInteraction`'s dormant-or-error branches are
 * `use-activation.ts:324-356`, its
 * `const activateFromInteraction = useCallback`; `play`'s not-ready
 * short-circuit is
 * `player-controller.ts:381-386`). One named function rather than one copy
 * of the pair per button, so the two calls have a single home to drift from
 * instead of two.
 *
 * Why the pair, and not just `play`: `activateFromInteraction` is a no-op
 * unless the player is `dormant` or in a recoverable `error`, so the same
 * call starts a dormant player and is silently skipped against an
 * already-active one — no branch here has to tell the two apart. `play` is
 * what an already-active player needs, and is a harmless
 * `{ ok: false, reason: 'not-ready' }` no-op against a player the first call
 * just set loading, because nothing has attached to it yet. That the pair
 * costs exactly one real play either way, rather than a queued one plus a
 * doubled-up second, is pinned in `packages/react/test/activation.test.tsx`'s
 * `'interaction issues exactly one play when activateFromInteraction is
 * immediately followed by play'`.
 */
const playExternally = (ref: ReturnType<typeof useMockPlayer>): void => {
  ref.current?.activateFromInteraction();
  void ref.current?.play();
};

/**
 * Two buttons standing in for an external consumer that holds
 * `BackpackVideo`'s `PlayerHandle` ref (`backpack-video.tsx:108-112`, its
 * `readonly ref?: Ref<Player.PlayerHandle>`, forwarded at `:539`, `ref={ref}`) and
 * drives it directly, the way `WithEvents` below needs one to. "External
 * pause" is the one call {@link playExternally}'s pair has no dormant half
 * to worry about.
 */
const ExternalEventsVideo = ({
  player,
  ...props
}: BackpackVideoProps & { readonly player: MockPlayerParameters }) => {
  const ref = useMockPlayer(player);
  return (
    <>
      <BackpackVideo {...props} ref={ref} />
      <button onClick={() => playExternally(ref)} type="button">
        External play
      </button>
      <button onClick={() => void ref.current?.pause()} type="button">
        External pause
      </button>
    </>
  );
};

/**
 * Backpack's `WithEvents` is `Default`'s args plus an `onPlayChange` that
 * logs (`Video.stories.tsx:304-312`) — nothing the meta's own spy
 * (`:214` above, the meta's `args`) does not already prove, and `Default` already asserts that
 * spy for the viewer's own click (`:260-271`). What earns this row its own
 * story instead of staying `Default`'s alias is the other source
 * `onPlayChange` has to report from: a transition the wrapper did not click
 * for itself, arriving as an ordinary player report the way an external
 * `activateFromInteraction` then `play`, or `pause` on its own, would
 * (`backpack-video.tsx:322-327`, the two `useOnChange` calls) — in both
 * directions, and without reporting
 * a transition nothing actually changed a second time.
 */
export const WithEvents: Story = {
  args: { url: vimeoUrl, muted: true },
  parameters: {
    player: { ...pausedPlayer.player, reportsPlayback: true }
  },
  render: (args, { parameters }) => (
    <ExternalEventsVideo
      {...args}
      player={parameters.player as MockPlayerParameters}
    />
  ),
  play: async ({ args, canvas, userEvent }) => {
    const externalPlay = await canvas.findByRole('button', {
      name: 'External play'
    });
    const externalPause = await canvas.findByRole('button', {
      name: 'External pause'
    });

    await userEvent.click(externalPlay);
    await waitFor(() =>
      expect(args.onPlayChange).toHaveBeenLastCalledWith(true)
    );
    await expect(args.onPlayChange).toHaveBeenCalledTimes(1);

    // The same external command again, still playing: nothing changed for
    // the wrapper to fold in, so nothing is reported a second time.
    await userEvent.click(externalPlay);
    await expect(args.onPlayChange).toHaveBeenCalledTimes(1);

    await userEvent.click(externalPause);
    await waitFor(() =>
      expect(args.onPlayChange).toHaveBeenLastCalledWith(false)
    );
    await expect(args.onPlayChange).toHaveBeenCalledTimes(2);
  }
};

/**
 * Three buttons standing in for Backpack's carousel, which drives one
 * video's play state through a module-global jotai atom
 * (`video.store.ts:20`). This wrapper has no such atom — Reely's commands
 * are imperative and scoped to the `PlayerHandle` ref a caller already
 * holds — so the equivalent buttons drive the same player directly through
 * that ref instead of through a shared store. "Reset" is where the two
 * diverge: Backpack's atom has an `undefined` state, "no opinion", for its
 * third button to reset to; Reely's ref retains nothing a reset could
 * release, so this button is wired to nothing, on purpose.
 */
const SocialCarouselIntegrationVideo = ({
  player,
  ...props
}: BackpackVideoProps & { readonly player: MockPlayerParameters }) => {
  const ref = useMockPlayer(player);
  return (
    <>
      <BackpackVideo {...props} ref={ref} />
      <button onClick={() => playExternally(ref)} type="button">
        Simulate slide active (play)
      </button>
      <button onClick={() => void ref.current?.pause()} type="button">
        Simulate slide change (pause)
      </button>
      {/* No `onClick`: Reely retains nothing for a reset to release. */}
      <button type="button">Reset (no-op)</button>
    </>
  );
};

/**
 * Backpack's `SocialCarouselAtomIntegration`
 * (`Video.stories.tsx:441-488`, named `'Regression: SocialCarousel atom
 * integration'`): three buttons coordinating one video the way a carousel
 * would. Its args for the video are `url='https://vimeo.com/336066147' muted
 * light={false}`, carried verbatim (`vimeoUrl` is this file's own name for
 * that URL). The mechanism differs — {@link SocialCarouselIntegrationVideo}
 * says how and why — while the behaviour it exercises matches: play, pause,
 * and a reset that changes nothing, proven by a later command still working
 * after it, which is what makes the "nothing to release" divergence safe
 * rather than merely convenient.
 */
export const SocialCarouselAtomIntegration: Story = {
  name: 'Regression: SocialCarousel atom integration',
  args: { url: vimeoUrl, muted: true, light: false },
  parameters: {
    player: { ...pausedPlayer.player, reportsPlayback: true }
  },
  render: (args, { parameters }) => (
    <SocialCarouselIntegrationVideo
      {...args}
      player={parameters.player as MockPlayerParameters}
    />
  ),
  play: async ({ canvas, userEvent }) => {
    const play = await canvas.findByRole('button', {
      name: 'Simulate slide active (play)'
    });
    const pause = await canvas.findByRole('button', {
      name: 'Simulate slide change (pause)'
    });
    const reset = await canvas.findByRole('button', { name: 'Reset (no-op)' });

    await userEvent.click(play);
    await waitFor(() =>
      expect(
        canvas.getByRole('button', { name: 'Pause video' })
      ).toHaveAttribute('aria-pressed', 'true')
    );

    await userEvent.click(pause);
    await waitFor(() =>
      expect(
        canvas.getByRole('button', { name: 'Play video' })
      ).toHaveAttribute('aria-pressed', 'false')
    );

    await userEvent.click(reset);
    // The no-op: the surface is exactly as the pause above left it.
    await expect(
      canvas.getByRole('button', { name: 'Play video' })
    ).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(play);
    await waitFor(() =>
      expect(
        canvas.getByRole('button', { name: 'Pause video' })
      ).toHaveAttribute('aria-pressed', 'true')
    );
  }
};
