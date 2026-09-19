import { expect, test, type Page } from '@playwright/test';
import { captionsTriggerSelector, controls } from './locators';

/**
 * #682: with either shipped stylesheet mounted, the captions menu's trigger
 * must not sit underneath the caption line.
 *
 * One declaration, read two ways, is the whole cause. Both `theme.css` and
 * `docked.css` write `align-items: center` on the `controls` part for their
 * own row direction, where it means "centre each control vertically within its
 * line" -- both wrap into two lines under `flex-wrap: wrap`, so the direction
 * is the load-bearing half, not the line count. The reference composition overrides `flex-direction: column` unlayered
 * but left `align-items` to the theme, so the same declaration was reinterpreted
 * as "shrink each row to its own content width and centre it horizontally" —
 * which pulled the button row into the middle of the bar and parked the
 * captions trigger under the cue. `.playdeck-example-controls` declares
 * `align-items: stretch` for that reason, and this is what holds it there.
 *
 * Rects measured in the browser, never read out of the stylesheets: the defect
 * is a position, and an assertion over rule text goes green on any rule that
 * merely mentions the property.
 *
 * With the menu closed. The trigger's box is the same whether or not its menu
 * is open — the menu is absolutely positioned and takes the trigger out of
 * nothing — and the closed state is the one that asks about the bar's layout
 * without the menu's own box in the picture.
 *
 * No unthemed pass, and that is not an omission. `stretch` is the initial
 * value of `align-items`, so a composition with no stylesheet mounted reports
 * clear whether or not the example declares anything — a pass carrying no
 * information about this fix, of exactly the shape
 * `docs/agents/demonstrated-red.md` warns about.
 */
const composition = (globals: string): string =>
  `/iframe.html?id=reference-player--composition&viewMode=story&globals=${globals}`;

const captionLineSelector = '[data-playdeck-part="caption-line"]';

type ControlSurfaceStyle = {
  readonly borderBlockStartWidth: string;
  readonly transitionDuration: string;
};

const controlSurfaceStyle = (page: Page): Promise<ControlSurfaceStyle> =>
  controls(page).evaluate((element) => {
    const style = globalThis.getComputedStyle(element);
    return {
      borderBlockStartWidth: style.borderBlockStartWidth,
      transitionDuration: style.transitionDuration
    };
  });

// Pin the stylesheet that arrived, not the one the URL asked for — the same
// guard `e2e/a11y.spec.ts` states at length, and it matters more here than
// there: a `theme:` global the preview does not know renders unthemed, and
// unthemed passes the assertion below on the initial value alone. Each pin is
// measured on the control surface, and the example can forge neither, because
// `.playdeck-example-controls` declares no border and no transition of its
// own.
const themes = [
  {
    name: 'docked',
    globals: 'theme:docked',
    // `docked.css` draws a hairline between bar and picture because there is
    // no scrim there to supply that edge; the string `border-block-start`
    // appears nowhere in `theme.css`, and unthemed computes `0px`.
    proof: 'docked.css draws a 1px border-block-start on the control bar',
    mounted: (style: ControlSurfaceStyle) =>
      style.borderBlockStartWidth === '1px'
  },
  {
    name: 'themed',
    globals: 'theme:themed',
    // `theme.css` transitions the bar's own `opacity` for its auto-hide.
    // `docked.css` declares no transition on the `controls` part -- it has its
    // own elsewhere, on `activation`, `volume-slider` and `thumbnail`, so what
    // separates the two here is the part, not the file. Unthemed computes
    // `0s`. Parsed rather than string-matched, because engines serialise
    // durations differently.
    //
    // Sound only outside reduced motion: `theme.css` collapses this duration
    // to `0.01ms` under `prefers-reduced-motion: reduce`, so a mounted theme
    // would read as never-mounted there. `playwright.config.ts` sets no
    // `reducedMotion`, so it cannot happen today; a run that starts emulating
    // it needs a different proof for this pin, not a wider threshold.
    proof: 'theme.css transitions the control bar opacity for its auto-hide',
    mounted: (style: ControlSurfaceStyle) =>
      Number.parseFloat(style.transitionDuration) > 0.1
  }
] as const;

type Box = {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
};

const boxOf = (page: Page, selector: string): Promise<Box> =>
  page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (element === null) throw new Error(`no element matched ${sel}`);
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom
    };
  }, selector);

const describeBox = (box: Box): string =>
  `x${box.left.toFixed(2)}-${box.right.toFixed(2)} ` +
  `y${box.top.toFixed(2)}-${box.bottom.toFixed(2)}`;

const overlaps = (one: Box, other: Box): boolean =>
  one.left < other.right &&
  one.right > other.left &&
  one.top < other.bottom &&
  one.bottom > other.top;

for (const theme of themes) {
  test(`the captions trigger clears the caption line under ${theme.name}`, async ({
    page
  }) => {
    await page.goto(composition(theme.globals));
    await expect(page.locator(captionLineSelector)).toBeVisible();

    expect(
      theme.mounted(await controlSurfaceStyle(page)),
      `the ${theme.name} pass must measure the stylesheet it names: ` +
        `${theme.proof}, so an unthemed control surface here means the ` +
        `toolbar global never mounted it — and unthemed satisfies this ` +
        `test's own assertion on the initial value of align-items`
    ).toBe(true);

    const captionLine = await boxOf(page, captionLineSelector);
    const trigger = await boxOf(page, captionsTriggerSelector);

    expect(
      overlaps(captionLine, trigger),
      `the captions trigger must not sit under the caption line: ` +
        `trigger ${describeBox(trigger)}, ` +
        `caption line ${describeBox(captionLine)}`
    ).toBe(false);
  });
}
