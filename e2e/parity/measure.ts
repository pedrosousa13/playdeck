import type { Locator, Page } from '@playwright/test';

/**
 * The one selector set both Storybooks answer to. Backpack's `VideoPlayer`,
 * `VideoPlayIcon` and `VideoCoverImage`/`Image` render these exact class
 * names (`Video/video.styles.ts`'s `root` slot, `videoPlayIconStyles`'s
 * `playIcon` slot, and `VideoCoverImage.tsx`'s own `imageClasses`), and
 * Reely's `BackpackVideo` wrapper (`apps/storybook/stories/backpack/backpack-video.tsx`,
 * `backpack-video-styles.ts`) was deliberately built to wear the same three
 * names — "the class names are Backpack's own, which keeps the shape of the
 * markup comparable to the component this stands in for"
 * (`backpack-video-styles.ts`'s own file header). One selector therefore
 * reaches the equivalent element on both Storybooks, which is what makes one
 * measurement function possible at all: a query that differed per side would
 * let a difference in the *query* masquerade as a difference in the *thing*.
 */
export const ROOT_SELECTOR = '.ef-video-player';
export const COVER_SELECTOR = '.ef-video-cover-image';
export const PLAY_ICON_SELECTOR = '.ef-video-play-icon';

/**
 * Every clickable affordance inside the player root, generic across both
 * markups on purpose: Backpack has no single stable class for "the thing you
 * click" (a cover's own container, `ReactPlayer` itself, or
 * `VideoHiddenControls`, depending on state), where Reely's does
 * (`.ef-video-controller`, `Player.ActivationButton`). A role-based query
 * reaches whichever element either side is using without needing to know
 * which one that is — the same idiom
 * `apps/storybook/stories/backpack/backpack-video.stories.tsx`'s own
 * `affordances` helper already uses for the same purpose in its contract
 * tests.
 */
export const AFFORDANCE_SELECTOR = 'button, [role="button"]';

export type Box = { x: number; y: number; width: number; height: number };

export interface Measurement {
  /** `null` when no `.ef-video-player` is on the page at all — a
   * `DefaultThemeConfig`-style story dumps JSON instead of rendering a
   * player, and that absence is a fact the caller needs, not an error. */
  root:
    | (Box & {
        aspectRatio: number;
        /** The root's width as a fraction of its immediate parent's — a
         * scale-invariant read of "box relative to its container" that holds
         * across two Storybooks whose iframe sizes are not otherwise
         * comparable. */
        widthFractionOfParent: number;
      })
    | null;
  cover: { box: Box; objectFit: string } | null;
  playIcon: { box: Box; centered: boolean } | null;
  /** Whether a `<video>` or `<iframe>` exists under the root right now. */
  mounted: boolean;
  /** Every affordance under the root, as `TAG[accessible name]`. */
  accessibleTargets: string[];
}

/**
 * Everything geometric and structural about one player, read through one
 * function so a difference between Backpack and Reely can never be an
 * artefact of measuring them two different ways — the condition the plan
 * puts on this whole file. Takes the page rather than an element handle,
 * because the root selector may not resolve to anything at all, which is
 * itself a result (see {@link Measurement.root}) rather than a thrown error.
 */
export async function measure(page: Page): Promise<Measurement> {
  return page.evaluate(
    ({ rootSel, coverSel, iconSel, affordanceSel }) => {
      const boxOf = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };

      const root = document.querySelector(rootSel);
      if (root === null) {
        return {
          root: null,
          cover: null,
          playIcon: null,
          mounted: false,
          accessibleTargets: []
        };
      }
      const rootBox = boxOf(root);
      const parent = root.parentElement;
      const parentWidth = parent?.getBoundingClientRect().width ?? 0;
      const rootMeasurement = {
        ...rootBox,
        aspectRatio: rootBox.height === 0 ? 0 : rootBox.width / rootBox.height,
        widthFractionOfParent:
          parentWidth === 0 ? 0 : rootBox.width / parentWidth
      };

      // The element that actually paints the cover picture is not the same
      // node on both sides. On Backpack this class lands on `Image`'s own
      // wrapper `div`, one level above the `<img>`
      // (`VideoCoverImage.tsx`'s `imageClasses` prop, forwarded to `Image`'s
      // own `className` — which `Image.tsx` applies to its outer `div`, not
      // the `<img>` it renders). On Reely the class is on the `<img>` itself
      // (`video-cover-image.tsx`). Resolving to whichever element actually
      // carries `object-fit` keeps that half of the read meaningful on both:
      // a wrapper `div` never sets it.
      const coverWrapper = document.querySelector(coverSel);
      const coverImg =
        coverWrapper === null
          ? null
          : ((coverWrapper.matches('img')
              ? coverWrapper
              : coverWrapper.querySelector('img')) ?? coverWrapper);
      const cover =
        coverWrapper === null || coverImg === null
          ? null
          : {
              box: boxOf(coverWrapper),
              objectFit: getComputedStyle(coverImg).objectFit
            };

      const iconEl = document.querySelector(iconSel);
      const playIcon = (() => {
        if (iconEl === null) return null;
        const box = boxOf(iconEl);
        const iconCenterX = box.x + box.width / 2;
        const iconCenterY = box.y + box.height / 2;
        const rootCenterX = rootBox.x + rootBox.width / 2;
        const rootCenterY = rootBox.y + rootBox.height / 2;
        // A few pixels of tolerance for the same reason
        // `e2e/visual.spec.ts`'s `covers` helper carries one: layout resolves
        // fractional pixels, and this asks about centering, not exact
        // coincidence.
        const centered =
          Math.abs(iconCenterX - rootCenterX) <= 2 &&
          Math.abs(iconCenterY - rootCenterY) <= 2;
        return { box, centered };
      })();

      const mounted = root.querySelector('iframe, video') !== null;

      const accessibleTargets = [...root.querySelectorAll(affordanceSel)].map(
        (el) => {
          const name =
            el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
          return `${el.tagName}[${name}]`;
        }
      );

      return {
        root: rootMeasurement,
        cover,
        playIcon,
        mounted,
        accessibleTargets
      };
    },
    {
      rootSel: ROOT_SELECTOR,
      coverSel: COVER_SELECTOR,
      iconSel: PLAY_ICON_SELECTOR,
      affordanceSel: AFFORDANCE_SELECTOR
    }
  );
}

export interface HoverReading {
  scale: number;
  transitionDurationMs: number;
}

export interface HoverMeasurement {
  /** The cover image's own hover zoom — Backpack's `coverImage` slot and
   * Reely's `.ef-video-cover-image` rule, the effect "Deliberate
   * divergences" describes as `scale(1.05)` over `duration-system-medium`.
   * `null` when there is no cover to hover. */
  cover: HoverReading | null;
  /** The root player box's own hover zoom. Backpack's compound variant
   * zooms `playerWrapper` — the box around the media itself, not only the
   * cover — whenever `hoverEffect` is on and playback has not started, with
   * or without a custom cover image; Reely's stylesheet has no rule that
   * targets the root or its media wrapper the same way, only the cover. This
   * reading exists so that difference is measured rather than assumed. */
  root: HoverReading | null;
}

const readHover = async (locator: Locator): Promise<HoverReading | null> => {
  if ((await locator.count()) === 0) return null;
  await locator.hover();
  // The transition needs its own duration to settle before the scale is
  // meaningful to read — the same idiom
  // `apps/storybook/stories/backpack/backpack-video.stories.tsx`'s own
  // `afterTransition` helper uses, reading the duration from the element
  // rather than hard-coding it so this tracks either stylesheet.
  const transitionDurationMs = await locator.evaluate((el) => {
    const { transitionDuration } = getComputedStyle(el);
    return Number.parseFloat(transitionDuration) * 1000;
  });
  await locator.page().waitForTimeout(transitionDurationMs + 100);
  const scale = await locator.evaluate((el) => {
    const { transform } = getComputedStyle(el);
    return transform === 'none' ? 1 : new DOMMatrix(transform).a;
  });
  return { scale, transitionDurationMs };
};

/**
 * The hover-zoom factor and its transition duration for both the cover image
 * and the root player box, read as computed style rather than inferred from
 * a class name — Reely's story-local CSS reaches `scale(1.05)` a different
 * way than Backpack's tailwind-variants compound variant does, so only the
 * resolved value is comparable. `locator.hover()` dispatches a real pointer
 * move so the browser's own `:hover` matches, unlike a synthetic event
 * (`backpack-video.stories.tsx`'s own `hover` helper makes the same point
 * about why it drives a real browser pointer rather than
 * `userEvent.hover`). The mouse is parked away from the player afterwards so
 * a later measurement in the same pair does not inherit a stale `:hover`.
 */
export async function measureHoverZoom(page: Page): Promise<HoverMeasurement> {
  const cover = await readHover(page.locator(COVER_SELECTOR).first());
  const root = await readHover(page.locator(ROOT_SELECTOR).first());
  await page.mouse.move(0, 0);
  return { cover, root };
}

export const story = (id: string): string =>
  `/iframe.html?id=${id}&viewMode=story`;
